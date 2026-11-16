/*=====================================================================
   StarLaunch · 账户消息：网页 → 宿主的登录 / 切换 / 退出
   ---------------------------------------------------------------------
   所有回包都是小驼峰字典（postMessage 走默认序列化选项，不会自动转驼峰），
   网页按 type 分发：

     account-login       登录结果（成功 / 失败 / 需要选角色）
     ms-device           设备代码（要显示给用户的 user_code 与链接）
     ms-progress         微软登录的阶段提示
     accounts-changed    账号档案变了（列表、选中项）
     authlib-server      验证服务器探测结果
     account-skin        皮肤刷新结果

   微软登录是长时间任务（等人去浏览器点授权），所以用 loginId 追踪，
   支持中途取消；取消后不会再回 account-login。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private readonly Dictionary<string, CancellationTokenSource> _loginTokens =
            new Dictionary<string, CancellationTokenSource>(StringComparer.Ordinal);

        private readonly object _loginGate = new object();

        /// <summary>启动后给当前账号做一次体检（令牌过期就自动刷新）。</summary>
        private async void StartAccountValidation()
        {
            try
            {
                LoginResult? result = await AccountService.ValidateSelectedAsync(CancellationToken.None)
                    .ConfigureAwait(true);
                if (result?.Account == null) return;

                PostAccountsChanged();
                PostPageMessage("account-login", new Dictionary<string, object?>
                {
                    ["ok"] = true,
                    ["silent"] = true,
                    ["method"] = result.Method,
                    ["account"] = result.Account.ToView()
                });
            }
            catch (Exception)
            {
                // 体检失败不打扰用户：界面照旧显示旧档案，用的时候会提示重新登录
            }
        }

        /// <summary>账户相关消息的分发入口。返回 false 表示这条消息不归这里管。</summary>
        private bool HandleAccountMessage(string? type, JsonElement root)
        {
            switch (type)
            {
                case "account-login":
                    BeginAccountLogin(root);
                    return true;
                case "account-login-cancel":
                    CancelAccountLogin(ReadString(root, "loginId"));
                    return true;
                case "account-select":
                    SelectAccount(ReadString(root, "id"));
                    return true;
                case "account-logout":
                    LogoutAccount(ReadString(root, "id"));
                    return true;
                case "account-refresh":
                    RefreshAccount(ReadString(root, "id"));
                    return true;
                case "account-skin-refresh":
                    RefreshAccountSkin(ReadString(root, "id"));
                    return true;
                case "account-set-client-id":
                    SetClientId(ReadString(root, "clientId"), ReadString(root, "authority"));
                    return true;
                case "account-import-official":
                    ImportOfficialLauncher(ReadString(root, "loginId"), ReadString(root, "path"));
                    return true;
                case "account-pick-official":
                {
                    string? picked = PickOfficialAccountFile();
                    if (picked != null) ImportOfficialLauncher(ReadString(root, "loginId"), picked);
                    else
                    {
                        PostPageMessage("official-launcher", new Dictionary<string, object?>
                        {
                            ["ok"] = false,
                            ["canceled"] = true,
                            ["found"] = new List<string>()
                        });
                    }
                    return true;
                }
                case "account-probe-official":
                    ProbeOfficialLauncher();
                    return true;
                case "authlib-probe":
                    ProbeAuthServer(ReadString(root, "server"));
                    return true;
                default:
                    return false;
            }
        }

        /* -----------------------------------------------------------------
           登录
           ----------------------------------------------------------------- */

        private void BeginAccountLogin(JsonElement root)
        {
            string method = (ReadString(root, "method") ?? "offline").Trim().ToLowerInvariant();
            string loginId = ReadString(root, "loginId") ?? Guid.NewGuid().ToString("n");

            switch (method)
            {
                case "offline":
                {
                    var result = AccountService.LoginOffline(
                        ReadString(root, "name"), ReadString(root, "uuid"));
                    SettleLogin(loginId, "offline", result);
                    return;
                }
                case "authlib":
                {
                    string? server = ReadString(root, "server");
                    string? username = ReadString(root, "username");
                    string? password = ReadString(root, "password");
                    string? profileId = ReadString(root, "profileId");

                    var token = CreateLoginToken(loginId);
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var result = await AccountService
                                .LoginAuthlibAsync(server, username, password, profileId, token)
                                .ConfigureAwait(false);
                            PostFromAnyThread("account-login", BuildLoginPayload(loginId, "authlib", result));
                        }
                        catch (OperationCanceledException)
                        {
                            PostFromAnyThread("account-login", new Dictionary<string, object?>
                            {
                                ["ok"] = false,
                                ["loginId"] = loginId,
                                ["method"] = "authlib",
                                ["error"] = "已取消登录",
                                ["errorCode"] = "canceled"
                            });
                        }
                        catch (Exception ex)
                        {
                            PostFromAnyThread("account-login", new Dictionary<string, object?>
                            {
                                ["ok"] = false,
                                ["loginId"] = loginId,
                                ["method"] = "authlib",
                                ["error"] = ex.Message,
                                ["errorCode"] = "auth-failed"
                            });
                        }
                        finally
                        {
                            ReleaseLoginToken(loginId);
                        }
                    });
                    return;
                }
                case "ms":
                {
                    var token = CreateLoginToken(loginId);
                    _ = Task.Run(async () => await RunMicrosoftLoginAsync(loginId, token).ConfigureAwait(false));
                    return;
                }
                default:
                    PostPageMessage("account-login", new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["loginId"] = loginId,
                        ["method"] = method,
                        ["error"] = "不认识的登录方式：" + method,
                        ["errorCode"] = "bad-method"
                    });
                    return;
            }
        }

        /// <summary>没有任何 Azure 应用 ID 时的替代路径：把官方启动器的登录状态搬过来。</summary>
        private void ImportOfficialLauncher(string? loginId, string? filePath)
        {
            string id = string.IsNullOrWhiteSpace(loginId)
                ? Guid.NewGuid().ToString("n")
                : loginId!;
            var token = CreateLoginToken(id);

            _ = Task.Run(async () =>
            {
                try
                {
                    var result = await AccountService
                        .ImportFromOfficialAsync(filePath, token).ConfigureAwait(false);
                    if (result.Ok && result.Account != null) AccountStore.Select(result.Account.Id);
                    PostFromAnyThread("account-login", BuildLoginPayload(id, "ms", result));
                }
                catch (OperationCanceledException)
                {
                    PostFromAnyThread("account-login", new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["loginId"] = id,
                        ["method"] = "ms",
                        ["error"] = "已取消导入",
                        ["errorCode"] = "canceled"
                    });
                }
                catch (Exception ex)
                {
                    PostFromAnyThread("account-login", new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["loginId"] = id,
                        ["method"] = "ms",
                        ["error"] = "导入失败：" + ex.Message,
                        ["errorCode"] = "import-failed"
                    });
                }
                finally
                {
                    ReleaseLoginToken(id);
                }
            });
        }

        /// <summary>手动挑一份 launcher_accounts.json（便携版官方启动器 / 换过目录的）。</summary>
        private string? PickOfficialAccountFile()
        {
            try
            {
                var dialog = new OpenFileDialog
                {
                    Title = "选择官方启动器的账号文件",
                    Filter = "官方启动器账号文件 (launcher_accounts*.json)|launcher_accounts*.json|" +
                             "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*",
                    Multiselect = false,
                    CheckFileExists = true
                };

                string? start = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), ".minecraft");
                if (System.IO.Directory.Exists(start)) dialog.InitialDirectory = start;

                return dialog.ShowDialog(this) == true ? dialog.FileName : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>扫一遍官方启动器的账号文件，告诉网页找没找到（不读令牌）。</summary>
        private void ProbeOfficialLauncher()
        {
            var paths = new List<string>();
            foreach (string path in OfficialLauncherImport.ExistingPaths()) paths.Add(path);

            PostPageMessage("official-launcher", new Dictionary<string, object?>
            {
                ["ok"] = paths.Count > 0,
                ["found"] = paths,
                ["checked"] = OfficialLauncherImport.CandidatePaths()
            });
        }

        /// <summary>微软登录：设备代码 → 等授权 → Xbox 链路。整个过程在后台线程上跑。</summary>
        private async Task RunMicrosoftLoginAsync(string loginId, CancellationToken token)
        {
            try
            {
                var (device, failure) = await AccountService.BeginMicrosoftAsync(token).ConfigureAwait(false);
                if (device == null)
                {
                    PostFromAnyThread("account-login", BuildLoginPayload(
                        loginId, "ms", failure ?? LoginResult.Failure("没能向微软申请登录代码")));
                    return;
                }

                PostFromAnyThread("ms-device", new Dictionary<string, object?>
                {
                    ["loginId"] = loginId,
                    ["userCode"] = device.UserCode,
                    ["verificationUri"] = device.VerificationUri,
                    ["message"] = device.Message,
                    ["expiresIn"] = device.ExpiresIn,
                    ["interval"] = device.Interval
                });

                var result = await AccountService.FinishMicrosoftAsync(
                    device!,
                    status => PostFromAnyThread("ms-progress", new Dictionary<string, object?>
                    {
                        ["loginId"] = loginId,
                        ["message"] = status
                    }),
                    token).ConfigureAwait(false);

                PostFromAnyThread("account-login", BuildLoginPayload(loginId, "ms", result));
            }
            catch (OperationCanceledException)
            {
                PostFromAnyThread("account-login", new Dictionary<string, object?>
                {
                    ["ok"] = false,
                    ["loginId"] = loginId,
                    ["method"] = "ms",
                    ["error"] = "已取消登录",
                    ["errorCode"] = "canceled"
                });
            }
            catch (Exception ex)
            {
                PostFromAnyThread("account-login", new Dictionary<string, object?>
                {
                    ["ok"] = false,
                    ["loginId"] = loginId,
                    ["method"] = "ms",
                    ["error"] = ex.Message,
                    ["errorCode"] = "ms-failed"
                });
            }
            finally
            {
                ReleaseLoginToken(loginId);
            }
        }

        /// <summary>登录成功后统一处理：选中它、把结果和「档案变了」一起回给网页。</summary>
        private void SettleLogin(string loginId, string method, LoginResult result)
        {
            if (result.Ok && result.Account != null)
            {
                AccountStore.Select(result.Account.Id);
            }
            PostPageMessage("account-login", BuildLoginPayload(loginId, method, result));
        }

        private Dictionary<string, object?> BuildLoginPayload(string loginId, string method, LoginResult result)
        {
            var payload = new Dictionary<string, object?>
            {
                ["loginId"] = loginId,
                ["method"] = method,
                ["ok"] = result.Ok,
                ["error"] = result.Error,
                ["errorCode"] = result.ErrorCode,
                ["account"] = result.Account?.ToView()
            };

            if (result.Profiles != null)
            {
                var list = new List<Dictionary<string, object?>>();
                foreach (var profile in result.Profiles)
                {
                    list.Add(new Dictionary<string, object?>
                    {
                        ["id"] = profile.Id,
                        ["name"] = profile.Name
                    });
                }
                payload["profiles"] = list;
                payload["serverName"] = result.Server?.ServerName;
            }

            if (result.Ok) PostAccountsChanged();
            return payload;
        }

        /// <summary>给一次登录注册取消令牌（同一个 loginId 重复开始会先取消上一次）。</summary>
        private CancellationToken CreateLoginToken(string loginId)
        {
            var source = new CancellationTokenSource();
            lock (_loginGate)
            {
                if (_loginTokens.TryGetValue(loginId, out var existing))
                {
                    try { existing.Cancel(); } catch (Exception) { }
                    _loginTokens.Remove(loginId);
                }
                _loginTokens[loginId] = source;
            }
            return source.Token;
        }

        private void ReleaseLoginToken(string loginId)
        {
            lock (_loginGate)
            {
                if (_loginTokens.TryGetValue(loginId, out var source))
                {
                    _loginTokens.Remove(loginId);
                    try { source.Dispose(); } catch (Exception) { }
                }
            }
        }

        private void CancelAccountLogin(string? loginId)
        {
            if (string.IsNullOrWhiteSpace(loginId)) return;
            lock (_loginGate)
            {
                if (!_loginTokens.TryGetValue(loginId!, out var source)) return;
                try { source.Cancel(); } catch (Exception) { }
            }
        }

        /* -----------------------------------------------------------------
           档案操作
           ----------------------------------------------------------------- */

        private void SelectAccount(string? id)
        {
            bool ok = AccountStore.Select(id);
            PostAccountsChanged();
            if (!ok)
            {
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "select",
                    ["ok"] = false,
                    ["error"] = "这个账号不在列表里"
                });
            }
        }

        private async void LogoutAccount(string? id)
        {
            try
            {
                bool ok = await AccountService.LogoutAsync(id, CancellationToken.None).ConfigureAwait(true);
                PostAccountsChanged();
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "logout",
                    ["ok"] = ok,
                    ["id"] = id,
                    ["error"] = ok ? null : "没有找到这个账号"
                });
            }
            catch (Exception ex)
            {
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "logout",
                    ["ok"] = false,
                    ["id"] = id,
                    ["error"] = ex.Message
                });
            }
        }

        private async void RefreshAccount(string? id)
        {
            var account = AccountStore.Find(id) ?? AccountStore.Selected;
            if (account == null)
            {
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "refresh",
                    ["ok"] = false,
                    ["error"] = "还没有登录任何账户"
                });
                return;
            }

            try
            {
                var result = await AccountService.RefreshAsync(account, CancellationToken.None)
                    .ConfigureAwait(true);

                PostAccountsChanged();
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "refresh",
                    ["ok"] = result.Ok,
                    ["id"] = account.Id,
                    ["account"] = result.Account?.ToView(),
                    ["error"] = result.Error
                });
            }
            catch (Exception ex)
            {
                PostPageMessage("account-action", new Dictionary<string, object?>
                {
                    ["action"] = "refresh",
                    ["ok"] = false,
                    ["id"] = account.Id,
                    ["error"] = ex.Message
                });
            }
        }

        private async void RefreshAccountSkin(string? id)
        {
            var account = AccountStore.Find(id) ?? AccountStore.Selected;
            if (account == null) return;

            SkinService.Invalidate(account.Id);
            try
            {
                byte[]? bytes = await SkinService.GetSkinAsync(account, CancellationToken.None)
                    .ConfigureAwait(true);
                PostPageMessage("account-skin", new Dictionary<string, object?>
                {
                    ["id"] = account.Id,
                    ["ok"] = bytes != null && bytes.Length > 0,
                    ["error"] = bytes == null ? "没有找到这个账号的皮肤" : null
                });
            }
            catch (Exception ex)
            {
                PostPageMessage("account-skin", new Dictionary<string, object?>
                {
                    ["id"] = account.Id,
                    ["ok"] = false,
                    ["error"] = ex.Message
                });
            }
        }

        private void SetClientId(string? clientId, string? authority)
        {
            AccountService.SaveClientId(clientId);
            AccountService.SaveAuthority(authority);
            PostPageMessage("account-config", new Dictionary<string, object?>
            {
                ["ok"] = true,
                ["hasClientId"] = AccountService.HasClientId,
                ["clientId"] = AccountService.MaskedClientId,
                ["clientIdFromEnv"] = AccountService.ClientIdFromEnvironment,
                ["builtInClientId"] = AccountService.UsingBuiltInClientId,
                ["authority"] = AccountService.Authority
            });
        }

        /// <summary>探测验证服：界面上要显示服务器名和注册链接，填错地址时就地报错。</summary>
        private async void ProbeAuthServer(string? server)
        {
            try
            {
                var info = await AuthlibAuth.DiscoverAsync(server ?? string.Empty, CancellationToken.None)
                    .ConfigureAwait(true);
                PostPageMessage("authlib-server", new Dictionary<string, object?>
                {
                    ["ok"] = true,
                    ["server"] = server,
                    ["apiRoot"] = info.ApiRoot,
                    ["serverName"] = info.ServerName,
                    ["registerUrl"] = info.RegisterUrl
                });
            }
            catch (Exception ex)
            {
                PostPageMessage("authlib-server", new Dictionary<string, object?>
                {
                    ["ok"] = false,
                    ["server"] = server,
                    ["error"] = ex.Message
                });
            }
        }

        private void PostAccountsChanged()
        {
            var accounts = new List<Dictionary<string, object?>>();
            foreach (var account in AccountStore.All) accounts.Add(account.ToView());
            var selected = AccountStore.Selected;

            PostPageMessage("accounts-changed", new Dictionary<string, object?>
            {
                ["accounts"] = accounts,
                ["selected"] = selected?.ToView(),
                ["hasClientId"] = AccountService.HasClientId
            });
        }

        /// <summary>后台线程回网页：PostWebMessageAsJson 必须在 UI 线程上调用。</summary>
        private void PostFromAnyThread(string type, Dictionary<string, object?> payload)
        {
            try
            {
                Dispatcher.BeginInvoke(new Action(() => PostPageMessage(type, payload)));
            }
            catch (Exception)
            {
                // 窗口已经关了
            }
        }
    }
}
