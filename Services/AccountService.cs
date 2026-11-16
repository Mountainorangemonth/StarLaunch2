/*=====================================================================
   StarLaunch · 账户服务：登录 / 刷新 / 退出
   ---------------------------------------------------------------------
   把三种登录方式收成同一个入口，结果统一是 LoginResult：

     · 离线登录    —— 立即完成，UUID 按 OfflinePlayer:名字 算；
     · 外置登录    —— 先 authenticate；账号下有多个角色时回一批角色让用户选，
                      选完再 refresh 一次把 selectedProfile 切过去；
     · 微软登录    —— 分两步：Begin 拿设备代码，Finish 轮询并走完 Xbox 链路。

   所有成功的结果都会立刻写进 accounts.json（AccountStore.Save）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>一次登录尝试的结果。Ok 为假时 Error / ErrorCode 至少有一个。</summary>
    internal sealed class LoginResult
    {
        public bool Ok { get; set; }
        public string? Error { get; set; }

        /// <summary>给网页判断用的机器码：no-client-id / need-profile / canceled…</summary>
        public string? ErrorCode { get; set; }

        public AccountRecord? Account { get; set; }

        /// <summary>登录方式：ms / authlib / offline。</summary>
        public string Method { get; set; } = string.Empty;

        /// <summary>需要用户挑一个角色时给的候选（外置登录）。</summary>
        public List<AuthProfile>? Profiles { get; set; }

        /// <summary>服务器信息（外置登录成功后回填，界面上显示「已连接 LittleSkin」）。</summary>
        public AuthServerInfo? Server { get; set; }

        public static LoginResult Failure(string message, string? code = null)
        {
            return new LoginResult { Ok = false, Error = message, ErrorCode = code };
        }
    }

    internal static class AccountService
    {
        /// <summary>环境变量优先（和 PCL 一样，正式发布时把 client_id 藏在环境里）。</summary>
        public const string ClientIdEnvName = "MS_CLIENT_ID";

        /// <summary>
        /// 内置的应用身份（微软不要求保密，公共客户端本来就没有密钥）。
        /// 优先级：环境变量 MS_CLIENT_ID → 设置里手填 → 内置值。
        /// 内置值让用户开箱即用，不必去注册 Azure 应用。
        /// </summary>
        internal const string BuiltInClientId = "";

        private static readonly object PendingGate = new object();
        private static PendingAuthlib? _pending;

        /// <summary>外置登录选角色中间态（5 分钟内有效，只保留最近一次）。</summary>
        private sealed class PendingAuthlib
        {
            public string ApiRoot = string.Empty;
            public AuthServerInfo? Server;
            public AuthSession Session = new AuthSession();
            public DateTimeOffset Expires = DateTimeOffset.UtcNow.AddMinutes(5);
        }

        public static string ClientId
        {
            get
            {
                string env = Environment.GetEnvironmentVariable(ClientIdEnvName) ?? string.Empty;
                if (env.Trim().Length > 0) return env.Trim();

                string configured = (LauncherConfigStore.Current.MsClientId ?? string.Empty).Trim();
                if (configured.Length > 0) return configured;

                return BuiltInClientId;
            }
        }

        public static bool HasClientId => ClientId.Length > 0;

        /// <summary>
        /// 当前用的是不是内置身份（界面据此隐藏「填应用 ID」那一块）。
        /// 以前手填过的值和内置值一样时也算内置 —— 否则界面会一直停在「填 ID」的样子。
        /// </summary>
        public static bool UsingBuiltInClientId
        {
            get
            {
                string env = (Environment.GetEnvironmentVariable(ClientIdEnvName) ?? string.Empty).Trim();
                if (env.Length > 0) return false;

                string configured = (LauncherConfigStore.Current.MsClientId ?? string.Empty).Trim();
                if (configured.Length == 0) return true;
                return string.Equals(configured, BuiltInClientId, StringComparison.OrdinalIgnoreCase);
            }
        }

        /// <summary>OAuth authority：留空时用 consumers（支持个人 Microsoft 帐户）。</summary>
        public static string Authority =>
            MicrosoftAuth.NormalizeAuthority(LauncherConfigStore.Current.MsAuthority);

        public static void SaveAuthority(string? value)
        {
            var config = LauncherConfigStore.Current;
            config.MsAuthority = string.IsNullOrWhiteSpace(value)
                ? null
                : MicrosoftAuth.NormalizeAuthority(value);
            LauncherConfigStore.Save();
        }

        public static void SaveClientId(string? value)
        {
            var config = LauncherConfigStore.Current;
            config.MsClientId = (value ?? string.Empty).Trim();
            LauncherConfigStore.Save();
        }

        /// <summary>给界面看的脱敏串：只露前 4 位和后 4 位，别把完整 ID 摆到网页里。</summary>
        public static string MaskedClientId
        {
            get
            {
                string id = ClientId;
                if (id.Length <= 8) return id.Length == 0 ? string.Empty : "••••";
                return id.Substring(0, 4) + "••••••••" + id.Substring(id.Length - 4);
            }
        }

        /// <summary>环境变量把设置里的值盖住了：界面上要说明「以环境变量为准」。</summary>
        public static bool ClientIdFromEnvironment =>
            (Environment.GetEnvironmentVariable(ClientIdEnvName) ?? string.Empty).Trim().Length > 0;

        /* -----------------------------------------------------------------
           离线登录
           ----------------------------------------------------------------- */

        public static LoginResult LoginOffline(string? name, string? uuid)
        {
            string cleaned = SanitizeOfflineName(name);
            if (cleaned.Length == 0)
            {
                return LoginResult.Failure("请输入玩家名字（只能用字母、数字和下划线，最长 16 位）");
            }

            string rawUuid = (uuid ?? string.Empty).Trim();
            string normalizedUuid = Uuids.Normalize(rawUuid);
            if (rawUuid.Length > 0 && normalizedUuid.Length == 0)
            {
                return LoginResult.Failure("UUID 要写 32 位十六进制（可以带横线），或者留空自动生成");
            }
            if (normalizedUuid.Length == 0) normalizedUuid = Uuids.Offline(cleaned);

            var account = new AccountRecord
            {
                Type = "offline",
                Name = cleaned,
                Uuid = normalizedUuid,
                AccessToken = "-",
                Description = "离线登录",
                ExpiresAt = 0
            };
            account.Id = AccountStore.MakeId(account);

            var saved = AccountStore.Save(account);
            return new LoginResult { Ok = true, Account = saved, Method = "offline" };
        }

        /// <summary>离线名字规则：去掉空白，只留字母数字下划线，最长 16 位。</summary>
        public static string SanitizeOfflineName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return string.Empty;

            var builder = new System.Text.StringBuilder(16);
            foreach (char ch in name!.Trim())
            {
                bool ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                          (ch >= '0' && ch <= '9') || ch == '_';
                if (!ok) continue;
                builder.Append(ch);
                if (builder.Length >= 16) break;
            }
            return builder.ToString();
        }

        /* -----------------------------------------------------------------
           外置登录（authlib-injector）
           ----------------------------------------------------------------- */

        public static async Task<LoginResult> LoginAuthlibAsync(
            string? server, string? username, string? password, string? profileId, CancellationToken token)
        {
            // 第二步：用户已经选好角色，用中间态里的令牌换一次 selectedProfile
            if (!string.IsNullOrWhiteSpace(profileId))
            {
                PendingAuthlib? pending;
                lock (PendingGate)
                {
                    pending = _pending;
                }
                if (pending == null || pending.Expires < DateTimeOffset.UtcNow)
                {
                    return LoginResult.Failure("选择角色的会话已过期，请重新输入密码登录", "need-login");
                }

                var wanted = pending.Session.Profiles.FirstOrDefault(item =>
                    string.Equals(item.Id, Uuids.Normalize(profileId), StringComparison.OrdinalIgnoreCase));
                if (wanted == null)
                {
                    return LoginResult.Failure("这个角色不属于当前账号", "need-profile");
                }

                try
                {
                    var session = await AuthlibAuth
                        .RefreshAsync(pending.ApiRoot, pending.Session.AccessToken, pending.Session.ClientToken, wanted, token)
                        .ConfigureAwait(false);

                    var account = BuildAuthlibAccount(pending.ApiRoot, pending.Server, session, token);
                    lock (PendingGate)
                    {
                        _pending = null;
                    }
                    await CacheSkinAsync(account, token).ConfigureAwait(false);
                    var saved = AccountStore.Save(account);
                    return new LoginResult { Ok = true, Account = saved, Method = "authlib", Server = pending.Server };
                }
                catch (HttpError ex)
                {
                    return LoginResult.Failure(ex.Message, "auth-failed");
                }
            }

            /* 第一步：找服务器 → 登录 → 看有几个角色 */
            AuthServerInfo info;
            try
            {
                info = await AuthlibAuth.DiscoverAsync(server ?? string.Empty, token).ConfigureAwait(false);
            }
            catch (HttpError ex)
            {
                return LoginResult.Failure(ex.Message, "server-unreachable");
            }

            AuthSession authSession;
            try
            {
                authSession = await AuthlibAuth
                    .AuthenticateAsync(info.ApiRoot, username ?? string.Empty, password ?? string.Empty, token)
                    .ConfigureAwait(false);
            }
            catch (HttpError ex)
            {
                return LoginResult.Failure(ex.Message, "auth-failed");
            }

            if (authSession.Profiles.Count > 1 && authSession.Selected == null)
            {
                lock (PendingGate)
                {
                    _pending = new PendingAuthlib
                    {
                        ApiRoot = info.ApiRoot,
                        Server = info,
                        Session = authSession
                    };
                }
                return new LoginResult
                {
                    Ok = false,
                    ErrorCode = "need-profile",
                    Error = "这个账号下有多个角色，先选一个进游戏",
                    Profiles = authSession.Profiles,
                    Method = "authlib",
                    Server = info
                };
            }

            var profile = authSession.Selected ?? authSession.Profiles.FirstOrDefault();
            if (profile == null)
            {
                return LoginResult.Failure("这个账号下没有任何 Minecraft 角色，请先在 " + info.ServerName + " 创建角色", "no-profile");
            }

            var built = BuildAuthlibAccount(info.ApiRoot, info, authSession, token);
            await CacheSkinAsync(built, token).ConfigureAwait(false);
            var record = AccountStore.Save(built);

            // authlib-injector.jar 后台准备，不阻塞登录结果
            _ = AuthlibAuth.EnsureInjectorAsync(CancellationToken.None);

            return new LoginResult { Ok = true, Account = record, Method = "authlib", Server = info };
        }

        private static AccountRecord BuildAuthlibAccount(
            string apiRoot, AuthServerInfo? info, AuthSession session, CancellationToken token)
        {
            var profile = session.Selected ?? session.Profiles.FirstOrDefault()
                ?? throw new HttpError("验证服务器没有返回角色信息");

            var account = new AccountRecord
            {
                Type = "authlib",
                Name = profile.Name,
                Uuid = Uuids.Normalize(profile.Id),
                AccessToken = session.AccessToken,
                RefreshToken = session.AccessToken,
                ClientToken = session.ClientToken,
                Server = apiRoot,
                ServerName = info?.ServerName,
                UserId = session.UserId,
                Description = string.IsNullOrWhiteSpace(info?.ServerName) ? "外置登录" : info!.ServerName,
                ExpiresAt = 0
            };
            account.Id = AccountStore.MakeId(account);
            return account;
        }

        /// <summary>登录完顺手把皮肤链接写进档案（失败就算了，头像会退回默认皮肤）。</summary>
        private static async Task CacheSkinAsync(AccountRecord account, CancellationToken token)
        {
            if (account.Type != "authlib" || string.IsNullOrWhiteSpace(account.Server)) return;

            var (url, model) = await AuthlibAuth
                .FetchSkinAsync(account.Server!, account.Uuid, token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(url)) return;

            account.SkinUrl = url;
            account.SkinModel = string.IsNullOrWhiteSpace(model) ? "classic" : model;
        }

        /* -----------------------------------------------------------------
           微软登录
           ----------------------------------------------------------------- */

        /// <summary>第一步：申请设备代码（界面拿 userCode 和 verificationUri 给用户看）。</summary>
        public static async Task<(DeviceCodeInfo? Device, LoginResult? Failure)> BeginMicrosoftAsync(CancellationToken token)
        {
            string clientId = ClientId;
            if (clientId.Length == 0)
            {
                return (null, LoginResult.Failure(
                    "还没有配置微软应用 ID（client_id）：到 Azure 门户注册一个应用，" +
                    "在「身份验证」里打开「允许公共客户端流」，然后把应用 ID 填进设置。",
                    "no-client-id"));
            }

            try
            {
                var device = await MicrosoftAuth
                    .RequestDeviceCodeAsync(clientId, Authority, token).ConfigureAwait(false);
                return (device, null);
            }
            catch (HttpError ex)
            {
                return (null, LoginResult.Failure(ex.Message, "ms-device-failed"));
            }
        }

        /// <summary>第二步：轮询授权，成功后走完 Xbox 链路并写入档案。</summary>
        public static async Task<LoginResult> FinishMicrosoftAsync(
            DeviceCodeInfo device, Action<string>? onStatus, CancellationToken token)
        {
            string clientId = ClientId;
            if (clientId.Length == 0)
            {
                return LoginResult.Failure("微软应用 ID 被清空了，请重新登录", "no-client-id");
            }

            try
            {
                var tokens = await MicrosoftAuth
                    .PollDeviceCodeAsync(clientId, device, Authority, onStatus, token).ConfigureAwait(false);

                var identity = await MicrosoftAuth
                    .LoginWithXboxAsync(tokens.AccessToken, onStatus, token).ConfigureAwait(false);

                var account = new AccountRecord
                {
                    Type = "ms",
                    Name = identity.Name,
                    Uuid = identity.Uuid,
                    AccessToken = identity.AccessToken,
                    RefreshToken = tokens.RefreshToken,
                    ClientId = clientId,
                    Description = "微软账户",
                    ExpiresAt = identity.ExpiresAt,
                    SkinUrl = identity.SkinUrl,
                    SkinModel = string.IsNullOrWhiteSpace(identity.SkinModel) ? "classic" : identity.SkinModel
                };
                account.Id = AccountStore.MakeId(account);

                var saved = AccountStore.Save(account);
                return new LoginResult { Ok = true, Account = saved, Method = "ms" };
            }
            catch (OperationCanceledException)
            {
                return LoginResult.Failure("已取消登录", "canceled");
            }
            catch (HttpError ex)
            {
                return LoginResult.Failure(ex.Message, "ms-failed");
            }
        }


        /* -----------------------------------------------------------------
           官方启动器导入（没有 Azure 应用 ID 时的替代路径）
           ----------------------------------------------------------------- */

        /// <summary>
        /// 把官方启动器里已经登录的微软账号搬过来：读 launcher_accounts.json，
        /// 校验令牌还能用，然后存成 ms 档案。
        /// </summary>
        public static async Task<LoginResult> ImportFromOfficialAsync(
            string? filePath, CancellationToken token)
        {
            List<AccountRecord> imported;
            List<string> errors;
            bool explicitFile = !string.IsNullOrWhiteSpace(filePath);

            try
            {
                (imported, errors) = explicitFile
                    ? await OfficialLauncherImport.ImportFileAsync(filePath!, token).ConfigureAwait(false)
                    : await OfficialLauncherImport.ImportAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return LoginResult.Failure("已取消导入", "canceled");
            }
            catch (Exception ex)
            {
                return LoginResult.Failure("读取官方启动器档案失败：" + ex.Message, "import-failed");
            }

            if (imported.Count == 0)
            {
                if (explicitFile)
                {
                    return LoginResult.Failure(
                        "这个文件里没有能用的账号：" +
                        (errors.Count > 0 ? string.Join("；", errors) : "可能不是官方启动器的 launcher_accounts.json"),
                        "import-empty");
                }

                if (OfficialLauncherImport.ExistingPaths().Count == 0)
                {
                    return LoginResult.Failure(
                        "没有找到官方启动器的账号文件。请先用官方启动器登录一次这个微软账号再回来导入，" +
                        "或者点「选择账号文件」手动指定 launcher_accounts.json。",
                        "no-launcher-accounts");
                }

                return LoginResult.Failure(
                    errors.Count > 0 ? string.Join("；", errors) : "官方启动器里没有可导入的账号",
                    "import-empty");
            }

            var account = imported[0];
            return new LoginResult
            {
                Ok = true,
                Account = account,
                Method = "ms",
                Error = errors.Count > 0 ? string.Join("；", errors) : null
            };
        }

        /* -----------------------------------------------------------------
           刷新 / 退出 / 启动时校验
           ----------------------------------------------------------------- */

        /// <summary>
        /// 让一个账号的令牌重新变新。
        /// 微软：refresh_token → OAuth → Xbox 链路 → profile；
        /// 外置：先 validate，失效了再 refresh；
        /// 离线：什么都不用做，直接返回原档案。
        /// </summary>
        public static async Task<LoginResult> RefreshAsync(AccountRecord account, CancellationToken token)
        {
            var copy = account.Clone();

            if (copy.Type == "offline")
            {
                return new LoginResult { Ok = true, Account = account, Method = "offline" };
            }

            if (copy.Type == "authlib")
            {
                if (string.IsNullOrWhiteSpace(copy.Server))
                {
                    return LoginResult.Failure("这个外置账户缺少服务器地址，请重新登录", "auth-failed");
                }
                try
                {
                    bool valid = await AuthlibAuth
                        .ValidateAsync(copy.Server!, copy.AccessToken, copy.ClientToken ?? string.Empty, token)
                        .ConfigureAwait(false);

                    if (!valid)
                    {
                        var session = await AuthlibAuth
                            .RefreshAsync(copy.Server!, copy.AccessToken, copy.ClientToken ?? string.Empty, null, token)
                            .ConfigureAwait(false);

                        copy.AccessToken = session.AccessToken;
                        copy.RefreshToken = session.AccessToken;
                        if (session.ClientToken.Length > 0) copy.ClientToken = session.ClientToken;
                        if (session.Selected != null)
                        {
                            copy.Name = session.Selected.Name;
                            copy.Uuid = Uuids.Normalize(session.Selected.Id);
                            copy.Id = AccountStore.MakeId(copy);
                        }
                    }

                    await CacheSkinAsync(copy, token).ConfigureAwait(false);
                    var saved = AccountStore.Save(copy);
                    return new LoginResult { Ok = true, Account = saved, Method = "authlib" };
                }
                catch (HttpError ex)
                {
                    return LoginResult.Failure(ex.Message, "auth-failed");
                }
            }

            /* 微软 */
            bool imported = string.Equals(copy.Description, OfficialLauncherImport.ImportDescription,
                StringComparison.Ordinal);

            string clientId = string.IsNullOrWhiteSpace(copy.ClientId) ? ClientId : copy.ClientId!;
            if (clientId.Length == 0)
            {
                // 官方启动器导入的账号本来就没有自己的应用 ID，别把「去注册应用」当成解法
                if (imported)
                {
                    return LoginResult.Failure(
                        "这个账号是从官方启动器导入的，没有可用的刷新令牌：" +
                        "回官方启动器重新登录一次（确认能进游戏），再导入一遍。" +
                        "想要自动续期就得注册一个自己的 Azure 应用 ID。",
                        "official-expired");
                }
                return LoginResult.Failure("缺少微软应用 ID，无法刷新登录状态", "no-client-id");
            }
            if (string.IsNullOrWhiteSpace(copy.RefreshToken))
            {
                return LoginResult.Failure("这个账户没有刷新令牌，需要重新登录", "need-login");
            }

            try
            {
                var tokens = await MicrosoftAuth
                    .RefreshOAuthAsync(clientId, copy.RefreshToken!, Authority, token).ConfigureAwait(false);
                var identity = await MicrosoftAuth
                    .LoginWithXboxAsync(tokens.AccessToken, null, token).ConfigureAwait(false);

                copy.AccessToken = identity.AccessToken;
                copy.RefreshToken = tokens.RefreshToken;
                copy.ExpiresAt = identity.ExpiresAt;
                copy.Name = identity.Name;
                copy.Uuid = identity.Uuid;
                copy.ClientId = clientId;
                if (!string.IsNullOrWhiteSpace(identity.SkinUrl)) copy.SkinUrl = identity.SkinUrl;
                if (!string.IsNullOrWhiteSpace(identity.SkinModel)) copy.SkinModel = identity.SkinModel;
                copy.Id = AccountStore.MakeId(copy);

                var saved = AccountStore.Save(copy);
                return new LoginResult { Ok = true, Account = saved, Method = "ms" };
            }
            catch (HttpError ex)
            {
                // 官方启动器导入的账号没有可用的刷新令牌，只能回官方启动器重登
                if (imported)
                {
                    return LoginResult.Failure(
                        "这个账号是从官方启动器导入的，令牌过期后不能自动续期：" +
                        "回官方启动器重新登录一次（确认能进游戏），再导入一遍。" +
                        "（" + ex.Message + "）",
                        "official-expired");
                }
                return LoginResult.Failure(ex.Message, "ms-failed");
            }
        }

        /// <summary>退出登录：外置服顺手作废令牌，然后删掉本地档案。</summary>
        public static async Task<bool> LogoutAsync(string? id, CancellationToken token)
        {
            var account = AccountStore.Find(id);
            if (account == null) return false;

            if (account.Type == "authlib" && !string.IsNullOrWhiteSpace(account.Server))
            {
                await AuthlibAuth
                    .InvalidateAsync(account.Server!, account.AccessToken, account.ClientToken ?? string.Empty, token)
                    .ConfigureAwait(false);
            }

            return AccountStore.Remove(account.Id);
        }

        /// <summary>
        /// 启动时给当前账号做一次体检：快过期 / 已失效就刷新一次。
        /// 返回更新后的账号；不需要刷新或者刷新失败都返回 null（界面上照旧显示旧档案，
        /// 顶多标一句「登录状态已过期」）。
        /// </summary>
        /// <summary>
        /// 启动时给选中的账户做一次体检：令牌快过期才去刷新。
        /// 以前外置登录（authlib）是每次启动都刷新一遍 —— 服务器连不上时会在
        /// 调试器里留下三条 first-chance 的 SSL 异常，界面却什么也看不到。
        /// </summary>
        public static async Task<LoginResult?> ValidateSelectedAsync(CancellationToken token)
        {
            var account = AccountStore.Selected;
            if (account == null) return null;

            if (account.Type == "offline") return null;
            // 没到期就别打扰服务器（ms / authlib / mojang 一个口径）
            if (!account.IsExpired) return null;

            try
            {
                var result = await RefreshAsync(account, token).ConfigureAwait(false);
                return result.Ok ? result : null;
            }
            catch (OperationCanceledException)
            {
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>选中的账号（给启动流程和界面用）。</summary>
        public static AccountRecord? Current => AccountStore.Selected;
    }
}
