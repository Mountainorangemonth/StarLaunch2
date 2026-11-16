using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace StarLaunch.Services
{
    /// <summary>一个版本（= 一个实例）扫描出来的结果，直接序列化成网页用的 JSON。</summary>
    internal sealed class VersionEntry
    {
        /// <summary>versions 下的文件夹名，也是启动时的版本名。</summary>
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;

        /// <summary>原版版本号，例如 1.20.4。</summary>
        public string Mc { get; set; } = string.Empty;

        /// <summary>Vanilla / Fabric / Forge / NeoForge / Quilt / OptiFine / LiteLoader。</summary>
        public string Loader { get; set; } = "Vanilla";
        public string LoaderName { get; set; } = "Vanilla";
        public string? LoaderVersion { get; set; }

        /// <summary>release / snapshot / old_beta / old_alpha。</summary>
        public string Type { get; set; } = "release";

        /// <summary>modded / vanilla，用来对应「只隔离带模组的版本」。</summary>
        public string Kind { get; set; } = "vanilla";

        public int Mods { get; set; }

        /// <summary>模组数来自共享的根目录（说明当前没隔离）。</summary>
        public bool ModsShared { get; set; }

        public List<string> ModPreview { get; set; } = new List<string>();

        /// <summary>这个版本实际会用的 mods 目录（工作目录下的 mods）。</summary>
        public string ModsPath { get; set; } = string.Empty;

        /// <summary>mods 目录里的文件清单，最多 300 条（Mod 管理页用）。</summary>
        public List<ModFileEntry> ModFiles { get; set; } = new List<ModFileEntry>();

        /// <summary>这个版本实际会用的 resourcepacks 目录。</summary>
        public string ResourcePacksPath { get; set; } = string.Empty;

        /// <summary>resourcepacks 目录里的内容（材质包管理页用）。</summary>
        public List<ModFileEntry> ResourcePackFiles { get; set; } = new List<ModFileEntry>();

        /// <summary>这个版本实际会用的 shaderpacks 目录。</summary>
        public string ShaderPacksPath { get; set; } = string.Empty;

        /// <summary>shaderpacks 目录里的内容（光影管理页用）。</summary>
        public List<ModFileEntry> ShaderPackFiles { get; set; } = new List<ModFileEntry>();

        /// <summary>
        /// 版本目录里的 StarLaunch.instance.json。
        /// null = 这个版本什么都没改，全部跟随全局设置。
        /// </summary>
        public InstanceSettings? Settings { get; set; }

        /// <summary>需要的 Java 主版本号，例如 21；JSON 没写时为空。</summary>
        public string Java { get; set; } = string.Empty;

        public bool HasJar { get; set; }
        public string Path { get; set; } = string.Empty;

        /// <summary>按当前隔离策略算出来的实际工作目录。</summary>
        public string GameDir { get; set; } = string.Empty;

        /// <summary>版本目录里是否已经有自己的游戏数据（mods / saves / config…）。</summary>
        public bool Isolated { get; set; }

        /// <summary>按当前策略，这个版本是否应该隔离。</summary>
        public bool IsolatedByPolicy { get; set; }

        /// <summary>目录里有独立数据、但设置要求不隔离：实际会读根目录，属于需要提醒的状态。</summary>
        public bool Mismatch { get; set; }

        public long Size { get; set; }

        /// <summary>上次启动时间（取自 launcher_profiles.json，取不到就用目录修改时间）。</summary>
        public string? LastPlayed { get; set; }

        /// <summary>JSON 缺失或损坏时的说明，正常为 null。</summary>
        public string? Error { get; set; }

        /* ---- 属于哪个 .minecraft 文件夹（多文件夹合并列表用） ---- */

        /// <summary>所属文件夹的稳定 ID，网页用它拼出全局唯一的版本 key。</summary>
        public string DirId { get; set; } = string.Empty;

        /// <summary>所属文件夹的绝对路径。</summary>
        public string DirPath { get; set; } = string.Empty;

        /// <summary>所属文件夹的显示名（通常就是 .minecraft 或自定义目录名）。</summary>
        public string DirName { get; set; } = string.Empty;

        /// <summary>所属文件夹自己的隔离策略（每个文件夹可以不一样）。</summary>
        public string DirIsolation { get; set; } = GameDirs.IsolationAll;
    }

    /// <summary>mods / resourcepacks / shaderpacks 目录里的一个条目（资源管理页的一行）。</summary>
    internal sealed class ModFileEntry
    {
        /// <summary>文件名，保留后缀：foo.jar / bar.jar.disabled。</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>.jar 为启用，.jar.disabled 为已禁用（和 PCL / HMCL 的约定一致）。</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>文件大小（字节），读不到时为 0。</summary>
        public long Size { get; set; }

        /// <summary>
        /// 这一条是文件夹而不是文件（光影 / 材质包允许直接放文件夹）。
        /// 文件夹没法靠改名禁用 —— 游戏照样能读到里面的 pack.mcmeta，所以只能删。
        /// </summary>
        public bool IsFolder { get; set; }
    }

    /// <summary>一个游戏文件夹的扫描摘要，画在版本页左侧的「文件夹列表」里。</summary>
    internal sealed class GameFolderSummary
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public bool BuiltIn { get; set; }
        public bool Exists { get; set; }
        public bool Active { get; set; }
        public string Isolation { get; set; } = GameDirs.IsolationAll;
        public int Versions { get; set; }
        public int Modded { get; set; }
        public int Isolated { get; set; }
        public int Broken { get; set; }
        public long Size { get; set; }

        /// <summary>文件夹读不了时的说明，正常为 null。</summary>
        public string? Error { get; set; }
    }

    internal sealed class VersionScanResult
    {
        public bool Ok { get; set; } = true;

        /// <summary>当前文件夹的路径（侧栏高亮、导入目标）。</summary>
        public string GameDir { get; set; } = string.Empty;

        public string DefaultGameDir { get; set; } = string.Empty;
        public bool Custom { get; set; }

        /// <summary>当前文件夹的隔离策略。</summary>
        public string Isolation { get; set; } = GameDirs.IsolationAll;

        public string ScannedAt { get; set; } = string.Empty;
        public string? Error { get; set; }

        /// <summary>所有登记过的文件夹（含合并统计）。</summary>
        public List<GameFolderSummary> Folders { get; set; } = new List<GameFolderSummary>();

        public List<VersionEntry> Versions { get; set; } = new List<VersionEntry>();
        public Dictionary<string, int> Counts { get; set; } = new Dictionary<string, int>();
    }

    /// <summary>从版本 JSON 里挑出来的、扫描真正会用到的字段。</summary>
    internal sealed class VersionJsonInfo
    {
        public string? Id { get; set; }
        public string? InheritsFrom { get; set; }
        public string? MainClass { get; set; }
        public string? Jar { get; set; }
        public string? Type { get; set; }
        public int? JavaMajor { get; set; }
        public DateTimeOffset? ReleaseTime { get; set; }
        public List<string> Libraries { get; } = new List<string>();
    }

    /// <summary>
    /// 扫描 .minecraft/versions。
    ///
    /// 只读：不改、不搬任何用户文件，只把磁盘上的事实读出来，再按隔离策略算出
    /// 「这个版本实际会用哪个目录」，让网页能把两件事放在一起给用户看。
    /// 加载器信息来自版本 JSON（libraries 里的 loader 坐标 + mainClass 兜底），
    /// 原版版本号沿 inheritsFrom 链回溯到根节点，所以 Forge/NeoForge 那种
    /// 一层套一层的 JSON 也能解析正确。
    /// </summary>
    internal static class MinecraftScanner
    {
        /// <summary>出现任意一个，就认为这个版本目录已经是自己的游戏目录（PCL 风格的版本隔离）。</summary>
        private static readonly string[] IsolationMarkers =
        {
            "mods", "saves", "config", "resourcepacks", "shaderpacks",
            "options.txt", "servers.dat", "logs", "screenshots", "crash-reports"
        };

        private static readonly (string Prefix, string Loader)[] LoaderRules =
        {
            ("net.neoforged:neoforge:", "NeoForge"),
            ("net.neoforged.fancymodloader:", "NeoForge"),
            ("net.minecraftforge:forge:", "Forge"),
            ("net.fabricmc:fabric-loader:", "Fabric"),
            ("org.quiltmc:quilt-loader:", "Quilt"),
            ("optifine:OptiFine:", "OptiFine"),
            ("optifine:optifine:", "OptiFine"),
            ("com.mumfrey:liteloader:", "LiteLoader")
        };

        public static VersionScanResult Scan(string gameDir, string isolation)
        {
            var result = new VersionScanResult
            {
                GameDir = gameDir,
                DefaultGameDir = GameDirs.DefaultDir,
                Isolation = GameDirs.Normalize(isolation),
                ScannedAt = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            };

            try
            {
                GameDirs.Ensure(gameDir);
                string versionsDir = Path.Combine(gameDir, "versions");
                var folders = Directory.EnumerateDirectories(versionsDir)
                    .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                // 先把所有版本 JSON 读一遍：解析 inheritsFrom 链要用到父版本的内容
                var jsonByVersion = new Dictionary<string, VersionJsonInfo>(StringComparer.OrdinalIgnoreCase);
                foreach (string folder in folders)
                {
                    string name = Path.GetFileName(folder);
                    string? jsonPath = FindVersionJson(folder, name);
                    if (jsonPath == null) continue;
                    var info = ReadVersionJson(jsonPath);
                    if (info != null) jsonByVersion[name] = info;
                }

                var lastPlayed = ReadLauncherProfiles(gameDir);
                // 自己记的启动时间更准：官方启动器不一定会去写 launcher_profiles.json
                PlayStats.MergeLastPlayed(gameDir, lastPlayed);
                var modsCache = new Dictionary<string, (int Count, List<string> Preview, List<ModFileEntry> Files)>(StringComparer.OrdinalIgnoreCase);

                foreach (string folder in folders)
                {
                    string name = Path.GetFileName(folder);
                    jsonByVersion.TryGetValue(name, out VersionJsonInfo? self);
                    var chain = BuildChain(name, jsonByVersion);

                    var entry = new VersionEntry
                    {
                        Id = name,
                        Name = name,
                        Path = folder,
                        DirId = GameDirs.MakeId(gameDir),
                        DirPath = gameDir,
                        DirIsolation = result.Isolation
                    };

                    if (self == null)
                    {
                        entry.Error = "缺少版本 JSON，启动器无法识别这个版本";
                        entry.Mc = GuessMcVersion(name) ?? "未知";
                        entry.LastPlayed = FormatTime(lastPlayed, name, folder);
                        entry.GameDir = gameDir;
                        entry.ModsPath = Path.Combine(gameDir, "mods");
                        entry.ResourcePacksPath = Path.Combine(gameDir, "resourcepacks");
                        entry.ResourcePackFiles = ListAssetFiles(entry.ResourcePacksPath, "resourcepacks");
                        entry.ShaderPacksPath = Path.Combine(gameDir, "shaderpacks");
                        entry.ShaderPackFiles = ListAssetFiles(entry.ShaderPacksPath, "shaderpacks");
                        // 就算 JSON 坏了，用户改过的显示名 / 收藏也还是要显示出来
                        entry.Settings = InstanceSettingsStore.Load(folder);
                        result.Versions.Add(entry);
                        continue;
                    }

                    var (loader, loaderVersion) = DetectLoader(chain);
                    entry.Loader = loader;
                    entry.LoaderVersion = loaderVersion;
                    entry.LoaderName = string.IsNullOrEmpty(loaderVersion) ? loader : loader + " " + loaderVersion;
                    entry.Mc = ResolveMcVersion(name, chain);
                    entry.Type = NormalizeType(self.Type ?? chain.LastOrDefault()?.Type);

                    int? javaMajor = chain.Select(item => item.JavaMajor)
                        .FirstOrDefault(major => major.HasValue);
                    entry.Java = javaMajor.HasValue
                        ? javaMajor.Value.ToString(CultureInfo.InvariantCulture)
                        : string.Empty;

                    entry.HasJar = FindVersionJar(folder, name) != null;

                    // 版本自己的设置：文件里没写的字段一律跟随全局
                    var settings = InstanceSettingsStore.Load(folder);
                    entry.Settings = settings;

                    // 隔离：先看目录里有没有自己的游戏数据，再按策略判断「应该」怎么用。
                    // 版本设置里单独选了「隔离 / 不隔离」时，以版本设置为准。
                    entry.Isolated = HasIsolationContent(folder);
                    bool isolateByPolicy = ShouldIsolate(result.Isolation, loader);
                    if (settings?.Isolation == "on") isolateByPolicy = true;
                    else if (settings?.Isolation == "off") isolateByPolicy = false;

                    entry.IsolatedByPolicy = isolateByPolicy;
                    entry.Mismatch = entry.Isolated && !isolateByPolicy;
                    entry.GameDir = isolateByPolicy ? folder : gameDir;

                    var mods = CountMods(entry.GameDir, modsCache);
                    entry.Mods = mods.Count;
                    entry.ModsShared = !isolateByPolicy;
                    entry.ModPreview = mods.Preview;
                    entry.ModFiles = mods.Files;
                    entry.ModsPath = Path.Combine(entry.GameDir, "mods");
                    entry.ResourcePacksPath = Path.Combine(entry.GameDir, "resourcepacks");
                    entry.ResourcePackFiles = ListAssetFiles(entry.ResourcePacksPath, "resourcepacks");
                    entry.ShaderPacksPath = Path.Combine(entry.GameDir, "shaderpacks");
                    entry.ShaderPackFiles = ListAssetFiles(entry.ShaderPacksPath, "shaderpacks");
                    entry.Kind = loader != "Vanilla" || entry.Mods > 0 ? "modded" : "vanilla";

                    entry.Size = DirectorySize(folder);
                    entry.LastPlayed = FormatTime(lastPlayed, name, folder);

                    result.Versions.Add(entry);
                }

                result.Counts = new Dictionary<string, int>
                {
                    ["total"] = result.Versions.Count,
                    ["modded"] = result.Versions.Count(item => item.Kind == "modded"),
                    ["vanilla"] = result.Versions.Count(item => item.Kind != "modded"),
                    ["isolated"] = result.Versions.Count(item => item.Isolated),
                    ["mismatch"] = result.Versions.Count(item => item.Mismatch),
                    ["broken"] = result.Versions.Count(item => item.Error != null)
                };
            }
            catch (Exception ex)
            {
                result.Ok = false;
                result.Error = ex.Message;
            }

            return result;
        }

        /// <summary>
        /// 扫描所有登记过的 .minecraft，把版本的合并列表和文件夹摘要一起返回。
        ///
        /// 每个文件夹按自己的隔离策略算工作目录（设置里能分开配），
        /// 版本条目带上 DirId / DirPath / DirName，网页据此做「文件夹标签 + 筛选」。
        /// 不存在的文件夹不跳过：照样出现在列表里并标出错误，用户才知道路径失效了。
        /// </summary>
        public static VersionScanResult ScanAll(IReadOnlyList<GameDirEntry> folders)
        {
            var active = GameDirs.Active();

            var merged = new VersionScanResult
            {
                GameDir = active.Path,
                DefaultGameDir = GameDirs.DefaultDir,
                Custom = !active.BuiltIn,
                Isolation = active.Isolation,
                ScannedAt = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            };

            try
            {
                var errors = new List<string>();

                foreach (var folder in folders)
                {
                    var summary = new GameFolderSummary
                    {
                        Id = folder.Id,
                        Name = folder.DisplayName,
                        Path = folder.Path,
                        BuiltIn = folder.BuiltIn,
                        Isolation = GameDirs.Normalize(folder.Isolation),
                        Active = string.Equals(folder.Path, active.Path, StringComparison.OrdinalIgnoreCase),
                        Exists = Directory.Exists(folder.Path)
                    };

                    if (!summary.Exists)
                    {
                        summary.Error = "文件夹不存在，可能被移动或改名了";
                        errors.Add(summary.Path + " 不存在");
                        merged.Folders.Add(summary);
                        continue;
                    }

                    var result = Scan(folder.Path, summary.Isolation);
                    if (!result.Ok)
                    {
                        summary.Error = result.Error;
                        errors.Add(summary.Name + "：" + (result.Error ?? "扫描失败"));
                        merged.Folders.Add(summary);
                        continue;
                    }

                    foreach (var entry in result.Versions)
                    {
                        entry.DirId = folder.Id;
                        entry.DirPath = folder.Path;
                        entry.DirName = folder.DisplayName;
                        entry.DirIsolation = summary.Isolation;
                    }

                    summary.Versions = result.Versions.Count;
                    summary.Modded = result.Versions.Count(item => item.Kind == "modded");
                    summary.Isolated = result.Versions.Count(item => item.Isolated);
                    summary.Broken = result.Versions.Count(item => item.Error != null);
                    summary.Size = result.Versions.Sum(item => item.Size);

                    merged.Versions.AddRange(result.Versions);
                    merged.Folders.Add(summary);
                }

                merged.Counts = new Dictionary<string, int>
                {
                    ["total"] = merged.Versions.Count,
                    ["modded"] = merged.Versions.Count(item => item.Kind == "modded"),
                    ["vanilla"] = merged.Versions.Count(item => item.Kind != "modded"),
                    ["isolated"] = merged.Versions.Count(item => item.Isolated),
                    ["mismatch"] = merged.Versions.Count(item => item.Mismatch),
                    ["broken"] = merged.Versions.Count(item => item.Error != null),
                    ["folders"] = merged.Folders.Count,
                    ["foldersMissing"] = merged.Folders.Count(item => !item.Exists)
                };

                // 只把整体性的问题抛给页面；单个文件夹的问题挂在各自的摘要上
                if (merged.Folders.Count == 0) merged.Error = "还没有任何游戏文件夹";
                else if (errors.Count > 0 && merged.Versions.Count == 0) merged.Error = string.Join("；", errors);
            }
            catch (Exception ex)
            {
                merged.Ok = false;
                merged.Error = ex.Message;
            }

            return merged;
        }

        /* ---------------- 版本 JSON ---------------- */

        private static string? FindVersionJson(string folder, string name)
        {
            string primary = Path.Combine(folder, name + ".json");
            if (File.Exists(primary)) return primary;
            try
            {
                return Directory.EnumerateFiles(folder, "*.json", SearchOption.TopDirectoryOnly)
                    .FirstOrDefault();
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string? FindVersionJar(string folder, string name)
        {
            string primary = Path.Combine(folder, name + ".jar");
            if (File.Exists(primary)) return primary;
            try
            {
                return Directory.EnumerateFiles(folder, "*.jar", SearchOption.TopDirectoryOnly)
                    .FirstOrDefault();
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static VersionJsonInfo? ReadVersionJson(string path)
        {
            try
            {
                string text = File.ReadAllText(path);
                var options = new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                };

                using var document = JsonDocument.Parse(text, options);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return null;

                var info = new VersionJsonInfo
                {
                    Id = GetString(root, "id"),
                    InheritsFrom = GetString(root, "inheritsFrom"),
                    MainClass = GetString(root, "mainClass"),
                    Jar = GetString(root, "jar"),
                    Type = GetString(root, "type")
                };

                if (root.TryGetProperty("javaVersion", out var javaVersion) &&
                    javaVersion.ValueKind == JsonValueKind.Object &&
                    javaVersion.TryGetProperty("majorVersion", out var major) &&
                    major.ValueKind == JsonValueKind.Number &&
                    major.TryGetInt32(out int majorValue))
                {
                    info.JavaMajor = majorValue;
                }

                if (root.TryGetProperty("releaseTime", out var releaseTime) &&
                    releaseTime.ValueKind == JsonValueKind.String &&
                    DateTimeOffset.TryParse(releaseTime.GetString(), CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal, out DateTimeOffset released))
                {
                    info.ReleaseTime = released;
                }

                if (root.TryGetProperty("libraries", out var libraries) &&
                    libraries.ValueKind == JsonValueKind.Array)
                {
                    foreach (var library in libraries.EnumerateArray())
                    {
                        string? name = GetString(library, "name");
                        if (!string.IsNullOrEmpty(name)) info.Libraries.Add(name!);
                    }
                }

                return info;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string? GetString(JsonElement element, string property)
        {
            if (element.ValueKind != JsonValueKind.Object) return null;
            if (!element.TryGetProperty(property, out var value)) return null;
            return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        }

        /// <summary>自己 → 父 → 祖父…的顺序。父版本 JSON 缺失时链就断在那里。</summary>
        private static List<VersionJsonInfo> BuildChain(
            string version,
            Dictionary<string, VersionJsonInfo> jsonByVersion)
        {
            var chain = new List<VersionJsonInfo>();
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string? current = version;

            while (!string.IsNullOrEmpty(current) && visited.Add(current!))
            {
                if (!jsonByVersion.TryGetValue(current!, out VersionJsonInfo? info)) break;
                chain.Add(info);
                current = info.InheritsFrom;

                // 防御：继承链不可能有几十层，出现环或数据异常时直接收手
                if (chain.Count >= 8) break;
            }

            return chain;
        }

        /// <summary>沿继承链找加载器坐标；找不到就用 mainClass 兜底。</summary>
        private static (string Loader, string? Version) DetectLoader(List<VersionJsonInfo> chain)
        {
            foreach (var info in chain)
            {
                foreach (string library in info.Libraries)
                {
                    foreach (var rule in LoaderRules)
                    {
                        if (!library.StartsWith(rule.Prefix, StringComparison.OrdinalIgnoreCase)) continue;

                        string version = library.Substring(rule.Prefix.Length);
                        int separator = version.IndexOf(':');
                        if (separator >= 0) version = version.Substring(0, separator);

                        // Forge 常写成 1.20.1-47.2.0，只留加载器自己的版本号
                        int dash = version.IndexOf('-');
                        if (dash > 0 && dash < version.Length - 1) version = version.Substring(dash + 1);

                        return (rule.Loader, string.IsNullOrWhiteSpace(version) ? null : version);
                    }
                }
            }

            foreach (var info in chain)
            {
                string mainClass = info.MainClass ?? string.Empty;
                if (mainClass.IndexOf("quilt", StringComparison.OrdinalIgnoreCase) >= 0) return ("Quilt", null);
                if (mainClass.IndexOf("fabric", StringComparison.OrdinalIgnoreCase) >= 0) return ("Fabric", null);
                if (mainClass.IndexOf("optifine", StringComparison.OrdinalIgnoreCase) >= 0) return ("OptiFine", null);
                if (mainClass.IndexOf("bootstraplauncher", StringComparison.OrdinalIgnoreCase) >= 0) return ("NeoForge", null);
                if (mainClass.IndexOf("launchwrapper", StringComparison.OrdinalIgnoreCase) >= 0) return ("Forge", null);
            }

            return ("Vanilla", null);
        }

        /// <summary>原版版本号：继承链根节点的 id（没有继承时就是自己）。</summary>
        private static string ResolveMcVersion(string folderName, List<VersionJsonInfo> chain)
        {
            if (chain.Count == 0) return GuessMcVersion(folderName) ?? folderName;

            var root = chain[chain.Count - 1];
            if (!string.IsNullOrWhiteSpace(root.InheritsFrom))
            {
                // 根节点的父 JSON 不在磁盘上：父版本名本身通常就是原版版本号
                string parent = root.InheritsFrom!;
                return GuessMcVersion(parent) ?? parent;
            }

            string id = root.Id ?? folderName;
            return GuessMcVersion(id) ?? id;
        }

        /// <summary>从 "1.20.1-forge-47.2.0" 这种字符串里取出开头的 1.20.1。</summary>
        private static string? GuessMcVersion(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;

            int index = 0;
            int digits = 0;
            int dots = 0;
            while (index < value.Length)
            {
                char ch = value[index];
                if (char.IsDigit(ch))
                {
                    digits++;
                    index++;
                    continue;
                }
                if (ch == '.' && digits > 0 && dots < 2 && index + 1 < value.Length && char.IsDigit(value[index + 1]))
                {
                    dots++;
                    index++;
                    continue;
                }
                break;
            }

            if (dots == 0 || digits < 2) return null;
            return value.Substring(0, index);
        }

        private static string NormalizeType(string? type)
        {
            switch (type)
            {
                case "release":
                case "snapshot":
                case "old_beta":
                case "old_alpha":
                    return type!;
                default:
                    return "release";
            }
        }

        /// <summary>「只隔离带模组的版本」以有没有装加载器为准：这个判断不随策略变化，结果稳定。</summary>
        private static bool ShouldIsolate(string isolation, string loader)
        {
            switch (GameDirs.Normalize(isolation))
            {
                case GameDirs.IsolationAll:
                    return true;
                case GameDirs.IsolationModded:
                    return loader != "Vanilla";
                default:
                    return false;
            }
        }

        /// <summary>版本目录里是否已经有自己的游戏数据（PCL 的版本隔离就是这个形态）。</summary>
        private static bool HasIsolationContent(string folder)
        {
            foreach (string marker in IsolationMarkers)
            {
                try
                {
                    string path = Path.Combine(folder, marker);
                    if (File.Exists(path) || Directory.Exists(path)) return true;
                }
                catch (Exception)
                {
                    // 路径过长 / 权限不足：跳过这一项
                }
            }
            return false;
        }

        /// <summary>Mod 管理页最多列这么多文件，避免一个几千模组的整合包把 JSON 撑爆。</summary>
        private const int ModFileLimit = 300;

        private static (int Count, List<string> Preview, List<ModFileEntry> Files) CountMods(
            string gameDir,
            Dictionary<string, (int Count, List<string> Preview, List<ModFileEntry> Files)> cache)
        {
            var preview = new List<string>();
            var files = new List<ModFileEntry>();
            if (cache.TryGetValue(gameDir, out var cached)) return cached;

            int count = 0;
            try
            {
                string modsDir = Path.Combine(gameDir, "mods");
                if (Directory.Exists(modsDir))
                {
                    // .jar 是启用的，.jar.disabled 是用户在游戏里 / 启动器里禁用的
                    var jars = Directory.EnumerateFiles(modsDir, "*.jar*", SearchOption.TopDirectoryOnly)
                        .Where(IsModFile)
                        .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase)
                        .ToList();
                    count = jars.Count;

                    foreach (string jar in jars.Take(3))
                    {
                        preview.Add(ReadableModName(ModStem(Path.GetFileName(jar))));
                    }

                    foreach (string jar in jars.Take(ModFileLimit))
                    {
                        files.Add(new ModFileEntry
                        {
                            Name = Path.GetFileName(jar),
                            Enabled = jar.EndsWith(".jar", StringComparison.OrdinalIgnoreCase),
                            Size = FileSize(jar)
                        });
                    }
                }
            }
            catch (Exception)
            {
                count = 0;
                files.Clear();
            }

            var value = (count, preview, files);
            cache[gameDir] = value;
            return value;
        }

        /// <summary>mods 里只认这两种：foo.jar / foo.jar.disabled。</summary>
        private static bool IsModFile(string path)
        {
            return path.EndsWith(".jar", StringComparison.OrdinalIgnoreCase) ||
                path.EndsWith(".jar.disabled", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>这一类资源认的后缀：Mod 是 .jar，材质包和光影都是 .zip。</summary>
        public static string AssetExtension(string kind)
        {
            return string.Equals(kind, "mods", StringComparison.OrdinalIgnoreCase) ? ".jar" : ".zip";
        }

        /// <summary>
        /// 列出一个资源目录（mods / resourcepacks / shaderpacks）里的内容。
        /// 材质包和光影允许直接放文件夹，所以那边会把子目录也列出来并标成 IsFolder
        /// （文件夹没法靠改名禁用 —— 游戏照样读得到里面的 pack.mcmeta）。
        /// 目录不存在时返回空列表，不抛异常。
        /// </summary>
        public static List<ModFileEntry> ListAssetFiles(string dir, string kind)
        {
            var files = new List<ModFileEntry>();
            if (string.IsNullOrWhiteSpace(dir)) return files;

            string extension = AssetExtension(kind);
            bool foldersAllowed = !string.Equals(kind, "mods", StringComparison.OrdinalIgnoreCase);

            try
            {
                if (!Directory.Exists(dir)) return files;

                var found = Directory.EnumerateFiles(dir, "*", SearchOption.TopDirectoryOnly)
                    .Where(path => IsAssetFile(path, extension))
                    .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                foreach (string file in found.Take(ModFileLimit))
                {
                    files.Add(new ModFileEntry
                    {
                        Name = Path.GetFileName(file),
                        Enabled = !file.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase),
                        Size = FileSize(file)
                    });
                }
            }
            catch (Exception)
            {
                files.Clear();
            }

            if (!foldersAllowed) return files;

            try
            {
                foreach (string folder in Directory.EnumerateDirectories(dir)
                    .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase)
                    .Take(ModFileLimit))
                {
                    files.Add(new ModFileEntry
                    {
                        Name = Path.GetFileName(folder),
                        Enabled = true,
                        IsFolder = true
                    });
                }
            }
            catch (Exception)
            {
                // 子目录读不了就只列文件，不影响已经拿到的部分
            }

            return files;
        }

        /// <summary>foo.jar / foo.jar.disabled（材质包、光影是 .zip）。</summary>
        private static bool IsAssetFile(string path, string extension)
        {
            return path.EndsWith(extension, StringComparison.OrdinalIgnoreCase) ||
                path.EndsWith(extension + ".disabled", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>文件名去掉 .jar / .jar.disabled 后缀。</summary>
        private static string ModStem(string fileName)
        {
            const string disabled = ".jar.disabled";
            if (fileName.EndsWith(disabled, StringComparison.OrdinalIgnoreCase))
            {
                return fileName.Substring(0, fileName.Length - disabled.Length);
            }
            if (fileName.EndsWith(".jar", StringComparison.OrdinalIgnoreCase))
            {
                return fileName.Substring(0, fileName.Length - 4);
            }
            return fileName;
        }

        private static long FileSize(string path)
        {
            try
            {
                return new FileInfo(path).Length;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        /// <summary>fabric-api-0.92.2+1.20.4.jar → fabric-api。</summary>
        private static string ReadableModName(string fileName)
        {
            string name = fileName;
            int cut = name.IndexOfAny(new[] { '+', '-' });
            while (cut > 3)
            {
                // 只截掉明显是版本号的那一段（后面紧跟数字）
                string rest = name.Substring(cut + 1);
                if (rest.Length > 0 && (char.IsDigit(rest[0]) || rest[0] == 'v'))
                {
                    name = name.Substring(0, cut);
                    break;
                }
                cut = name.IndexOfAny(new[] { '+', '-' }, cut + 1);
            }
            return name.Length == 0 ? fileName : name;
        }

        private static long DirectorySize(string folder)
        {
            long total = 0;
            int seen = 0;
            try
            {
                foreach (string file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
                {
                    try
                    {
                        total += new FileInfo(file).Length;
                    }
                    catch (Exception)
                    {
                        // 单个文件读不到就跳过
                    }

                    // 隔离目录里可能塞了几 GB 的存档和资源包，数到一定量就停，别拖慢扫描
                    if (++seen >= 4000) break;
                }
            }
            catch (Exception)
            {
                return total;
            }
            return total;
        }

        /* ---------------- 上次启动时间 ---------------- */

        private static Dictionary<string, DateTimeOffset> ReadLauncherProfiles(string gameDir)
        {
            var map = new Dictionary<string, DateTimeOffset>(StringComparer.OrdinalIgnoreCase);
            try
            {
                string path = Path.Combine(gameDir, "launcher_profiles.json");
                if (!File.Exists(path)) return map;

                using var document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                });

                if (!document.RootElement.TryGetProperty("profiles", out var profiles) ||
                    profiles.ValueKind != JsonValueKind.Object)
                {
                    return map;
                }

                foreach (var profile in profiles.EnumerateObject())
                {
                    var value = profile.Value;
                    string? versionId = GetString(value, "lastVersionId");
                    string? lastUsed = GetString(value, "lastUsed");
                    if (string.IsNullOrEmpty(versionId) || string.IsNullOrEmpty(lastUsed)) continue;
                    if (!DateTimeOffset.TryParse(lastUsed, CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal, out DateTimeOffset when))
                    {
                        continue;
                    }

                    // Profile 的 lastVersionId 有时带命名空间，取最后一段
                    string key = versionId!.Contains(':')
                        ? versionId.Substring(versionId.LastIndexOf(':') + 1)
                        : versionId;

                    if (!map.TryGetValue(key, out DateTimeOffset existing) || when > existing)
                    {
                        map[key] = when;
                    }
                }
            }
            catch (Exception)
            {
                // 官方启动器没装 / 文件损坏：退回用目录修改时间
            }
            return map;
        }

        private static string? FormatTime(Dictionary<string, DateTimeOffset> lastPlayed, string version, string folder)
        {
            DateTimeOffset when;
            if (!lastPlayed.TryGetValue(version, out when))
            {
                try
                {
                    when = new DateTimeOffset(Directory.GetLastWriteTimeUtc(folder), TimeSpan.Zero);
                }
                catch (Exception)
                {
                    return null;
                }
            }
            return when.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
        }
    }
}
