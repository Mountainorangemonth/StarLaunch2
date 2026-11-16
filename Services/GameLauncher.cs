/*=====================================================================
   StarLaunch · 真正的启动
   ---------------------------------------------------------------------
   以前「启动」是网页里 6 个 setTimeout 演的进度条，宿主完全没参与。
   这里按 Minecraft 自己的启动协议把事情做实：

     1. 读版本 JSON 链（versions\<id>\<id>.json → inheritsFrom → 父版本），
        把 mainClass / libraries / arguments / assetIndex 沿链合并；
     2. 按 rules 过滤平台相关的运行库，拼出 classpath；
     3. 把 ${auth_player_name} / ${game_directory} / ${assets_root} 这些
        占位符换成真值；
     4. 找一台版本够的 Java，拼出完整命令行（ArgumentList，不手拼引号）；
     5. 起进程、把 stdout/stderr 实时回给网页、记游戏时长。

   网页那边只管显示：进度阶段 + 日志 + 成功/失败。取消 = 打断准备阶段；
   进程一旦起来就不再是「取消」而是「游戏会继续跑」。

   还没做的（如实说明，不假装支持）：
     · 游戏窗口标题 —— 原版没有命令行开关，这里改成进程起来之后用
       SetWindowText 改主窗口标题，效果和手改窗口名一样；
     · 全屏 —— 原版也没有命令行开关，FullScreen 只会按屏幕尺寸传宽高，
       真正的全屏仍然由游戏里的 F11 控制。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.IO.Compression;
namespace StarLaunch.Services
{
    /// <summary>启动时用的账户信息（从 accounts.json 里选中的那条来）。</summary>
    internal sealed class LaunchAccount
    {
        public string Name { get; set; } = "Player";
        public string Uuid { get; set; } = string.Empty;

        /// <summary>带连字符的 UUID，日志里好看一点。</summary>
        public string UuidDashed { get; set; } = string.Empty;

        public string AccessToken { get; set; } = "0";

        /// <summary>ms / authlib / offline。</summary>
        public string Type { get; set; } = "offline";

        public string? Xuid { get; set; }
        public string? ClientId { get; set; }
    }

    /// <summary>启动选项：网页把「全局设置 + 版本设置」合并好再发过来。</summary>
    internal sealed class LaunchOptions
    {
        public int MemoryMb { get; set; } = 4096;

        /// <summary>版本设置里的 Java：路径 / auto / 空。</summary>
        public string JavaPath { get; set; } = string.Empty;

        /// <summary>全局 Java 列表的值（java21 这种），作为兜底提示。</summary>
        public string JavaHint { get; set; } = string.Empty;

        public string JvmArgs { get; set; } = string.Empty;
        public string GameArgs { get; set; } = string.Empty;
        public string PreCommand { get; set; } = string.Empty;

        public string WindowTitle { get; set; } = string.Empty;
        public string CustomInfo { get; set; } = string.Empty;
        public string Visibility { get; set; } = "unchanged";
        public string Priority { get; set; } = "normal";
        public string WindowMode { get; set; } = "custom";
        public int WindowWidth { get; set; } = 854;
        public int WindowHeight { get; set; } = 480;

        public string MemoryManager { get; set; } = "g1";
        public bool DisableWrapper { get; set; }
        public bool DisableUnsafe { get; set; }
        public bool HighPerfGpu { get; set; } = true;

        public bool MemoryOptimize { get; set; }
        public bool CheckFiles { get; set; }
    }

    internal sealed class LaunchRequest
    {
        public string GameDir { get; set; } = string.Empty;
        public string VersionId { get; set; } = string.Empty;

        /// <summary>版本隔离：true 时在 versions\&lt;id&gt;\ 里跑，false 时在 .minecraft 根里跑。</summary>
        public bool Isolated { get; set; }

        /// <summary>网页（扫描器算出的）实际工作目录；给了就以它为准，省得两边各算一遍。</summary>
        public string RunDir { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;
        public LaunchAccount Account { get; set; } = new LaunchAccount();
        public LaunchOptions Options { get; set; } = new LaunchOptions();
    }

    /// <summary>启动过程中给网页发消息的出口（Host/LaunchMessages 实现）。</summary>
    internal interface ILaunchReporter
    {
        /// <summary>进度阶段：一句话 + 0~100。</summary>
        void Phase(string text, int percent);

        /// <summary>一行日志。</summary>
        void Log(string line);
    }

    /// <summary>进程起来之后的结果。</summary>
    internal sealed class LaunchRun
    {
        public Process Process { get; init; } = null!;
        public string JavaPath { get; set; } = string.Empty;
        public string CommandLine { get; set; } = string.Empty;
        public string WorkingDir { get; set; } = string.Empty;
        public string GameDir { get; set; } = string.Empty;
        public string VersionId { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.Now;
        public string WindowTitle { get; set; } = string.Empty;

        /// <summary>「进程刚起来就退出」已经被当成启动失败报过了，退出回调不用再报一次。</summary>
        public bool EarlyExitReported { get; set; }
    }

    internal static class GameLauncher
    {
        /// <summary>准备并启动游戏。返回时进程已经在跑；出错抛 HttpError（消息可直接显示）。</summary>
        public static async Task<LaunchRun> LaunchAsync(
            LaunchRequest request, ILaunchReporter reporter, CancellationToken token)
        {
            if (request == null) throw new HttpError("没有启动参数");
            if (string.IsNullOrWhiteSpace(request.GameDir)) throw new HttpError("没有指定游戏目录");
            if (string.IsNullOrWhiteSpace(request.VersionId)) throw new HttpError("没有指定版本");

            string gameDir = Path.GetFullPath(request.GameDir);
            string versionDir = Path.Combine(gameDir, "versions", request.VersionId);
            if (!Directory.Exists(versionDir))
            {
                throw new HttpError("找不到版本目录：versions\\" + request.VersionId);
            }

            var options = request.Options ?? new LaunchOptions();

            /* 1. 版本 JSON 链 --------------------------------------------- */
            reporter.Phase("正在读取版本信息…", 6);
            var spec = LoadSpec(gameDir, request.VersionId, out string rootId);
            reporter.Log("· 版本 " + spec.Id +
                (string.Equals(rootId, spec.Id, StringComparison.OrdinalIgnoreCase)
                    ? string.Empty
                    : "（继承自 " + rootId + "）"));

            /* 2. 检查 / 补齐文件 ------------------------------------------ */
            string runDir = ResolveRunDir(gameDir, versionDir, request);
            var layout = BuildLayout(gameDir, versionDir, runDir, spec);

            var missing = new List<string>();
            var classpath = BuildClasspath(spec, layout, missing);
            // 资源索引缺失也算「文件不全」：少了它游戏能起来，但没声音没语言文件
            AddMissingAssetIndex(spec, layout, missing);

            reporter.Phase("正在检查游戏文件…", 14);
            if (missing.Count > 0)
            {
                reporter.Log("· 发现 " + missing.Count + " 个缺失文件，例如 " + DescribeMissing(missing));
                bool repairTried = false;
                if (options.CheckFiles)
                {
                    reporter.Phase("正在补齐游戏文件…", 18);
                    repairTried = true;
                    if (await TryRepairAsync(gameDir, rootId, spec, layout, missing, reporter, token).ConfigureAwait(false))
                    {
                        missing.Clear();
                        classpath = BuildClasspath(spec, layout, missing);
                        AddMissingAssetIndex(spec, layout, missing);
                    }
                }

                if (missing.Count > 0)
                {
                    throw new HttpError(
                        "这个版本还缺 " + missing.Count + " 个文件（例如 " + DescribeMissing(missing) + "）。\n" +
                        (repairTried
                            ? "启动器试过自动补齐但没成功，具体哪个文件没下来在上面的启动日志里。\n"
                            : "设置里打开「启动前检查更新」可以让启动器自己补。\n") +
                        LoaderHint(missing) +
                        "也可以到「下载」页重新安装一次这个版本。");
                }
            }
            reporter.Log("· 运行库 " + spec.Libraries.Count + " 项，classpath " + classpath.Count + " 条");

            /* 2.5 本地库（natives） --------------------------------------- */
            reporter.Phase("正在准备本地库…", 22);
            PrepareNatives(spec, layout, reporter);

            /* 3. Java ------------------------------------------------------ */
            reporter.Phase("正在查找 Java…", 26);
            int requiredMajor = spec.JavaMajor ?? 8;
            JavaInstall java = ResolveJava(options, requiredMajor);
            reporter.Log("· Java " + java.Version + "（" + java.Path + "）");
            if (requiredMajor > 0 && java.Major - requiredMajor >= 3)
            {
                reporter.Log("· 注意：这个版本要求 Java " + requiredMajor + "，实际用的是 Java " + java.Major +
                    "，加载器和模组可能不兼容；装了对应版本的 Java 就在「版本设置 → Java」里指定。");
            }

            /* 4. 启动前动作（内存优化要先跑，预算检查才看得到优化后的数字） ---- */
            if (options.MemoryOptimize)
            {
                reporter.Phase("正在优化内存…", 30);
                try
                {
                    var result = await MemoryOptimizer.OptimizeAsync(token).ConfigureAwait(false);
                    reporter.Log("· 内存优化：释放 " + FormatSize(result.Freed) +
                        (result.Ok ? string.Empty : "（" + result.Error + "）"));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    reporter.Log("· 内存优化跳过：" + ex.Message);
                }
            }

            /* 5. 内存预算 + 参数 ------------------------------------------- */
            ApplyMemoryBudget(options, reporter);
            reporter.Phase("正在组装启动参数…", 40);
            var command = BuildCommandLine(
                request, spec, layout, classpath, java, requiredMajor, runDir);

            if (options.HighPerfGpu)
            {
                string? gpu = TryApplyHighPerformanceGpu(java.Path);
                if (gpu != null) reporter.Log("· " + gpu);
            }

            if (!string.IsNullOrWhiteSpace(options.PreCommand))
            {
                reporter.Phase("正在执行启动前命令…", 50);
                await RunPreCommandAsync(options.PreCommand, runDir, reporter, token).ConfigureAwait(false);
            }

            token.ThrowIfCancellationRequested();

            /* 6. 起进程 ---------------------------------------------------- */
            reporter.Phase("正在启动 Java 进程…", 62);
            var run = StartProcess(command, java, runDir, reporter);

            run.VersionId = spec.Id;
            run.GameDir = gameDir;
            run.DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? spec.Id : request.DisplayName;
            run.WindowTitle = !string.IsNullOrWhiteSpace(options.WindowTitle)
                ? options.WindowTitle
                : (!string.IsNullOrWhiteSpace(options.CustomInfo) ? options.CustomInfo : "Minecraft " + spec.Id);

            ApplyPriority(run.Process, options.Priority, reporter);
            WatchGameWindow(run);
            WatchProcess(run, reporter);

            /* JVM 参数不合法 / Java 版本不对 / 内存不够时，进程几十毫秒就退出。
               等一下再看一眼，别把「启动完成」报给用户。 */
            reporter.Phase("正在等待游戏窗口…", 96);
            int earlyExit = WaitForEarlyExit(run.Process);
            if (earlyExit != -1)
            {
                run.EarlyExitReported = true;
                ReportGameLog(run, earlyExit, reporter);
                throw new HttpError(
                    "Java 进程刚启动就退出了（退出码 " + earlyExit + "）。\n\n" +
                    "常见原因：JVM 参数这台 Java 不支持、Java 大版本和游戏对不上、" +
                    "分配的内存超过本机可提交额度。\n" +
                    "启动日志里已经抓到 Java 自己打印的报错，照着那一行改就行" +
                    "（JVM 参数在「版本设置 → 启动 → 虚拟机参数」里）。");
            }

            reporter.Phase("游戏进程已启动", 100);
            reporter.Log("· 进程 PID " + run.Process.Id + "，工作目录 " + runDir);
            reporter.Log("· 游戏日志：" + Path.Combine(runDir, "logs", "latest.log"));
            return run;
        }

        /// <summary>进程起来后 900ms 还没退出就返回 -1；退出了就返回退出码。</summary>
        private static int WaitForEarlyExit(Process process)
        {
            try
            {
                if (!process.WaitForExit(900)) return -1;
                return process.ExitCode;
            }
            catch (Exception)
            {
                return -1;
            }
        }

        /* =================================================================
           版本 JSON
           ================================================================= */

        /// <summary>合并后的版本定义（沿 inheritsFrom 链，子版本优先）。</summary>
        private sealed class VersionSpec
        {
            public string Id { get; set; } = string.Empty;

            /// <summary>版本 JSON 里自己写的 id。目录被改成中文名时，这里是还原原版号的唯一线索。</summary>
            public string? JsonId { get; set; }

            public string? MainClass { get; set; }
            public string? Type { get; set; }
            public string? AssetsIndex { get; set; }
            public string? AssetsDir { get; set; }
            public string? JarVersion { get; set; }
            public int? JavaMajor { get; set; }
            public string? LogConfigId { get; set; }
            public string? MinecraftArguments { get; set; }
            public List<JsonElement> Libraries { get; } = new List<JsonElement>();
            public List<JsonElement> JvmArgs { get; } = new List<JsonElement>();
            public List<JsonElement> GameArgs { get; } = new List<JsonElement>();
        }

        private static VersionSpec LoadSpec(string gameDir, string versionId, out string rootId)
        {
            var spec = new VersionSpec { Id = versionId };
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var libraryKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            string current = versionId;
            rootId = versionId;

            while (!string.IsNullOrWhiteSpace(current))
            {
                if (!seen.Add(current))
                {
                    throw new HttpError("版本 JSON 的 inheritsFrom 绕成了环：" + current);
                }

                string nodeId = current;
                string folder = Path.Combine(gameDir, "versions", nodeId);
                string? path = FindVersionJson(folder, nodeId);
                if (path == null)
                {
                    throw new HttpError("缺少版本 JSON：versions\\" + nodeId + "\\" + nodeId + ".json");
                }

                JsonDocument document;
                try
                {
                    document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
                    {
                        AllowTrailingCommas = true,
                        CommentHandling = JsonCommentHandling.Skip
                    });
                }
                catch (JsonException)
                {
                    throw new HttpError("版本 JSON 解析失败：" + path);
                }

                using (document)
                {
                    var body = document.RootElement;
                    if (spec.JsonId == null) spec.JsonId = JsonRead.StringOrNull(body, "id");
                    if (spec.MainClass == null)
                    {
                        spec.MainClass = JsonRead.StringOrNull(body, "mainClass");
                    }
                    if (spec.Type == null) spec.Type = JsonRead.StringOrNull(body, "type");
                    if (spec.JarVersion == null) spec.JarVersion = JsonRead.StringOrNull(body, "jar");
                    if (spec.MinecraftArguments == null)
                    {
                        spec.MinecraftArguments = JsonRead.StringOrNull(body, "minecraftArguments");
                    }

                    if (spec.AssetsIndex == null)
                    {
                        var assetIndex = JsonRead.Object(body, "assetIndex");
                        string indexId = JsonRead.String(assetIndex, "id");
                        if (indexId.Length > 0) spec.AssetsIndex = indexId;
                    }
                    if (spec.AssetsDir == null)
                    {
                        string assets = JsonRead.String(body, "assets");
                        if (assets.Length > 0) spec.AssetsDir = assets;
                    }
                    if (spec.JavaMajor == null)
                    {
                        int major = JsonRead.Int(JsonRead.Object(body, "javaVersion"), "majorVersion");
                        if (major > 0) spec.JavaMajor = major;
                    }
                    if (spec.LogConfigId == null)
                    {
                        var logFile = JsonRead.Object(JsonRead.Object(JsonRead.Object(body, "logging"), "client"), "file");
                        string logId = JsonRead.String(logFile, "id");
                        if (logId.Length > 0) spec.LogConfigId = logId;
                    }

                    // 运行库：按 group:artifact:classifier 去重，子版本已经声明的就不再要父版本的
                    var libraries = JsonRead.Array(body, "libraries");
                    if (libraries.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var library in libraries.EnumerateArray())
                        {
                            string key = LibraryKey(library);
                            if (key.Length > 0 && !libraryKeys.Add(key)) continue;
                            spec.Libraries.Add(library.Clone());
                        }
                    }

                    CollectArguments(JsonRead.Object(body, "arguments"), "jvm", spec.JvmArgs);
                    CollectArguments(JsonRead.Object(body, "arguments"), "game", spec.GameArgs);

                    current = JsonRead.StringOrNull(body, "inheritsFrom") ?? string.Empty;
                    // 走到没有 inheritsFrom 的那一层，就是这次要补文件的基础版本
                    if (current.Length == 0) rootId = nodeId;
                }
            }

            if (string.IsNullOrWhiteSpace(spec.MainClass))
            {
                throw new HttpError("版本 JSON 里没有 mainClass，这个版本启动不了");
            }

            return spec;
        }

        private static void CollectArguments(JsonElement arguments, string name, List<JsonElement> into)
        {
            if (arguments.ValueKind != JsonValueKind.Object) return;
            var list = JsonRead.Array(arguments, name);
            if (list.ValueKind != JsonValueKind.Array) return;
            foreach (var item in list.EnumerateArray()) into.Add(item.Clone());
        }

        /// <summary>
        /// 去重用的键：group:artifact:classifier。
        /// **不能只按 group:artifact** —— 1.20.1 的 libraries 里，同一个
        /// org.lwjgl:lwjgl-glfw 会以 natives-linux / natives-macos / natives-windows …
        /// 出现六次，只留第一个（linux）会让 natives-windows 整个消失：
        /// 解压不出 dll、classpath 里也没有，游戏起来就是 UnsatisfiedLinkError。
        /// 带上 classifier 后，父子版本之间仍然按「同 artifact 同 classifier，子版本赢」去重。
        /// </summary>
        private static string LibraryKey(JsonElement library)
        {
            string name = JsonRead.String(library, "name");
            if (name.Length == 0) return string.Empty;

            string[] parts = name.Split(':');
            if (parts.Length < 3) return name;

            string classifier = parts.Length > 3 ? parts[3] : string.Empty;
            return parts[0] + ":" + parts[1] + ":" + classifier;
        }

        private static string? FindVersionJson(string folder, string versionId)
        {
            if (!Directory.Exists(folder)) return null;

            string direct = Path.Combine(folder, versionId + ".json");
            if (File.Exists(direct)) return direct;

            try
            {
                var candidates = Directory.GetFiles(folder, "*.json")
                    .Where(item => !string.Equals(
                        Path.GetFileName(item), "StarLaunch.instance.json", StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (candidates.Count == 1) return candidates[0];
                var preferred = candidates.FirstOrDefault(item =>
                    string.Equals(Path.GetFileNameWithoutExtension(item), versionId,
                        StringComparison.OrdinalIgnoreCase));
                return preferred;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /* =================================================================
           目录布局
           ================================================================= */

        private sealed class LaunchLayout
        {
            public string LibrariesRoot { get; set; } = string.Empty;
            public string NativesDir { get; set; } = string.Empty;
            public string AssetsRoot { get; set; } = string.Empty;
            public string GameAssetsDir { get; set; } = string.Empty;
            public string AssetsIndex { get; set; } = string.Empty;
            public bool LegacyAssets { get; set; }
            public string ClientJar { get; set; } = string.Empty;
        }

        private static LaunchLayout BuildLayout(
            string gameDir, string versionDir, string runDir, VersionSpec spec)
        {
            var layout = new LaunchLayout
            {
                LibrariesRoot = Path.Combine(gameDir, "libraries"),
                NativesDir = Path.Combine(versionDir, "natives"),
                AssetsRoot = Path.Combine(gameDir, "assets"),
                AssetsIndex = spec.AssetsIndex ?? "legacy"
            };

            // pre-1.6 的资源是按名字散在 assets\virtual\legacy 下的
            layout.LegacyAssets = string.Equals(spec.AssetsDir, "pre-1.6", StringComparison.OrdinalIgnoreCase);
            layout.GameAssetsDir = layout.LegacyAssets
                ? Path.Combine(layout.AssetsRoot, "virtual", layout.AssetsIndex)
                : layout.AssetsRoot;

            Directory.CreateDirectory(layout.NativesDir);

            string jarId = string.IsNullOrWhiteSpace(spec.JarVersion) ? spec.Id : spec.JarVersion!;
            string ownJar = Path.Combine(versionDir, spec.Id + ".jar");
            string inheritedJar = Path.Combine(gameDir, "versions", jarId, jarId + ".jar");
            layout.ClientJar = File.Exists(ownJar) ? ownJar : inheritedJar;

            return layout;
        }

        /// <summary>
        /// 游戏实际的工作目录。网页会把它算好的那个发过来（扫描器和它用的是同一套规则），
        /// 这里只负责确认它确实在这个游戏目录里面 —— 不能让它指到别处去。
        /// </summary>
        private static string ResolveRunDir(string gameDir, string versionDir, LaunchRequest request)
        {
            string candidate = (request.RunDir ?? string.Empty).Trim();
            if (candidate.Length > 0)
            {
                try
                {
                    string full = Path.GetFullPath(candidate);
                    string prefix = gameDir.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
                    if (full.Equals(gameDir, StringComparison.OrdinalIgnoreCase) ||
                        full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        return full;
                    }
                }
                catch (Exception)
                {
                    // 路径非法就退回按隔离开关算
                }
            }
            return request.Isolated ? versionDir : gameDir;
        }

        private static string DescribeMissing(List<string> missing)
        {
            var names = missing.Take(3).Select(item => Path.GetFileName(item)).ToList();
            string text = string.Join("、", names);
            return missing.Count > 3 ? text + "…" : text;
        }

        /// <summary>缺的是加载器自己的运行库时，补一句「重装加载器」的提示。</summary>
        private static string LoaderHint(List<string> missing)
        {
            bool loader = missing.Any(path =>
                path.IndexOf("fabric", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf("quilt", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf("forge", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf("mixin", StringComparison.OrdinalIgnoreCase) >= 0);

            return loader
                ? "缺的里面有加载器（Forge / Fabric）自己的运行库，原版安装补不到这些，要到「下载」页重装一次加载器。\n"
                : string.Empty;
        }

        /* =================================================================
           运行库 / classpath
           ================================================================= */

        private static List<string> BuildClasspath(
            VersionSpec spec, LaunchLayout layout, List<string> missing)
        {
            var entries = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var library in spec.Libraries)
            {
                if (!RuleAllows(library)) continue;

                // 老版本把本地库放在 classifiers 里，那些不是 classpath 条目
                string path = LibraryPath(library);
                if (path.Length == 0) continue;

                string full = Path.Combine(layout.LibrariesRoot, path.Replace('/', Path.DirectorySeparatorChar));
                if (!seen.Add(full)) continue;

                if (!File.Exists(full))
                {
                    missing.Add(full);
                    continue;
                }
                entries.Add(full);
            }

            if (!string.IsNullOrEmpty(layout.ClientJar))
            {
                if (File.Exists(layout.ClientJar)) entries.Add(layout.ClientJar);
                else missing.Add(layout.ClientJar);
            }

            return entries;
        }

        /// <summary>运行库在 libraries\ 下的相对路径：优先 downloads.artifact.path，没有就从坐标推。</summary>
        private static string LibraryPath(JsonElement library)
        {
            string declared = JsonRead.String(JsonRead.Object(JsonRead.Object(library, "downloads"), "artifact"), "path");
            if (declared.Length > 0) return declared;

            // 只带 classifiers 的老式 natives 库：jar 里只有 dll，不该进 classpath，
            // 也不能靠坐标推一个不存在的路径出来（否则会被当成「文件缺失」）
            if (JsonRead.Object(library, "natives").ValueKind == JsonValueKind.Object) return string.Empty;

            string name = JsonRead.String(library, "name");
            if (name.Length == 0) return string.Empty;

            string[] parts = name.Split(':');
            if (parts.Length < 3) return string.Empty;

            string group = parts[0].Replace('.', '/');
            string artifact = parts[1];
            string version = parts[2];
            string classifier = parts.Length > 3 ? "-" + parts[3] : string.Empty;
            return group + "/" + artifact + "/" + version + "/" + artifact + "-" + version + classifier + ".jar";
        }

        /* =================================================================
           本地库（natives）
           =================================================================
           原生库（lwjgl.dll / glfw.dll / jemalloc.dll…）在 lwjgl-*-natives-windows.jar
           里，必须解压到一个目录并用 -Djava.library.path 指过去。以前这里只是把
           natives_directory 指到 versions\<版本>\natives，却从来没解压过——
           目录不存在，游戏起来就 UnsatisfiedLinkError: no lwjgl in java.library.path。
           ================================================================= */

        private static void PrepareNatives(VersionSpec spec, LaunchLayout layout, ILaunchReporter reporter)
        {
            try
            {
                var jars = new List<string>();
                foreach (var library in spec.Libraries)
                {
                    if (!RuleAllows(library)) continue;
                    string relative = NativeJarPath(library);
                    if (relative.Length == 0) continue;

                    string full = Path.Combine(layout.LibrariesRoot, relative.Replace('/', Path.DirectorySeparatorChar));
                    if (File.Exists(full) && !jars.Contains(full)) jars.Add(full);
                }

                if (jars.Count == 0) return;
                Directory.CreateDirectory(layout.NativesDir);

                // jar 没变过（大小 + 修改时间一致）就不重复解压
                string stampFile = Path.Combine(layout.NativesDir, ".natives-stamp");
                string signature = string.Join("|", jars.Select(file =>
                    file + ":" + new FileInfo(file).Length + ":" + File.GetLastWriteTimeUtc(file).Ticks));
                try
                {
                    if (File.Exists(stampFile) && File.ReadAllText(stampFile) == signature) return;
                }
                catch (Exception)
                {
                    // 读不了就老老实实重解一遍
                }

                int written = 0;
                foreach (string jar in jars)
                {
                    written += ExtractNativesFromJar(jar, layout.NativesDir);
                }

                try { File.WriteAllText(stampFile, signature); } catch (Exception) { }
                if (written > 0) reporter.Log("· 本地库 " + written + " 个文件已就位（natives）");
            }
            catch (Exception ex)
            {
                // 解压失败就别拦着启动，让 JVM 自己报错更明确
                reporter.Log("· 本地库解压失败：" + ex.Message);
            }
        }

        /// <summary>这个库对应的 natives jar 在 libraries\ 下的相对路径；不是 natives 库就是空串。</summary>
        private static string NativeJarPath(JsonElement library)
        {
            var downloads = JsonRead.Object(library, "downloads");
            bool x64 = Environment.Is64BitProcess;

            // 老格式（1.12 及更早）：natives.windows = "natives-windows-${arch}"
            var natives = JsonRead.Object(library, "natives");
            if (natives.ValueKind == JsonValueKind.Object)
            {
                string key = JsonRead.String(natives, "windows");
                if (key.Length == 0) return string.Empty;
                key = key.Replace("${arch}", x64 ? "64" : "32");

                string path = JsonRead.String(JsonRead.Object(JsonRead.Object(downloads, "classifiers"), key), "path");
                return path.Length > 0 ? path : string.Empty;
            }

            // 新格式：natives 作为独立库，坐标第四段就是 natives-windows / -arm64 / -x86
            string name = JsonRead.String(library, "name");
            string[] parts = name.Split(':');
            if (parts.Length < 4) return string.Empty;

            string classifier = parts[3];
            if (!classifier.StartsWith("natives-windows", StringComparison.OrdinalIgnoreCase)) return string.Empty;

            string wanted = x64 ? "natives-windows" : "natives-windows-x86";
            if (!classifier.Equals(wanted, StringComparison.OrdinalIgnoreCase)) return string.Empty;

            string declared = JsonRead.String(JsonRead.Object(downloads, "artifact"), "path");
            return declared;
        }

        /// <summary>把 jar 里的 dll 解到目标目录（扁平化，跳过 META-INF 之类的说明文件）。</summary>
        private static int ExtractNativesFromJar(string jarPath, string targetDir)
        {
            int written = 0;
            try
            {
                using var archive = System.IO.Compression.ZipFile.OpenRead(jarPath);
                foreach (var entry in archive.Entries)
                {
                    if (string.IsNullOrEmpty(entry.Name)) continue;
                    if (!entry.Name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) continue;

                    string name = entry.Name;
                    if (name.Equals("META-INF", StringComparison.OrdinalIgnoreCase)) continue;

                    string target = Path.Combine(targetDir, name);
                    try
                    {
                        entry.ExtractToFile(target, true);
                        written++;
                    }
                    catch (Exception)
                    {
                        // 被占着（游戏还开着）就跳过，下次启动再说
                    }
                }
            }
            catch (Exception)
            {
                // 坏包 / 不是 zip：跳过
            }
            return written;
        }

        /// <summary>平台的 rules 判定：没有 rules 就是通用；有 rules 时最后一条匹配的说了算。</summary>
        private static bool RuleAllows(JsonElement item)
        {
            var rules = JsonRead.Array(item, "rules");
            if (rules.ValueKind != JsonValueKind.Array) return true;

            bool allow = false;
            foreach (var rule in rules.EnumerateArray())
            {
                if (!RuleMatches(rule)) continue;
                allow = string.Equals(JsonRead.String(rule, "action"), "allow", StringComparison.OrdinalIgnoreCase);
            }
            return allow;
        }

        private static bool RuleMatches(JsonElement rule)
        {
            var os = JsonRead.Object(rule, "os");
            if (os.ValueKind == JsonValueKind.Object)
            {
                string name = JsonRead.String(os, "name");
                if (name.Length > 0 && !name.Equals("windows", StringComparison.OrdinalIgnoreCase)) return false;

                string arch = JsonRead.String(os, "arch");
                if (arch.Length > 0)
                {
                    string actual = Environment.Is64BitProcess ? "x86_64" : "x86";
                    if (!arch.Equals(actual, StringComparison.OrdinalIgnoreCase)) return false;
                }
            }

            // 我们自己会传窗口宽高，所以 has_custom_resolution 条件当作成立；
            // is_demo_user 之类的演示特性一律不成立
            var features = JsonRead.Object(rule, "features");
            if (features.ValueKind == JsonValueKind.Object)
            {
                foreach (var feature in features.EnumerateObject())
                {
                    bool wanted = feature.Value.ValueKind == JsonValueKind.True;
                    bool have = feature.Name.Equals("has_custom_resolution", StringComparison.OrdinalIgnoreCase);
                    if (wanted != have) return false;
                }
            }

            return true;
        }

        /* =================================================================
           命令行
           ================================================================= */

        private sealed class CommandLine
        {
            public List<string> Jvm { get; } = new List<string>();
            public List<string> Game { get; } = new List<string>();
            public string MainClass { get; set; } = string.Empty;
        }

        private static CommandLine BuildCommandLine(
            LaunchRequest request, VersionSpec spec, LaunchLayout layout, List<string> classpath,
            JavaInstall java, int requiredMajor, string runDir)
        {
            var options = request.Options ?? new LaunchOptions();
            var account = request.Account ?? new LaunchAccount();

            string classpathText = string.Join(";", classpath);
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["classpath"] = classpathText,
                ["classpath_separator"] = ";",
                ["library_directory"] = layout.LibrariesRoot,
                ["natives_directory"] = layout.NativesDir,
                ["launcher_name"] = "StarLaunch",
                ["launcher_version"] = LauncherVersion,
                ["version_name"] = spec.Id,
                ["version_type"] = string.IsNullOrWhiteSpace(spec.Type) ? "release" : spec.Type!,
                ["game_directory"] = runDir,
                ["assets_root"] = layout.GameAssetsDir,
                ["assets_index_name"] = layout.AssetsIndex,
                ["game_assets"] = layout.GameAssetsDir,
                ["auth_player_name"] = account.Name,
                ["auth_uuid"] = account.Uuid,
                ["auth_access_token"] = account.AccessToken,
                ["auth_session"] = account.AccessToken,
                ["auth_xuid"] = account.Xuid ?? string.Empty,
                ["clientid"] = account.ClientId ?? string.Empty,
                ["user_type"] = UserType(account.Type),
                ["user_properties"] = "{}",
                ["resolution_width"] = options.WindowWidth.ToString(CultureInfo.InvariantCulture),
                ["resolution_height"] = options.WindowHeight.ToString(CultureInfo.InvariantCulture)
            };

            var command = new CommandLine { MainClass = spec.MainClass ?? "net.minecraft.client.main.Main" };

            /* JVM 参数：先放 JSON 里的，再补我们自己的 --------------------- */
            foreach (string argument in ResolveArguments(spec.JvmArgs))
            {
                command.Jvm.Add(Substitute(argument, values));
            }

            if (!command.Jvm.Any(item => item == "-cp" || item == "-classpath"))
            {
                command.Jvm.Add("-cp");
                command.Jvm.Add(classpathText);
            }
            if (!command.Jvm.Any(item => item.StartsWith("-Djava.library.path", StringComparison.Ordinal)))
            {
                command.Jvm.Add("-Djava.library.path=" + layout.NativesDir);
            }
            if (!command.Jvm.Any(item => item.StartsWith("-Xmx", StringComparison.OrdinalIgnoreCase)))
            {
                int memory = Math.Max(256, options.MemoryMb);
                command.Jvm.Add("-Xmx" + memory + "M");
                command.Jvm.Add("-Xms" + Math.Min(memory, 1024) + "M");
            }

            foreach (string argument in MemoryManagerArgs(options.MemoryManager, requiredMajor, options.MemoryMb))
            {
                command.Jvm.Add(argument);
            }

            string brand = string.IsNullOrWhiteSpace(options.CustomInfo) ? "StarLaunch" : options.CustomInfo!;
            command.Jvm.Add("-Dminecraft.launcher.brand=" + brand);
            command.Jvm.Add("-Dminecraft.launcher.version=" + LauncherVersion);
            // 老版 log4j 的 JNDI 漏洞开关，官方启动器也会带
            command.Jvm.Add("-Dlog4j2.formatMsgNoLookups=true");

            /* 老 Forge 的兼容开关：这两个就是 PCL 说的「Launch Wrapper 兼容」那套，
               关掉表示「我不要启动器替我加任何兼容参数」 */
            if (!options.DisableWrapper)
            {
                AddIfMissing(command.Jvm, "-Dfml.ignoreInvalidMinecraftCertificates=true");
                AddIfMissing(command.Jvm, "-Dfml.ignorePatchDiscrepancies=true");
            }

            /* Java 24 移除了 Unsafe 的内存访问方法，LWJGL 需要显式放行，
               否则一进游戏就崩。这就是「LWJGL Unsafe Agent」开关。 */
            if (!options.DisableUnsafe && java.Major >= 24)
            {
                AddIfMissing(command.Jvm, "--sun-misc-unsafe-memory-access=allow");
            }

            foreach (string argument in SplitArgs(options.JvmArgs))
            {
                if (!command.Jvm.Contains(argument)) command.Jvm.Add(argument);
            }

            // 用户（或版本 JSON）自己写了实验参数时，补一个解锁开关：
            // 漏了它 JVM 会直接「Improperly specified VM option」退出
            EnsureExperimentalUnlock(command.Jvm);

            /* 游戏参数 ---------------------------------------------------- */
            if (spec.GameArgs.Count > 0)
            {
                foreach (string argument in ResolveArguments(spec.GameArgs))
                {
                    command.Game.Add(Substitute(argument, values));
                }
            }
            else if (!string.IsNullOrWhiteSpace(spec.MinecraftArguments))
            {
                foreach (string argument in SplitArgs(spec.MinecraftArguments))
                {
                    command.Game.Add(Substitute(argument, values));
                }
            }

            if (!command.Game.Contains("--width"))
            {
                var (width, height) = ResolveWindowSize(options);
                command.Game.Add("--width");
                command.Game.Add(width.ToString(CultureInfo.InvariantCulture));
                command.Game.Add("--height");
                command.Game.Add(height.ToString(CultureInfo.InvariantCulture));
            }

            foreach (string argument in SplitArgs(options.GameArgs))
            {
                command.Game.Add(argument);
            }

            /* 日志配置：缺失不影响启动，只是日志格式回到默认 --------------- */
            if (!string.IsNullOrWhiteSpace(spec.LogConfigId))
            {
                string logFile = Path.Combine(layout.AssetsRoot, "log_configs", spec.LogConfigId!);
                if (File.Exists(logFile))
                {
                    AddIfMissing(command.Jvm, "-Dlog4j.configurationFile=" + logFile);
                }
            }

            return command;
        }

        /// <summary>
        /// 分配的内存超过「本机还能提交多少」时先提醒一句。JVM 申请堆内存看的是
        /// 物理内存 + 页面文件的总提交额度，页面文件被吃完时物理内存再空也起不来。
        /// 只提醒不改用户设置：自动动 -Xmx 比启动失败更难解释。
        /// </summary>
        /// <summary>最少要留给游戏的堆；再低就没法玩了。</summary>
        private const int MinHeapMb = 1024;

        /// <summary>留给 JVM 自己的元空间 / 代码缓存 / 线程栈的余量。</summary>
        private const int CommitReserveMb = 512;

        /// <summary>
        /// 启动前的内存预算。JVM 申请堆内存看的是「还能提交多少」（物理内存 + 页面文件），
        /// 不是「还剩多少物理内存」——页面文件太小或者被别的程序吃光时，
        /// 物理内存再空，Java 也会以 1455『页面文件太小』退出。
        ///
        /// 够得着就临时把堆降下来（只影响这次启动，不改用户的设置）；
        /// 连最低要求都塞不下就直接报错，把「怎么解决」写清楚。
        /// </summary>
        private static void ApplyMemoryBudget(LaunchOptions options, ILaunchReporter reporter)
        {
            if (!MemoryOptimizer.TryReadCommit(out long availableBytes, out long limitBytes)) return;

            int requested = Math.Max(256, options.MemoryMb);
            long availableMb = availableBytes / (1024L * 1024L);
            long roomMb = availableMb - CommitReserveMb;
            if (requested <= roomMb) return;

            if (roomMb >= MinHeapMb)
            {
                options.MemoryMb = (int)Math.Min(requested, roomMb);
                reporter.Log("· 本机可提交内存只剩 " + FormatSize(availableBytes) + "，已把堆内存从 " +
                    requested + " MB 临时降到 " + options.MemoryMb + " MB（只影响这次启动，设置没改）");
                return;
            }

            throw new HttpError(DescribeMemoryShortage(availableBytes, limitBytes, requested));
        }

        /// <summary>一句话说清「为什么起不来 + 该怎么办」，顺带列出当前吃内存最多的进程。</summary>
        private static string DescribeMemoryShortage(long availableBytes, long limitBytes, int requestedMb)
        {
            var text = new StringBuilder();
            text.AppendLine("本机现在没有足够的可提交内存启动 Java：");
            text.AppendLine("· 这次要分配 " + requestedMb + " MB 堆内存；");
            text.AppendLine("· 系统只剩 " + FormatSize(availableBytes) + " 可提交（提交上限 " + FormatSize(limitBytes) + "）。");

            if (MemoryOptimizer.TryReadMemory(out long physical, out _))
            {
                long pageFile = Math.Max(0, limitBytes - physical);
                if (pageFile < 1024L * 1024 * 1024)
                {
                    text.AppendLine("· 本机的虚拟内存（页面文件）只有 " + FormatSize(pageFile) +
                        "，基本等于没开——Java 一要提交内存，Windows 就报 1455「页面文件太小」。");
                }
            }

            string hogs = DescribeCommitHogs();
            if (hogs.Length > 0) text.AppendLine("· 现在占得最多的是：" + hogs + "。");

            text.AppendLine();
            text.AppendLine("按这个顺序处理，通常第一条就能解决：");
            text.AppendLine("1. 调大虚拟内存：Win+R 输入 SystemPropertiesAdvanced → 高级 → 性能「设置」→ 高级 → 虚拟内存「更改」，" +
                "取消「自动管理所有驱动器的分页文件大小」，选一个空间充足的盘，自定义 8192～16384 MB，确定后重启；");
            text.AppendLine("2. 关掉上面列出的那些程序（浏览器、IDE、虚拟机最占）；");
            text.AppendLine("3. 把这个版本的内存分配降下来：原版 1.20.1 给 2048～4096 MB 就够，装了大量模组再往上加。");
            return text.ToString();
        }

        /// <summary>占提交内存最多的几个进程（按进程名合并），读不到就返回空串。</summary>
        private static string DescribeCommitHogs()
        {
            Process[] processes;
            try
            {
                processes = Process.GetProcesses();
            }
            catch (Exception)
            {
                return string.Empty;
            }

            try
            {
                var totals = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
                foreach (var process in processes)
                {
                    try
                    {
                        long bytes = process.PrivateMemorySize64;
                        if (bytes <= 0) continue;
                        totals.TryGetValue(process.ProcessName, out long sum);
                        totals[process.ProcessName] = sum + bytes;
                    }
                    catch (Exception)
                    {
                        // 受保护的系统进程读不到，跳过
                    }
                }

                var top = totals
                    .Where(pair => pair.Value >= 256L * 1024 * 1024)
                    .OrderByDescending(pair => pair.Value)
                    .Take(5)
                    .Select(pair => pair.Key + " " + FormatSize(pair.Value))
                    .ToList();

                return string.Join("、", top);
            }
            finally
            {
                foreach (var process in processes)
                {
                    try { process.Dispose(); } catch (Exception) { }
                }
            }
        }

        private static (int Width, int Height) ResolveWindowSize(LaunchOptions options)
        {
            string mode = (options.WindowMode ?? "custom").Trim().ToLowerInvariant();

            // 默认尺寸 = 原版默认的 854×480
            if (mode == "default") return (854, 480);

            if (mode != "custom")
            {
                // 最大化 / 全屏都按屏幕来（原版没有命令行全屏开关，真正的全屏还是 F11）
                try
                {
                    int screenWidth = (int)System.Windows.SystemParameters.PrimaryScreenWidth;
                    int screenHeight = (int)System.Windows.SystemParameters.PrimaryScreenHeight;
                    return (Math.Max(320, screenWidth), Math.Max(240, screenHeight));
                }
                catch (Exception)
                {
                    return (854, 480);
                }
            }

            int width = options.WindowWidth;
            int height = options.WindowHeight;
            if (width < 320) width = 854;
            if (height < 240) height = 480;
            return (width, height);
        }

        private static void AddIfMissing(List<string> list, string value)
        {
            if (!list.Contains(value)) list.Add(value);
        }

        private static string UserType(string? type)
        {
            switch ((type ?? "offline").Trim().ToLowerInvariant())
            {
                case "ms":
                    return "msa";
                case "authlib":
                    return "mojang";
                default:
                    return "legacy";
            }
        }

        /// <summary>arguments 数组里可能混着字符串和 { rules, value } 对象。</summary>
        private static List<string> ResolveArguments(List<JsonElement> entries)
        {
            var result = new List<string>(entries.Count);
            foreach (var entry in entries)
            {
                if (entry.ValueKind == JsonValueKind.String)
                {
                    string? text = entry.GetString();
                    if (!string.IsNullOrEmpty(text)) result.Add(text!);
                    continue;
                }
                if (entry.ValueKind != JsonValueKind.Object) continue;
                if (!RuleAllows(entry)) continue;

                var value = JsonRead.Array(entry, "value");
                if (value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in value.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.String) continue;
                        string? text = item.GetString();
                        if (!string.IsNullOrEmpty(text)) result.Add(text!);
                    }
                    continue;
                }

                string single = JsonRead.String(entry, "value");
                if (single.Length > 0) result.Add(single);
            }
            return result;
        }

        private static string Substitute(string text, Dictionary<string, string> values)
        {
            if (text.IndexOf("${", StringComparison.Ordinal) < 0) return text;

            var builder = new StringBuilder(text.Length + 32);
            int index = 0;
            while (index < text.Length)
            {
                int start = text.IndexOf("${", index, StringComparison.Ordinal);
                if (start < 0)
                {
                    builder.Append(text, index, text.Length - index);
                    break;
                }
                int end = text.IndexOf('}', start + 2);
                if (end < 0)
                {
                    builder.Append(text, index, text.Length - index);
                    break;
                }

                builder.Append(text, index, start - index);
                string key = text.Substring(start + 2, end - start - 2);
                builder.Append(values.TryGetValue(key, out string? replacement) ? replacement : string.Empty);
                index = end + 1;
            }
            return builder.ToString();
        }

        /// <summary>按空格切参数，双引号里的空格不切（用户自己填的 JVM / 游戏参数用）。</summary>
        internal static List<string> SplitArgs(string? text)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(text)) return result;

            var current = new StringBuilder();
            bool quoted = false;
            foreach (char ch in text!)
            {
                if (ch == '"')
                {
                    quoted = !quoted;
                    continue;
                }
                if (!quoted && char.IsWhiteSpace(ch))
                {
                    if (current.Length > 0)
                    {
                        result.Add(current.ToString());
                        current.Clear();
                    }
                    continue;
                }
                current.Append(ch);
            }
            if (current.Length > 0) result.Add(current.ToString());
            return result;
        }

        /// <summary>已知需要 -XX:+UnlockExperimentalVMOptions 才能用的参数（不带前导 -XX:）。</summary>
        private static readonly string[] ExperimentalOptions =
        {
            "G1NewSizePercent", "G1MaxNewSizePercent", "G1MixedGCLiveThresholdPercent",
            "ZGenerational", "ShenandoahGCMode", "ShenandoahGarbageThreshold"
        };

        /// <summary>命令行里有实验参数却没有解锁开关时，把解锁开关补到最前面。</summary>
        private static void EnsureExperimentalUnlock(List<string> jvm)
        {
            const string unlock = "-XX:+UnlockExperimentalVMOptions";
            if (jvm.Contains(unlock)) return;

            foreach (string argument in jvm)
            {
                if (!argument.StartsWith("-XX:", StringComparison.Ordinal)) continue;

                foreach (string name in ExperimentalOptions)
                {
                    if (argument.IndexOf(name, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    jvm.Insert(0, unlock);
                    return;
                }
            }
        }

        private static List<string> MemoryManagerArgs(string? mode, int javaMajor, int memoryMb)
        {
            var args = new List<string>();
            switch ((mode ?? "g1").Trim().ToLowerInvariant())
            {
                case "g1":
                    // G1NewSizePercent 是实验参数，必须先解锁，否则 JVM 直接
                    // 「Improperly specified VM option」退出（PCL 也是这么排的）
                    args.Add("-XX:+UnlockExperimentalVMOptions");
                    args.Add("-XX:+UseG1GC");
                    args.Add("-XX:G1NewSizePercent=20");
                    args.Add("-XX:G1ReservePercent=20");
                    args.Add("-XX:MaxGCPauseMillis=50");
                    args.Add("-XX:G1HeapRegionSize=" + (memoryMb >= 8192 ? "32" : "16") + "M");
                    args.Add("-XX:+ParallelRefProcEnabled");
                    args.Add("-XX:+DisableExplicitGC");
                    break;
                case "zgc":
                    if (javaMajor >= 17) args.Add("-XX:+UseZGC");
                    // 分代 ZGC 是 Java 21 引入的实验特性（21/22 都要先解锁），
                    // 23 之后变成默认并移除了这个开关
                    if (javaMajor == 21 || javaMajor == 22)
                    {
                        args.Add("-XX:+UnlockExperimentalVMOptions");
                        args.Add("-XX:+ZGenerational");
                    }
                    break;
                case "shenandoah":
                    if (javaMajor >= 11) args.Add("-XX:+UseShenandoahGC");
                    break;
                case "none":
                case "g1-default":
                default:
                    // 什么都不加，交给 JVM 默认
                    break;
            }
            return args;
        }

        /* =================================================================
           Java
           ================================================================= */

        private static JavaInstall ResolveJava(LaunchOptions options, int requiredMajor)
        {
            // 1. 版本设置里手填的路径（java.exe 或 JDK 目录）
            string configured = (options.JavaPath ?? string.Empty).Trim();
            if (configured.Length > 0 &&
                !configured.Equals("auto", StringComparison.OrdinalIgnoreCase))
            {
                string? resolved = ResolveJavaPath(configured);
                if (resolved != null)
                {
                    var install = ProbeJava(resolved);
                    if (install != null) return install;
                }
            }

            // 2. 版本 JSON 要求的版本
            var best = JavaRuntime.Best(requiredMajor);
            if (best != null) return best;

            // 3. 全局「Java 列表」里选的那个大版本
            int hinted = ParseJavaHint(options.JavaHint);
            if (hinted > 0)
            {
                best = JavaRuntime.Best(hinted);
                if (best != null) return best;
            }

            // 4. 实在没有：给一台能跑的最低版本，让用户看到明确的报错
            best = JavaRuntime.Best(8);
            if (best != null && requiredMajor <= 0) return best;

            string detail = JavaRuntime.Describe();
            throw new HttpError(
                "没有找到这个版本需要的 Java " + requiredMajor + "。\n\n" +
                detail + "\n\n" +
                "可以装一个 Java " + requiredMajor +
                "（Adoptium / Microsoft OpenJDK 都行），或者在「版本设置 → Java」里手动指定 java.exe 的路径。");
        }

        private static int ParseJavaHint(string? hint)
        {
            if (string.IsNullOrWhiteSpace(hint)) return 0;
            var digits = new System.Text.StringBuilder();
            foreach (char ch in hint!)
            {
                if (char.IsDigit(ch))
                {
                    digits.Append(ch);
                }
                else if (digits.Length > 0)
                {
                    break;
                }
            }
            return digits.Length > 0 && int.TryParse(digits.ToString(), out int major) ? major : 0;
        }

        /// <summary>把手填的路径收敛成 java.exe：给目录就往 bin 里找。</summary>
        private static string? ResolveJavaPath(string value)
        {
            try
            {
                if (File.Exists(value)) return value;
                if (!Directory.Exists(value)) return null;

                foreach (string exe in new[] { "java.exe", "javaw.exe" })
                {
                    string direct = Path.Combine(value, exe);
                    if (File.Exists(direct)) return direct;

                    string inBin = Path.Combine(value, "bin", exe);
                    if (File.Exists(inBin)) return inBin;
                }
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>读某个 java.exe 的版本号（手填路径那一台用；实现见 JavaRuntime）。</summary>
        private static JavaInstall? ProbeJava(string path)
        {
            return JavaRuntime.Read(path);
        }

        /* =================================================================
           进程
           ================================================================= */

        private static LaunchRun StartProcess(
            CommandLine command, JavaInstall java, string workingDir, ILaunchReporter reporter)
        {
            string exe = PreferConsoleJava(java.Path);

            var start = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = workingDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            foreach (string argument in command.Jvm) start.ArgumentList.Add(argument);
            start.ArgumentList.Add(command.MainClass);
            foreach (string argument in command.Game) start.ArgumentList.Add(argument);

            reporter.Log("· " + exe);
            // classpath 很长，日志里只留开头，免得把界面顶爆
            reporter.Log("· " + Shorten(DescribeCommand(start), 600));

            Process process;
            try
            {
                process = Process.Start(start) ?? throw new HttpError("Java 进程没有启动起来");
            }
            catch (Exception ex)
            {
                throw new HttpError("启动 Java 失败：" + ex.Message + "\n\nJava 路径：" + exe);
            }

            return new LaunchRun
            {
                Process = process,
                JavaPath = exe,
                CommandLine = DescribeCommand(start),
                WorkingDir = workingDir,
                StartedAt = DateTimeOffset.Now
            };
        }

        /// <summary>
        /// 用 java.exe 而不是 javaw.exe：只有前者能把 stdout 接到管道上，
        /// 网页才看得到真实的启动日志。CreateNoWindow 保证不会闪黑框。
        /// </summary>
        private static string PreferConsoleJava(string path)
        {
            try
            {
                string folder = Path.GetDirectoryName(path) ?? string.Empty;
                string console = Path.Combine(folder, "java.exe");
                if (File.Exists(console)) return console;
            }
            catch (Exception)
            {
                // 保持原样
            }
            return path;
        }

        private static string DescribeCommand(ProcessStartInfo start)
        {
            var builder = new StringBuilder();
            builder.Append('"').Append(start.FileName).Append('"');
            foreach (string argument in start.ArgumentList)
            {
                builder.Append(' ');
                builder.Append(argument.IndexOf(' ') >= 0 ? "\"" + argument + "\"" : argument);
            }
            return builder.ToString();
        }

        private static void ApplyPriority(Process process, string? priority, ILaunchReporter reporter)
        {
            try
            {
                switch ((priority ?? "normal").Trim().ToLowerInvariant())
                {
                    case "high":
                        process.PriorityClass = ProcessPriorityClass.High;
                        break;
                    case "above":
                        process.PriorityClass = ProcessPriorityClass.AboveNormal;
                        break;
                    case "below":
                        process.PriorityClass = ProcessPriorityClass.BelowNormal;
                        break;
                    default:
                        process.PriorityClass = ProcessPriorityClass.Normal;
                        break;
                }
            }
            catch (Exception ex)
            {
                reporter.Log("· 设置进程优先级失败：" + ex.Message);
            }
        }

        /// <summary>把游戏的主窗口标题改成用户设置的那个（原版没有命令行开关）。</summary>
        private static void WatchGameWindow(LaunchRun run)
        {
            if (string.IsNullOrWhiteSpace(run.WindowTitle)) return;

            _ = Task.Run(async () =>
            {
                var deadline = DateTimeOffset.Now.AddSeconds(120);
                while (DateTimeOffset.Now < deadline)
                {
                    try
                    {
                        if (run.Process.HasExited) return;
                        run.Process.Refresh();
                        IntPtr handle = run.Process.MainWindowHandle;
                        if (handle != IntPtr.Zero)
                        {
                            SetWindowText(handle, run.WindowTitle);
                            return;
                        }
                    }
                    catch (Exception)
                    {
                        return;
                    }
                    await Task.Delay(400).ConfigureAwait(false);
                }
            });
        }

        /// <summary>转发游戏输出、退出时记时长。</summary>
        private static void WatchProcess(LaunchRun run, ILaunchReporter reporter)
        {
            var process = run.Process;

            if (process.StartInfo.RedirectStandardOutput)
            {
                process.OutputDataReceived += (_, e) =>
                {
                    if (!string.IsNullOrWhiteSpace(e.Data)) reporter.Log(e.Data!);
                };
                process.ErrorDataReceived += (_, e) =>
                {
                    if (!string.IsNullOrWhiteSpace(e.Data)) reporter.Log(e.Data!);
                };
                try
                {
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                }
                catch (Exception)
                {
                    // 拿不到输出就算了，不影响游戏
                }
            }

            PlayStats.BeginSession(run.GameDir, run.VersionId, run.DisplayName, run.StartedAt);

            _ = Task.Run(async () =>
            {
                try
                {
                    await process.WaitForExitAsync().ConfigureAwait(false);
                }
                catch (Exception)
                {
                    // 进程对象已经被释放
                }

                var elapsed = DateTimeOffset.Now - run.StartedAt;
                int exitCode = -1;
                try
                {
                    exitCode = process.ExitCode;
                }
                catch (Exception)
                {
                    // 拿不到退出码
                }

                PlayStats.EndSession(run.GameDir, run.VersionId, run.StartedAt, elapsed);

                if (run.EarlyExitReported)
                {
                    // 启动阶段已经把「刚起来就退出」当成失败报过了，别再补一条退出回执
                    return;
                }

                reporter.Log("· 游戏已退出（退出码 " + exitCode + "，本次 " +
                    PlayStats.FormatDuration((long)elapsed.TotalSeconds) + "）");
                ReportEarlyCrash(run, exitCode, elapsed, reporter);
                ReportGameLog(run, exitCode, reporter);
                (reporter as ILaunchExitReporter)?.Exited(run, exitCode, elapsed);
            });
        }

        /// <summary>
        /// 进程起来没几秒就挂掉时，把 JVM 自己写的 hs_err 日志里的结论抄一行到界面上。
        /// 否则用户只看到「退出码 1」，而真正的原因（多数是内存 / 页面文件不够）在
        /// hs_err_pid*.log 里躺着。
        /// </summary>
        private static void ReportEarlyCrash(
            LaunchRun run, int exitCode, TimeSpan elapsed, ILaunchReporter reporter)
        {
            if (exitCode == 0) return;
            if (elapsed > TimeSpan.FromSeconds(20)) return;

            try
            {
                string dir = string.IsNullOrWhiteSpace(run.WorkingDir) ? run.GameDir : run.WorkingDir;
                if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;

                var crash = Directory.EnumerateFiles(dir, "hs_err_pid*.log")
                    .Select(path => new FileInfo(path))
                    .Where(file => file.LastWriteTime >= run.StartedAt.LocalDateTime.AddMinutes(-1))
                    .OrderByDescending(file => file.LastWriteTime)
                    .FirstOrDefault();
                if (crash == null) return;

                string reason = string.Empty;
                foreach (string line in File.ReadLines(crash.FullName).Take(8))
                {
                    string text = line.TrimStart('#', ' ');
                    if (text.Length == 0) continue;
                    if (text.StartsWith("There is insufficient memory", StringComparison.OrdinalIgnoreCase) ||
                        text.StartsWith("Native memory allocation", StringComparison.OrdinalIgnoreCase))
                    {
                        reason = text;
                        break;
                    }
                }

                reporter.Log("· Java 进程启动后马上退出了（退出码 " + exitCode + "）。");
                if (reason.Length > 0)
                {
                    reporter.Log("· JVM 说：" + reason);
                    reporter.Log("· 这通常是本机可提交内存（物理内存 + 页面文件）不够：把版本设置里的内存调小一点、" +
                        "关掉一些占内存的程序，或者调大页面文件再试。");
                }
                reporter.Log("· 完整崩溃日志：" + crash.FullName);
            }
            catch (Exception)
            {
                // 读不到就算了，别让崩溃诊断把启动流程带崩
            }
        }

        /* -----------------------------------------------------------------
           游戏自己的日志
           -----------------------------------------------------------------
           Minecraft 除了往 stdout 写，还会把完整日志落到 <工作目录>\logs\latest.log。
           崩溃时真正有用的那几行（模组报错、缺库、mixins 失败）经常只在文件里，
           所以非零退出时把最后几十行抄进启动日志，省得用户去翻目录。
           ----------------------------------------------------------------- */

        private static void ReportGameLog(LaunchRun run, int exitCode, ILaunchReporter reporter)
        {
            if (exitCode == 0) return;

            try
            {
                string dir = string.IsNullOrWhiteSpace(run.WorkingDir) ? run.GameDir : run.WorkingDir;
                if (string.IsNullOrWhiteSpace(dir)) return;

                string? crash = NewestCrashReport(dir, run.StartedAt);
                if (crash != null) reporter.Log("· 崩溃报告：" + crash);

                string log = Path.Combine(dir, "logs", "latest.log");
                if (!File.Exists(log))
                {
                    if (crash == null) reporter.Log("· 还没生成 logs\\latest.log（游戏大概没跑到写日志那一步）");
                    return;
                }

                // 只有这次启动写过的日志才有意义，别把上一次的旧日志当成这次的错误。
                // 游戏一起来就会新建/覆盖 latest.log，所以时间戳应该 >= 本次启动时间。
                var stamp = File.GetLastWriteTime(log);
                if (stamp < run.StartedAt.LocalDateTime.AddSeconds(-5))
                {
                    reporter.Log("· logs\\latest.log 是上一次启动留下的（" +
                        stamp.ToString("MM-dd HH:mm") + "），这次没写到那一步");
                    return;
                }

                var lines = ReadTail(log, 60);
                if (lines.Count == 0) return;

                reporter.Log("· 游戏日志 " + log + " 最后 " + lines.Count + " 行：");
                foreach (string line in lines) reporter.Log("  " + line);
            }
            catch (Exception)
            {
                // 日志读不出来不影响其它回执
            }
        }

        /// <summary>取文件尾部若干行（日志可能几十 MB，只读最后 96 KB）。</summary>
        private static List<string> ReadTail(string path, int maxLines)
        {
            const int maxBytes = 96 * 1024;
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                long start = Math.Max(0, stream.Length - maxBytes);
                stream.Seek(start, SeekOrigin.Begin);

                using var reader = new StreamReader(stream, Encoding.UTF8, true);
                string text = reader.ReadToEnd();

                var lines = text.Replace("\r\n", "\n").Replace('\r', '\n')
                    .Split('\n')
                    .Where(line => line.Length > 0)
                    .ToList();

                // 从头截断时第一行多半是半截的，丢掉
                if (start > 0 && lines.Count > 1) lines.RemoveAt(0);
                if (lines.Count > maxLines)
                {
                    lines = lines.GetRange(lines.Count - maxLines, maxLines);
                }
                return lines;
            }
            catch (Exception)
            {
                return new List<string>();
            }
        }

        /// <summary>这次启动之后写出来的最新崩溃报告。</summary>
        private static string? NewestCrashReport(string runDir, DateTimeOffset startedAt)
        {
            try
            {
                string dir = Path.Combine(runDir, "crash-reports");
                if (!Directory.Exists(dir)) return null;

                var info = Directory.EnumerateFiles(dir, "*.txt")
                    .Select(path => new FileInfo(path))
                    .Where(file => file.LastWriteTime >= startedAt.LocalDateTime.AddSeconds(-5))
                    .OrderByDescending(file => file.LastWriteTime)
                    .FirstOrDefault();
                return info?.FullName;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static async Task RunPreCommandAsync(
            string command, string workingDir, ILaunchReporter reporter, CancellationToken token)
        {
            reporter.Log("· 执行启动前命令：" + command);

            var start = new ProcessStartInfo("cmd.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = workingDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.ArgumentList.Add("/c");
            start.ArgumentList.Add(command);

            try
            {
                using var process = Process.Start(start);
                if (process == null)
                {
                    reporter.Log("· 启动前命令没有跑起来，已跳过");
                    return;
                }

                // 两个管道必须同时抽干，否则命令输出一多就会卡死在 ReadToEnd 上
                var outputTask = process.StandardOutput.ReadToEndAsync();
                var errorTask = process.StandardError.ReadToEndAsync();

                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(60));
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);

                string output = await outputTask.ConfigureAwait(false);
                string error = await errorTask.ConfigureAwait(false);

                foreach (string line in output.Split('\n'))
                {
                    if (line.Trim().Length > 0) reporter.Log("  " + line.TrimEnd('\r'));
                }
                foreach (string line in error.Split('\n'))
                {
                    if (line.Trim().Length > 0) reporter.Log("  " + line.TrimEnd('\r'));
                }
                reporter.Log("· 启动前命令结束（退出码 " + process.ExitCode + "）");
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                reporter.Log("· 启动前命令失败，已跳过：" + ex.Message);
            }
        }

        /// <summary>
        /// 启动前检查更新：缺文件时补一遍（已存在的会跳过）。
        ///
        /// 顺序很重要 —— 先补「版本 JSON 里自己声明的运行库」，再跑原版安装器。
        /// 加载器（Fabric / Quilt / Forge）的运行库只写在版本 JSON 的 libraries 里，
        /// 带着自己的 maven 地址（maven.fabricmc.net / maven.minecraftforge.net），
        /// Mojang 的版本清单里根本没有它们；以前只会调原版安装器，
        /// 于是「补齐」补了半小时原版资源，缺的还是那几个加载器库 —— 界面就卡在那里不动。
        /// </summary>
        private static async Task<bool> TryRepairAsync(
            string gameDir, string rootId, VersionSpec spec, LaunchLayout layout,
            List<string> missing, ILaunchReporter reporter, CancellationToken token)
        {
            reporter.Log("· 正在补齐缺失文件，这一步只下载缺的部分…");

            bool repaired = false;

            // ① 版本 JSON 声明了、磁盘上没有的运行库（加载器自己的库都在这一类里）
            int libraries = await RepairLibrariesAsync(gameDir, spec, reporter, token).ConfigureAwait(false);
            if (libraries > 0)
            {
                repaired = true;
                reporter.Log("· 已补齐 " + libraries + " 个运行库");
            }

            // 补齐完立刻复查一次：这次常常只缺加载器的那几个库，
            // 补完就不缺了 —— 以前这里会无条件再跑一遍原版安装器，
            // 于是又把整个原版（上千个资源文件）重下一遍，界面一直停在
            // 「正在补齐运行库 8/8…」，看上去就是卡死。
            var recheck = new List<string>();
            BuildClasspath(spec, layout, recheck);
            AddMissingAssetIndex(spec, layout, recheck);
            if (recheck.Count == 0)
            {
                reporter.Log("· 运行库已经齐了，不需要再下原版文件");
                return true;
            }

            // ② 还缺的只有原版文件（client.jar / 资源索引）：交给原版安装器。
            //    这一步会下载几百 MB，必须把进度推出去，别让界面停在上一句话上。
            foreach (string candidate in RepairCandidates(rootId, spec))
            {
                try
                {
                    var job = new DownloadJob("install", "Minecraft " + candidate, gameDir, _ => Task.CompletedTask);
                    var summary = await RunInstallWithProgressAsync(job, gameDir, candidate, reporter, token)
                        .ConfigureAwait(false);
                    reporter.Log("· " + summary.Describe());
                    return true;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (HttpError ex)
                {
                    reporter.Log("· 用原版「" + candidate + "」补齐失败：" + ex.Message);
                }
                catch (Exception ex)
                {
                    reporter.Log("· 用原版「" + candidate + "」补齐失败：" + ex.Message);
                }
            }

            return repaired;
        }

        /// <summary>
        /// 跑原版安装器，同时把它的阶段和百分比转发给启动日志。
        /// 原版安装器自己是个 DownloadJob，不在下载队列里，网页看不到它 ——
        /// 不转发的话「正在补齐游戏文件…」会一直停在同一个百分比上。
        /// </summary>
        private static async Task<InstallSummary> RunInstallWithProgressAsync(
            DownloadJob job, string gameDir, string candidate, ILaunchReporter reporter, CancellationToken token)
        {
            var install = MinecraftInstaller.InstallAsync(job, gameDir, candidate, token);
            string lastPhase = string.Empty;

            while (!install.IsCompleted)
            {
                var finished = await Task.WhenAny(install, Task.Delay(400, CancellationToken.None))
                    .ConfigureAwait(false);
                if (finished == install) break;

                if (!string.Equals(lastPhase, job.Phase, StringComparison.Ordinal))
                {
                    lastPhase = job.Phase;
                    reporter.Log("· " + job.Phase);
                }

                // 原版安装占 18% ~ 40% 这一段
                reporter.Phase(job.Phase, 18 + (int)Math.Round(job.Progress * 0.22));
            }

            return await install.ConfigureAwait(false);
        }

        /// <summary>资源索引也是启动必需品：单独抽出来，补齐前后都要看一眼。</summary>
        private static void AddMissingAssetIndex(VersionSpec spec, LaunchLayout layout, List<string> missing)
        {
            if (string.IsNullOrEmpty(spec.AssetsIndex)) return;

            string indexFile = Path.Combine(layout.AssetsRoot, "indexes", spec.AssetsIndex + ".json");
            if (File.Exists(indexFile)) return;
            if (missing.Any(item => string.Equals(item, indexFile, StringComparison.OrdinalIgnoreCase))) return;
            missing.Add(indexFile);
        }

        /// <summary>
        /// 补「版本 JSON 里声明了但磁盘上没有」的运行库。
        ///
        /// 地址优先级：downloads.artifact.url → library.url（maven 仓库根）→ Mojang 官方库。
        /// Fabric / Forge 的库只有 url 字段，没有 downloads 段 —— 这也是以前
        /// 只按 Mojang 那一套去补就永远补不上的原因。
        /// 返回真正下下来的文件数。
        /// </summary>
        private static async Task<int> RepairLibrariesAsync(
            string gameDir, VersionSpec spec, ILaunchReporter reporter, CancellationToken token)
        {
            var pending = new List<(string Url, string Path, string? Sha1, long Size)>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string librariesRoot = Path.Combine(gameDir, "libraries");

            foreach (var library in spec.Libraries)
            {
                if (!RuleAllows(library)) continue;

                string relative = LibraryPath(library);
                if (relative.Length == 0) continue;

                string full = Path.Combine(librariesRoot, relative.Replace('/', Path.DirectorySeparatorChar));
                if (!seen.Add(full)) continue;
                if (File.Exists(full)) continue;

                string? url = LibraryDownloadUrl(library, relative);
                if (string.IsNullOrWhiteSpace(url)) continue;

                pending.Add((
                    url!,
                    full,
                    JsonRead.StringOrNull(JsonRead.Object(JsonRead.Object(library, "downloads"), "artifact"), "sha1"),
                    JsonRead.Long(JsonRead.Object(JsonRead.Object(library, "downloads"), "artifact"), "size")));
            }

            if (pending.Count == 0) return 0;

            reporter.Phase("正在补齐运行库（" + pending.Count + " 个）…", 18);
            reporter.Log("· 有 " + pending.Count + " 个运行库不在磁盘上，开始补（加载器的库也在里面）");

            int done = 0;
            int failed = 0;
            using (var gate = new SemaphoreSlim(Math.Max(2, DownloadManager.Parallelism)))
            {
                var running = new List<Task>(pending.Count);
                foreach (var item in pending)
                {
                    await gate.WaitAsync(token).ConfigureAwait(false);
                    running.Add(Task.Run(async () =>
                    {
                        try
                        {
                            await JsonHttp.DownloadFileAsync(
                                Mirrors.VanillaCandidates(item.Url), item.Path, item.Sha1, null, token)
                                .ConfigureAwait(false);
                            int total = Interlocked.Increment(ref done);
                            // 每个文件都推进一下阶段：补齐大文件时进度条不会长时间不动
                            int percent = 18 + (int)Math.Min(30, total * 30L / Math.Max(1, pending.Count));
                            reporter.Phase("正在补齐运行库 " + (total + failed) + "/" + pending.Count + "…", percent);
                            if (total % 10 == 0 || total == pending.Count)
                            {
                                reporter.Log("· 运行库 " + total + "/" + pending.Count);
                            }
                        }
                        catch (OperationCanceledException)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            Interlocked.Increment(ref failed);
                            if (failed <= 3) reporter.Log("· 这个运行库没补上：" + Path.GetFileName(item.Path) + "（" + ex.Message + "）");
                        }
                        finally
                        {
                            gate.Release();
                        }
                    }, token));
                }

                await Task.WhenAll(running).ConfigureAwait(false);
            }

            if (failed > 0)
            {
                reporter.Log("· 有 " + failed + " 个运行库没补上（网络 / 镜像问题，重试一次通常就好）");
            }

            return done;
        }

        /// <summary>
        /// 一个运行库该从哪儿下。Mojang 的库有 downloads.artifact.url；
        /// Fabric / Forge / Quilt 的库只有 maven 仓库根地址（url 字段）。
        /// </summary>
        private static string? LibraryDownloadUrl(JsonElement library, string relative)
        {
            string declared = JsonRead.String(JsonRead.Object(JsonRead.Object(library, "downloads"), "artifact"), "url");
            if (declared.Length > 0) return declared;

            string baseUrl = JsonRead.String(library, "url");
            if (baseUrl.Length > 0)
            {
                return baseUrl.TrimEnd('/') + "/" + relative;
            }

            // 老版本 JSON 里有些库什么都没写：按官方库补
            return "https://libraries.minecraft.net/" + relative;
        }

        /// <summary>
        /// 补齐文件时要问 Mojang 版本清单要哪个版本。加载器版本（1.21.11-Forge_61.2.1）
        /// 和 PCL 合并过的版本 JSON 都不在清单里，得顺着 id / jar 字段还原出原版号。
        /// </summary>
        private static List<string> RepairCandidates(string rootId, VersionSpec spec)
        {
            var list = new List<string>();

            void Add(string? value)
            {
                string text = (value ?? string.Empty).Trim();
                if (text.Length == 0) return;
                if (list.Any(item => string.Equals(item, text, StringComparison.OrdinalIgnoreCase))) return;
                list.Add(text);
            }

            // 原版号优先：老版本 JSON 里的 jar、id 前缀（1.21.11-Forge_61.2.1 → 1.21.11）
            Add(MinecraftVersionOf(rootId));

            // 目录被改成中文 / 自定义名字时，目录名里没有版本号，
            // 只能靠版本 JSON 自己写的 id 和 jar 字段还原 —— 少了这两条，
            // 改名后的实例永远补不对版本（界面就卡在「正在补齐」）。
            Add(MinecraftVersionOf(spec.JsonId));
            Add(spec.JarVersion);
            Add(spec.JsonId);
            Add(rootId);
            return list;
        }

        /// <summary>从版本目录名里抠出原版号：1.21.11-Forge_61.2.1 → 1.21.11，26.3-forge-66.1.8 → 26.3。</summary>
        internal static string MinecraftVersionOf(string? versionId)
        {
            string text = (versionId ?? string.Empty).Trim();
            if (text.Length == 0) return string.Empty;

            var match = System.Text.RegularExpressions.Regex.Match(
                text, @"^(\d+\.\d+(?:\.\d+)?)(?:[-_+ ]|$)");
            return match.Success ? match.Groups[1].Value : text;
        }

        /* =================================================================
           高性能显卡：写给 Windows 的 GpuPreference，对该 exe 永久生效
           ================================================================= */

        private static string? TryApplyHighPerformanceGpu(string javaPath)
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                    @"Software\Microsoft\DirectX\UserGpuPreferences");
                if (key == null) return null;

                string? existing = key.GetValue(javaPath) as string;
                if (existing != null && existing.Contains("GpuPreference=2", StringComparison.OrdinalIgnoreCase))
                {
                    return null; // 已经是高性能，不用重复写
                }

                key.SetValue(javaPath, "GpuPreference=2;", Microsoft.Win32.RegistryValueKind.String);
                return "已把 " + Path.GetFileName(javaPath) + " 设为高性能显卡";
            }
            catch (Exception)
            {
                return null;
            }
        }

        /* =================================================================
           杂项
           ================================================================= */

        public static string LauncherVersion
        {
            get
            {
                try
                {
                    var version = typeof(GameLauncher).Assembly.GetName().Version;
                    if (version == null) return "1.0";
                    return version.Major + "." + version.Minor + "." + version.Build;
                }
                catch (Exception)
                {
                    return "1.0";
                }
            }
        }

        private static string Shorten(string text, int max)
        {
            if (string.IsNullOrEmpty(text) || text.Length <= max) return text;
            return text.Substring(0, max) + "…";
        }

        private static string FormatSize(long bytes)
        {
            if (bytes >= 1024L * 1024 * 1024) return Math.Round(bytes / 1024.0 / 1024 / 1024, 2) + " GB";
            if (bytes >= 1024L * 1024) return Math.Round(bytes / 1024.0 / 1024, 1) + " MB";
            if (bytes >= 1024) return Math.Round(bytes / 1024.0, 0) + " KB";
            return bytes + " B";
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetWindowText(IntPtr window, string text);
    }

    /// <summary>退出回执：Host/LaunchMessages 用它在游戏退出后更新界面状态。</summary>
    internal interface ILaunchExitReporter
    {
        void Exited(LaunchRun run, int exitCode, TimeSpan elapsed);
    }
}
