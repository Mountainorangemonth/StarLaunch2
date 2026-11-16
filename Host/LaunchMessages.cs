/*=====================================================================
   StarLaunch · 宿主消息：启动游戏 / Java 列表 / 内存读数 / 主机设置
   ---------------------------------------------------------------------
   网页 → 宿主的「一问一答」都走通用回执通道：
       网页  post({ type: 'java-list', id: 'r3' })
       宿主  post({ type: 'reply', id: 'r3', ok: true, data: {...} })

   启动是唯一一个「流式」的：除了 reply，还会推
     launch-phase  { id, text, percent }      进度阶段
     launch-log    { id, lines: [..] }        游戏输出（攒 150ms 一起发）
     launch-ready  { id, pid, java, command } 进程已起来
     launch-failed { id, error }              失败
     launch-canceled { id }                   用户在准备阶段取消
     launch-exited { id, exitCode, seconds, week } 游戏退出（顺带带上最新周统计）
launch-stopped { id, exitCode }          网页点了「停止游戏」，进程树已结束

网页 → 宿主多了 launch-stop（右下角的「停止游戏」）：只结束这次启动的进程，
不影响别的实例；进程已经退出时也会回一条 launch-stopped。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private const int MaxLaunchLogLines = 4000;

        private readonly object _launchGate = new object();
        private CancellationTokenSource? _launchCts;
        private LaunchRun? _currentRun;
        private LaunchReporter? _launchReporter;
        private int _launching;
        private DateTime _launchStartedAt;

        /// <summary>网页发来的「一问一答」指令。返回 true 表示这条消息已经处理掉了。</summary>
        private bool HandleLaunchMessage(string? type, JsonElement root)
        {
            if (string.IsNullOrEmpty(type)) return false;

            switch (type)
            {
                case "launch-game":
                    StartGame(root);
                    return true;
                case "launch-cancel":
                    CancelLaunch();
                    return true;
                case "launch-stop":
                    StopGame(root);
                    return true;
                case "java-list":
                    SendJavaList(ReadString(root, "id"), ReadBoolField(root, "refresh"));
                    return true;
                case "memory-status":
                    SendMemoryStatus(ReadString(root, "id"));
                    return true;
                case "play-stats":
                    SendPlayStats(ReadString(root, "id"));
                    return true;
                case "host-settings":
                    Reply(ReadString(root, "id"), true, HostSettingsView(), null);
                    return true;
                case "set-host-settings":
                    SaveHostSettings(root);
                    return true;
                case "check-update":
                    CheckLauncherUpdate(ReadString(root, "id"));
                    return true;
                default:
                    return false;
            }
        }

        /* =================================================================
           启动
           ================================================================= */

        private void StartGame(JsonElement root)
        {
            string id = ReadString(root, "id") ?? "launch";
            if (Interlocked.CompareExchange(ref _launching, 1, 0) != 0)
            {
                // 上一次卡死（网络挂住、解压没返回…）会把 _launching 永远留在 1，
                // 超过 3 分钟就直接放行，别让用户重启启动器才能再点一次
                if (!AllowStaleLaunchRetry() || Interlocked.CompareExchange(ref _launching, 1, 0) != 0)
                {
                    // 这条以前走的是通用 reply 通道，而网页的启动弹窗只监听 launch-*，
                    // 结果界面就停在「正在请求启动」，什么原因都看不到。
                    PostLaunchFailed(id,
                        "上一次启动还在准备中（可能卡在检查文件或者查找 Java）。\n\n" +
                        "先点启动弹窗里的「取消」，等几秒再点一次启动。");
                    return;
                }
            }

            _launchStartedAt = DateTime.UtcNow;

            LaunchRequest? request;
            string? error;
            try
            {
                request = BuildLaunchRequest(root, out error);
            }
            catch (Exception ex)
            {
                request = null;
                error = ex.Message;
            }

            if (request == null)
            {
                Interlocked.Exchange(ref _launching, 0);
                PostLaunchFailed(id, error ?? "启动参数不完整");
                return;
            }

            var cts = new CancellationTokenSource();
            lock (_launchGate)
            {
                _launchCts?.Dispose();
                _launchCts = cts;
            }

            var reporter = new LaunchReporter(this, id);
            lock (_launchGate) _launchReporter = reporter;

            _ = Task.Run(async () =>
            {
                try
                {
                    var run = await GameLauncher.LaunchAsync(request, reporter, cts.Token).ConfigureAwait(false);
                    lock (_launchGate) _currentRun = run;

                    reporter.Flush();
                    PostAsync("launch-ready", new Dictionary<string, object?>
                    {
                        ["id"] = id,
                        ["pid"] = run.Process.Id,
                        ["java"] = run.JavaPath,
                        ["gameDir"] = run.WorkingDir
                    });

                    // 启动器可见性：最小化 / 隐藏 / 关闭
                    ApplyLauncherVisibility(request.Options.Visibility);
                }
                catch (OperationCanceledException)
                {
                    PostAsync("launch-canceled", new Dictionary<string, object?> { ["id"] = id });
                    reporter.Close();
                }
                catch (HttpError ex)
                {
                    PostAsync("launch-failed", new Dictionary<string, object?>
                    {
                        ["id"] = id,
                        ["error"] = ex.Message
                    });
                    reporter.Close();
                }
                catch (Exception ex)
                {
                    PostAsync("launch-failed", new Dictionary<string, object?>
                    {
                        ["id"] = id,
                        ["error"] = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message
                    });
                    reporter.Close();
                }
                finally
                {
                    Interlocked.Exchange(ref _launching, 0);
                    _launchStartedAt = default;
                }
            });
        }

        /// <summary>
        /// 上一次启动挂在准备阶段超过 3 分钟，且确实没有游戏进程在跑 → 认为它已经废了，
        /// 把 <c>_launching</c> 清零放行这一次。返回 true 表示可以继续抢锁。
        /// </summary>
        private bool AllowStaleLaunchRetry()
        {
            lock (_launchGate)
            {
                if (_currentRun != null && !HasExited(_currentRun)) return false;
                if (_launchStartedAt == default) return false;
                if (DateTime.UtcNow - _launchStartedAt < TimeSpan.FromMinutes(3)) return false;
            }

            Interlocked.Exchange(ref _launching, 0);
            return true;
        }

        /// <summary>
        /// 取消启动。准备阶段是真取消；进程已经起来了就不再打断它
        /// （用户点「取消」的意思通常是「别等了」，不是「把游戏杀掉」）。
        /// </summary>
        private void CancelLaunch()
        {
            lock (_launchGate)
            {
                if (_currentRun != null && !HasExited(_currentRun))
                {
                    return;
                }
                try
                {
                    _launchCts?.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // 已经结束了
                }
            }
        }

        private static bool HasExited(LaunchRun run)
        {
            try
            {
                return run.Process.HasExited;
            }
            catch (Exception)
            {
                return true;
            }
        }

        /// <summary>
        /// 网页右下角的「停止游戏」：结束这次启动的整棵进程树，然后回 launch-stopped。
        /// 只认当前这次启动 —— 用户点的是「停掉我刚启动的这个」，不是「关掉所有 Java」。
        /// 进程其实已经退出时也照样回执，否则网页会一直转「正在停止…」。
        /// </summary>
        private void StopGame(JsonElement root)
        {
            string id = ReadString(root, "id") ?? string.Empty;

            LaunchRun? run;
            lock (_launchGate) run = _currentRun;

            if (run == null || HasExited(run))
            {
                PostAsync("launch-stopped", new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["exitCode"] = run == null ? -1 : SafeExitCode(run)
                });
                return;
            }

            _ = Task.Run(async () =>
            {
                int exitCode = await KillRunAsync(run).ConfigureAwait(false);
                PostAsync("launch-stopped", new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["exitCode"] = exitCode
                });
            });
        }

        /// <summary>
        /// 结束进程树并等它真的退出（最多等 10 秒），返回能拿到的退出码。
        /// 用 Kill(entireProcessTree: true)：Minecraft 自己会拉起子进程，
        /// 只杀 java.exe 会留下孤儿。</summary>
        private static async Task<int> KillRunAsync(LaunchRun run)
        {
            try
            {
                if (!run.Process.HasExited) run.Process.Kill(true);
            }
            catch (Exception)
            {
                // 进程已经没了，或者被系统保护：下面统一按 HasExited 判断
            }

            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await run.Process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // 超时也把回执发出去，让网页先退出「正在停止…」
            }

            return SafeExitCode(run);
        }

        /// <summary>拿退出码：进程没退出 / 句柄失效时回 -1，别在这里抛异常。</summary>
        private static int SafeExitCode(LaunchRun run)
        {
            try
            {
                return run.Process.HasExited ? run.Process.ExitCode : -1;
            }
            catch (Exception)
            {
                return -1;
            }
        }

        /// <summary>启动器可见性：游戏起来之后把启动器最小化 / 隐藏 / 关掉。</summary>
        private void ApplyLauncherVisibility(string? visibility)
        {
            string mode = (visibility ?? "unchanged").Trim().ToLowerInvariant();
            if (mode == "unchanged") return;

            Dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    switch (mode)
                    {
                        case "minimize":
                            WindowState = System.Windows.WindowState.Minimized;
                            break;
                        case "hide":
                            // 先确认托盘图标能加上再藏窗口，否则界面和图标一起没了
                            if (ShowTrayIcon()) Hide();
                            else ReportTrayError();
                            break;
                        case "close":
                            if (LauncherConfigStore.Current.CloseToTray)
                            {
                                if (ShowTrayIcon()) Hide();
                                else ReportTrayError();
                            }
                            else
                            {
                                _exiting = true;
                                Close();
                            }
                            break;
                    }
                }
                catch (Exception)
                {
                    // 窗口已经在关了
                }
            }));
        }

        private LaunchRequest? BuildLaunchRequest(JsonElement root, out string? error)
        {
            error = null;

            string gameDir = ReadString(root, "gameDir") ?? string.Empty;
            string versionId = NormalizeVersionId(ReadString(root, "versionId"));
            if (gameDir.Length == 0) { error = "没有指定游戏目录"; return null; }
            if (versionId.Length == 0) { error = "没有指定版本"; return null; }

            var folder = GameDirs.Find(gameDir);
            if (folder == null)
            {
                error = "这个游戏目录没有登记过：" + gameDir;
                return null;
            }
            if (!Directory.Exists(Path.Combine(folder.Path, "versions", versionId)))
            {
                error = "找不到版本目录：versions\\" + versionId + DescribeVersions(folder.Path);
                return null;
            }

            var account = AccountStore.Selected;
            if (account == null)
            {
                error = "还没有登录账户。启动游戏需要用户名和 UUID，先登录一个再启动。";
                return null;
            }

            var options = ReadLaunchOptions(JsonReadSafe(root, "options"));

            return new LaunchRequest
            {
                GameDir = folder.Path,
                VersionId = versionId,
                Isolated = ReadBoolField(root, "isolated"),
                RunDir = ReadString(root, "runDir") ?? string.Empty,
                DisplayName = Trim(ReadString(root, "name"), 64) ?? versionId,
                Account = new LaunchAccount
                {
                    Name = account.Name,
                    Uuid = Uuids.Normalize(account.Uuid),
                    UuidDashed = Uuids.WithDashes(account.Uuid),
                    AccessToken = string.IsNullOrWhiteSpace(account.AccessToken) ? "0" : account.AccessToken,
                    Type = string.IsNullOrWhiteSpace(account.Type) ? "offline" : account.Type,
                    Xuid = account.UserId,
                    ClientId = account.ClientId
                },
                Options = options
            };
        }

        /// <summary>
        /// 网页里的实例 key 是「文件夹 id::版本目录名」，宿主只吃后半截；
        /// 顺手挡掉路径分隔符，别让 versionId 跑出 versions 目录。
        /// </summary>
        private static string NormalizeVersionId(string? value)
        {
            string text = (value ?? string.Empty).Trim();
            int cut = text.IndexOf("::", StringComparison.Ordinal);
            if (cut >= 0) text = text.Substring(cut + 2).Trim();
            if (text.Length == 0) return string.Empty;
            if (text.IndexOfAny(new[] { '\\', '/', ':', '*', '?', '"', '<', '>', '|' }) >= 0) return string.Empty;
            return text;
        }

        /// <summary>报错时顺手列出这个文件夹里真有哪几个版本，省得用户猜。</summary>
        private static string DescribeVersions(string gameDir)
        {
            try
            {
                string versions = Path.Combine(gameDir, "versions");
                if (!Directory.Exists(versions)) return "\n\n这个游戏文件夹里连 versions 目录都没有：" + versions;

                var names = Directory.GetDirectories(versions)
                    .Select(Path.GetFileName)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                    .Take(6)
                    .ToList();
                if (names.Count == 0) return "\n\nversions 目录是空的：" + versions;

                return "\n\n这个文件夹里实际有的是：" + string.Join("、", names) +
                    (names.Count >= 6 ? " …" : string.Empty);
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }

        /// <summary>启动失败要发 launch-failed（网页的启动弹窗只认这一族消息）。</summary>
        private void PostLaunchFailed(string id, string error)
        {
            PostPageMessage("launch-failed", new Dictionary<string, object?>
            {
                ["id"] = id,
                ["error"] = error
            });
        }

        /// <summary>启动选项：全部过一遍白名单和区间，别让网页传什么就信什么。</summary>
        private static LaunchOptions ReadLaunchOptions(JsonElement options)
        {
            var result = new LaunchOptions();
            if (options.ValueKind != JsonValueKind.Object) return result;

            result.MemoryMb = Clamp(ReadIntField(options, "memMb", result.MemoryMb), 256, 131072);
            result.JavaPath = Trim(ReadString(options, "java"), 400) ?? string.Empty;
            result.JavaHint = Trim(ReadString(options, "javaHint"), 40) ?? string.Empty;
            result.JvmArgs = Trim(ReadString(options, "jvmArgs"), 8000) ?? string.Empty;
            result.GameArgs = Trim(ReadString(options, "gameArgs"), 4000) ?? string.Empty;
            result.PreCommand = Trim(ReadString(options, "preCommand"), 2000) ?? string.Empty;
            result.WindowTitle = Trim(ReadString(options, "windowTitle"), 120) ?? string.Empty;
            result.CustomInfo = Trim(ReadString(options, "customInfo"), 120) ?? string.Empty;

            result.Visibility = Choice(ReadString(options, "visibility"),
                "unchanged", "minimize", "hide", "close", "unchanged");
            result.Priority = Choice(ReadString(options, "priority"),
                "normal", "above", "high", "below", "normal");
            result.WindowMode = Choice(ReadString(options, "windowMode"),
                "custom", "default", "max", "full", "custom");
            result.MemoryManager = Choice(ReadString(options, "memoryManager"),
                "g1", "g1-default", "zgc", "shenandoah", "none", "g1");

            result.WindowWidth = Clamp(ReadIntField(options, "winW", 854), 320, 7680);
            result.WindowHeight = Clamp(ReadIntField(options, "winH", 480), 240, 4320);

            result.DisableWrapper = ReadBoolField(options, "disableWrapper");
            result.DisableUnsafe = ReadBoolField(options, "disableUnsafe");
            result.HighPerfGpu = ReadBoolField(options, "highPerfGpu");
            result.MemoryOptimize = ReadBoolField(options, "memOptimize");
            result.CheckFiles = ReadBoolField(options, "checkFiles");
            return result;
        }

        /* =================================================================
           Java / 内存 / 统计 / 设置
           ================================================================= */

        private void SendJavaList(string? id, bool refresh)
        {
            _ = Task.Run(() =>
            {
                try
                {
                    var list = JavaRuntime.Discover(refresh);
                    var view = list.Select(item => new Dictionary<string, object?>
                    {
                        ["path"] = item.Path,
                        ["version"] = item.Version,
                        ["major"] = item.Major,
                        ["source"] = VendorOf(item.Path),
                        ["label"] = "Java " + item.Version + " · " + VendorOf(item.Path)
                    }).ToList();

                    ReplyOnUiThread(id, true, new Dictionary<string, object?> { ["list"] = view }, null);
                }
                catch (Exception ex)
                {
                    ReplyOnUiThread(id, false, null, "扫描本机 Java 失败：" + ex.Message);
                }
            });
        }

        /// <summary>从路径里猜发行版，让 Java 列表不那么难认。</summary>
        private static string VendorOf(string path)
        {
            string text = (path ?? string.Empty).ToLowerInvariant();
            if (text.Contains("microsoft")) return "Microsoft";
            if (text.Contains("adoptium") || text.Contains("temurin")) return "Adoptium";
            if (text.Contains("zulu")) return "Zulu";
            if (text.Contains("corretto")) return "Corretto";
            if (text.Contains("bellsoft") || text.Contains("liberica")) return "Liberica";
            if (text.Contains("semeru")) return "Semeru";
            if (text.Contains("jetbrains")) return "JetBrains";
            if (text.Contains("oracle")) return "Oracle";
            if (text.Contains("jdk-") || text.Contains("jre-")) return "OpenJDK";
            if (text.Contains("runtime")) return "游戏自带";
            return "本机";
        }

        private void SendMemoryStatus(string? id)
        {
            if (!MemoryOptimizer.TryReadMemory(out long total, out long available))
            {
                Reply(id, false, null, "读不到系统内存状态");
                return;
            }

            Reply(id, true, new Dictionary<string, object?>
            {
                ["totalBytes"] = total,
                ["availableBytes"] = available,
                ["usedBytes"] = Math.Max(0, total - available)
            }, null);
        }

        private void SendPlayStats(string? id)
        {
            try
            {
                Reply(id, true, PlayStats.Week().ToView(), null);
            }
            catch (Exception ex)
            {
                Reply(id, false, null, ex.Message);
            }
        }

        private Dictionary<string, object?> HostSettingsView()
        {
            var config = LauncherConfigStore.Current;
            return new Dictionary<string, object?>
            {
                ["closeToTray"] = config.CloseToTray,
                ["rememberWindowSize"] = config.RememberWindowSize,
                ["cleanInstallCache"] = config.CleanInstallCache,
                ["checkUpdate"] = config.CheckLauncherUpdate
            };
        }

        private void SaveHostSettings(JsonElement root)
        {
            var config = LauncherConfigStore.Current;
            if (root.TryGetProperty("closeToTray", out var closeToTray) &&
                (closeToTray.ValueKind == JsonValueKind.True || closeToTray.ValueKind == JsonValueKind.False))
            {
                config.CloseToTray = closeToTray.ValueKind == JsonValueKind.True;
            }
            if (root.TryGetProperty("rememberWindowSize", out var remember) &&
                (remember.ValueKind == JsonValueKind.True || remember.ValueKind == JsonValueKind.False))
            {
                config.RememberWindowSize = remember.ValueKind == JsonValueKind.True;
            }
            if (root.TryGetProperty("cleanInstallCache", out var clean) &&
                (clean.ValueKind == JsonValueKind.True || clean.ValueKind == JsonValueKind.False))
            {
                config.CleanInstallCache = clean.ValueKind == JsonValueKind.True;
            }
            if (root.TryGetProperty("checkUpdate", out var update) &&
                (update.ValueKind == JsonValueKind.True || update.ValueKind == JsonValueKind.False))
            {
                config.CheckLauncherUpdate = update.ValueKind == JsonValueKind.True;
            }

            LauncherConfigStore.Save();
            Reply(ReadString(root, "id"), true, HostSettingsView(), null);

            // 开关拨动时立刻生效：开了就把图标放进通知区，关了收掉
            if (config.CloseToTray)
            {
                if (!ShowTrayIcon()) ReportTrayError();
            }
            else
            {
                HideTrayIcon();
            }
        }

        private void CheckLauncherUpdate(string? id)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var info = await UpdateChecker.CheckAsync(CancellationToken.None).ConfigureAwait(false);
                    ReplyOnUiThread(id, true, new Dictionary<string, object?>
                    {
                        ["available"] = info.Available,
                        ["latest"] = info.Latest,
                        ["current"] = info.Current,
                        ["url"] = info.Url
                    }, null);
                }
                catch (Exception ex)
                {
                    ReplyOnUiThread(id, false, null, "检查更新失败：" + ex.Message);
                }
            });
        }

        /* =================================================================
           回执
           ================================================================= */

        private void Reply(string? id, bool ok, object? data, string? error)
        {
            PostPageMessage("reply", new Dictionary<string, object?>
            {
                ["id"] = id,
                ["ok"] = ok,
                ["data"] = data,
                ["error"] = error
            });
        }

        /// <summary>后台线程发消息：WebView2 的 PostWebMessageAsJson 只能在 UI 线程上调。</summary>
        private void PostAsync(string type, Dictionary<string, object?> payload)
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

        /// <summary>窗口关闭时收掉日志转发定时器。</summary>
        private void CloseLaunchReporter()
        {
            lock (_launchGate)
            {
                try
                {
                    _launchCts?.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // 已经结束
                }
                _launchReporter?.Close();
                _launchReporter = null;
            }
        }

        private void ReplyOnUiThread(string? id, bool ok, object? data, string? error)
        {
            try
            {
                Dispatcher.BeginInvoke(new Action(() => Reply(id, ok, data, error)));
            }
            catch (Exception)
            {
                // 窗口已经关掉了
            }
        }

        /* =================================================================
           字段读取
           ================================================================= */

        private static JsonElement JsonReadSafe(JsonElement root, string name)
        {
            return root.ValueKind == JsonValueKind.Object &&
                   root.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.Object
                ? value
                : default;
        }

        private static bool ReadBoolField(JsonElement root, string name)
        {
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(name, out var value))
            {
                return false;
            }
            return value.ValueKind == JsonValueKind.True;
        }

        private static int ReadIntField(JsonElement root, string name, int fallback)
        {
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(name, out var value)) return fallback;

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int number)) return number;
            if (value.ValueKind == JsonValueKind.String &&
                int.TryParse(value.GetString(), out int parsed))
            {
                return parsed;
            }
            return fallback;
        }

        private static int Clamp(int value, int min, int max)
        {
            if (value < min) return min;
            if (value > max) return max;
            return value;
        }

        private static string? Trim(string? value, int max)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string text = value!.Trim();
            return text.Length > max ? text.Substring(0, max) : text;
        }

        private static string Choice(string? value, params string[] allowed)
        {
            string text = (value ?? string.Empty).Trim().ToLowerInvariant();
            if (text.Length == 0) return allowed[allowed.Length - 1];
            foreach (string item in allowed)
            {
                if (text == item) return item;
            }
            return allowed[allowed.Length - 1];
        }

        /* =================================================================
           启动日志转发（攒批，别把 WebView2 消息队列打爆）
           ================================================================= */

        private sealed class LaunchReporter : ILaunchReporter, ILaunchExitReporter, IDisposable
        {
            private readonly MainWindow _window;
            private readonly string _id;
            private readonly object _gate = new object();
            private readonly List<string> _buffer = new List<string>();
            private readonly Timer _timer;
            private int _dropped;
            private bool _closed;

            public LaunchReporter(MainWindow window, string id)
            {
                _window = window;
                _id = id;
                // 150ms 推一次：Minecraft 一秒能刷几百行，逐行 post 会把界面拖死
                _timer = new Timer(_ => Flush(), null, 150, 150);
            }

            public void Phase(string text, int percent)
            {
                Flush();
                _window.PostAsync("launch-phase", new Dictionary<string, object?>
                {
                    ["id"] = _id,
                    ["text"] = text,
                    ["percent"] = percent
                });
            }

            public void Log(string line)
            {
                if (string.IsNullOrWhiteSpace(line)) return;
                lock (_gate)
                {
                    if (_closed) return;
                    _buffer.Add(line);
                    if (_buffer.Count > MaxLaunchLogLines)
                    {
                        _buffer.RemoveAt(0);
                        _dropped += 1;
                    }
                }
            }

            public void Flush()
            {
                List<string> lines;
                int dropped;
                lock (_gate)
                {
                    if (_buffer.Count == 0) return;
                    lines = new List<string>(_buffer);
                    _buffer.Clear();
                    dropped = _dropped;
                    _dropped = 0;
                }

                if (dropped > 0) lines.Insert(0, "…（省略了 " + dropped + " 行日志）");

                _window.PostAsync("launch-log", new Dictionary<string, object?>
                {
                    ["id"] = _id,
                    ["lines"] = lines
                });
            }

            public void Exited(LaunchRun run, int exitCode, TimeSpan elapsed)
            {
                Flush();

                Dictionary<string, object?>? week = null;
                try
                {
                    week = PlayStats.Week().ToView();
                }
                catch (Exception)
                {
                    // 统计坏了不影响退出回执
                }

                _window.PostAsync("launch-exited", new Dictionary<string, object?>
                {
                    ["id"] = _id,
                    ["exitCode"] = exitCode,
                    ["seconds"] = (long)elapsed.TotalSeconds,
                    ["week"] = week
                });

                Close();
            }

            /// <summary>结束转发：停掉定时器并做最后一次 flush。</summary>
            public void Close()
            {
                lock (_gate)
                {
                    if (_closed) return;
                    _closed = true;
                }

                try
                {
                    _timer.Dispose();
                }
                catch (Exception)
                {
                    // 已经释放
                }
                Flush();
            }

            public void Dispose() => Close();
        }
    }
}
