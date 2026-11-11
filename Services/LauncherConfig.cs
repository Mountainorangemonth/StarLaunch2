using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace StarLaunch.Services
{
    /// <summary>
    /// 一个登记在册的游戏文件夹（一个 .minecraft）。
    ///
    /// 按需求（PCL 式多文件夹）：列表里可以有好几个 .minecraft，每个文件夹
    /// 各自记自己的版本隔离策略，扫描时按各自的值去算版本的实际工作目录。
    /// 启动器自带的那个 .minecraft 永远排第一，不允许删除。
    /// </summary>
    internal sealed class GameDirEntry
    {
        /// <summary>稳定 ID（路径的 FNV-1a 哈希）：网页拿它当版本列表的 key。</summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>绝对路径，存进配置前已归一化。</summary>
        public string Path { get; set; } = string.Empty;

        /// <summary>用户起的名；为空时用目录名。</summary>
        public string? Name { get; set; }

        /// <summary>这个文件夹自己的隔离策略：all / modded / none。</summary>
        public string Isolation { get; set; } = GameDirs.IsolationAll;

        /// <summary>启动器自带的 .minecraft：不可删除。</summary>
        public bool BuiltIn { get; set; }

        /// <summary>显示名：自定义名字 → 目录名。内置文件夹没改过名时就是 .minecraft。</summary>
        public string DisplayName
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(Name)) return Name!.Trim();
                string trimmed = Path.TrimEnd('\\', '/');
                string folder = System.IO.Path.GetFileName(trimmed);
                return string.IsNullOrEmpty(folder) ? Path : folder;
            }
        }
    }

    /// <summary>
    /// 游戏目录与隔离策略。
    ///
    /// 目录规则：启动器同级的 .minecraft 永远在列表里（没有就当场建一个），
    /// 另外可以添加任意多个已有文件夹，列表存进 StarLaunch.config.json。
    /// </summary>
    internal static class GameDirs
    {
        public const string IsolationAll = "all";
        public const string IsolationModded = "modded";
        public const string IsolationNone = "none";

        /// <summary>默认游戏目录：exe 同级的 .minecraft（便携）。</summary>
        public static string DefaultDir => Path.Combine(AppContext.BaseDirectory, ".minecraft");

        /// <summary>把网页传来的策略收敛到三个合法值，非法值一律当「隔离所有版本」。</summary>
        public static string Normalize(string? isolation)
        {
            switch (isolation)
            {
                case IsolationModded:
                    return IsolationModded;
                case IsolationNone:
                    return IsolationNone;
                default:
                    return IsolationAll;
            }
        }

        /// <summary>
        /// 归一化路径：去空白、补全绝对路径、去掉结尾的分隔符。
        /// 非法路径（含非法字符等）返回空串，调用方当作没选。
        /// </summary>
        public static string NormalizePath(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return string.Empty;
            try
            {
                string full = Path.GetFullPath(path!.Trim());

                // 盘符根目录（D:\）去掉分隔符会变成相对路径，得原样留着
                bool isRoot = full.Length <= 3 && full.EndsWith(":\\", StringComparison.Ordinal);
                string trimmed = isRoot ? full : full.TrimEnd('\\', '/');
                return trimmed;
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }

        /// <summary>由路径算出的短 ID，同一个目录永远得到同一个值。</summary>
        public static string MakeId(string path)
        {
            uint hash = 2166136261;
            string key = NormalizePath(path).ToLowerInvariant();
            foreach (char ch in key)
            {
                hash ^= ch;
                hash *= 16777619;
            }
            return "d" + hash.ToString("x8");
        }

        /// <summary>所有登记过的文件夹，内置的 .minecraft 一定在第一个。</summary>
        public static List<GameDirEntry> ResolveAll() => LauncherConfigStore.Current.GameDirs;

        /// <summary>当前文件夹（侧栏高亮、导入整合包的目标）；记录失效时回到内置目录。</summary>
        public static GameDirEntry Active()
        {
            var list = ResolveAll();
            string active = NormalizePath(LauncherConfigStore.Current.ActiveDir);
            return list.FirstOrDefault(item => string.Equals(item.Path, active, StringComparison.OrdinalIgnoreCase))
                ?? list[0];
        }

        /// <summary>按路径找登记项；网页传来的路径必须先过这里，才允许做任何操作。</summary>
        public static GameDirEntry? Find(string? path)
        {
            string full = NormalizePath(path);
            if (full.Length == 0) return null;
            return ResolveAll().FirstOrDefault(item =>
                string.Equals(item.Path, full, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>当前生效的游戏目录（可能是已失效的路径，由调用方决定怎么提示）。</summary>
        public static string Resolve(out bool isCustom)
        {
            var active = Active();
            isCustom = !active.BuiltIn;
            return active.Path;
        }

        /// <summary>确保目录和 versions 子目录存在。首次运行时这就等于「重新生成 .minecraft」。</summary>
        public static void Ensure(string dir)
        {
            Directory.CreateDirectory(dir);
            Directory.CreateDirectory(Path.Combine(dir, "versions"));
        }

        /// <summary>判断一个文件夹是不是像游戏目录：有 versions / launcher_profiles.json / 常见的存档目录。</summary>
        public static bool LooksLikeGameDir(string dir)
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return false;
            if (Directory.Exists(Path.Combine(dir, "versions"))) return true;
            if (File.Exists(Path.Combine(dir, "launcher_profiles.json"))) return true;
            return Directory.Exists(Path.Combine(dir, "saves")) || Directory.Exists(Path.Combine(dir, "mods"));
        }

        /// <summary>
        /// 把用户选中的文件夹收敛成真正的游戏目录：
        /// 选到 .minecraft 的父目录时往下找一层；选到空文件夹时原地建成新的游戏目录。
        /// </summary>
        public static string ResolveSelection(string folder)
        {
            string full = NormalizePath(folder);
            if (full.Length == 0) return string.Empty;
            if (LooksLikeGameDir(full)) return full;

            string child = NormalizePath(Path.Combine(full, ".minecraft"));
            if (child.Length > 0 && LooksLikeGameDir(child)) return child;

            return full;
        }

        /// <summary>登记一个文件夹；已经在列表里就原样返回（不重复、不改隔离设置）。</summary>
        public static GameDirEntry? Add(string folder, string isolation)
        {
            string full = ResolveSelection(folder);
            if (full.Length == 0) return null;

            var config = LauncherConfigStore.Current;
            var existing = config.GameDirs.FirstOrDefault(item =>
                string.Equals(item.Path, full, StringComparison.OrdinalIgnoreCase));
            if (existing != null) return existing;

            var entry = new GameDirEntry
            {
                Id = MakeId(full),
                Path = full,
                Isolation = Normalize(isolation)
            };
            config.GameDirs.Add(entry);
            return entry;
        }

        /// <summary>移除一个文件夹。内置的 .minecraft 不允许移除。</summary>
        public static bool Remove(string path)
        {
            var entry = Find(path);
            if (entry == null || entry.BuiltIn) return false;

            var config = LauncherConfigStore.Current;
            config.GameDirs.Remove(entry);

            // 当前文件夹被删掉了：回到内置目录
            if (string.Equals(NormalizePath(config.ActiveDir), entry.Path, StringComparison.OrdinalIgnoreCase))
            {
                config.ActiveDir = NormalizePath(DefaultDir);
            }
            return true;
        }

        /// <summary>改某个文件夹的隔离策略；路径必须已登记。</summary>
        public static bool SetIsolation(string path, string isolation)
        {
            var entry = Find(path);
            if (entry == null) return false;
            entry.Isolation = Normalize(isolation);
            return true;
        }

        /// <summary>切换当前文件夹；路径必须已登记。</summary>
        public static bool SetActive(string path)
        {
            var entry = Find(path);
            if (entry == null) return false;
            LauncherConfigStore.Current.ActiveDir = entry.Path;
            return true;
        }

        /// <summary>清掉所有自定义文件夹，只留内置的 .minecraft。</summary>
        public static void Reset()
        {
            var config = LauncherConfigStore.Current;
            config.GameDirs.RemoveAll(item => !item.BuiltIn);
            config.ActiveDir = NormalizePath(DefaultDir);
        }
    }

    /// <summary>启动器自己的配置，只存宿主需要知道的东西（网页端的设置仍在 localStorage）。</summary>
    internal sealed class LauncherConfig
    {
        /// <summary>登记过的游戏文件夹，第一个永远是内置的 .minecraft。</summary>
        public List<GameDirEntry> GameDirs { get; set; } = new List<GameDirEntry>();

        /// <summary>当前文件夹（侧栏选中的那个）。</summary>
        public string? ActiveDir { get; set; }

        /// <summary>
        /// 旧版单目录字段，只在读取老配置时出现，迁移完就清空。
        /// 保留定义是为了让老版本配置能被完整反序列化，不要当成有效数据用。
        /// </summary>
        public string? GameDir { get; set; }

        /// <summary>新添加文件夹时的默认隔离策略。</summary>
        /// <remarks>
        /// 这里必须写全命名空间：属性 GameDirs 和静态类 GameDirs 同名，
        /// 属性初始值设定项里的裸名会先绑定到这个属性上（CS0236）。
        /// </remarks>
        public string Isolation { get; set; } = StarLaunch.Services.GameDirs.IsolationAll;
    }

    /// <summary>StarLaunch.config.json 的读写。exe 同级不可写时退回 %LOCALAPPDATA%\StarLaunch。</summary>
    internal static class LauncherConfigStore
    {
        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private static LauncherConfig? _current;
        private static string? _path;
        private static string? _folder;

        /// <summary>配置文件所在目录（Custom.xaml 等用户文件也放这里）。</summary>
        public static string Folder
        {
            get
            {
                if (_folder == null)
                {
                    string file = _path ?? ResolvePath();
                    _folder = Path.GetDirectoryName(file) ?? AppContext.BaseDirectory;
                }
                return _folder;
            }
        }

        public static LauncherConfig Current
        {
            get
            {
                if (_current == null)
                {
                    _path = ResolvePath();
                    _current = LoadFrom(_path);
                }
                return _current;
            }
        }

        public static void Save()
        {
            try
            {
                string path = _path ?? ResolvePath();
                File.WriteAllText(path, JsonSerializer.Serialize(Current, SerializerOptions));
            }
            catch (Exception)
            {
                // 配置写不进去不影响使用，下次启动回落到默认值
            }
        }

        private static LauncherConfig LoadFrom(string path)
        {
            LauncherConfig config;
            try
            {
                if (!File.Exists(path))
                {
                    config = new LauncherConfig();
                }
                else
                {
                    config = JsonSerializer.Deserialize<LauncherConfig>(File.ReadAllText(path), SerializerOptions)
                        ?? new LauncherConfig();
                }
            }
            catch (Exception)
            {
                // 配置文件损坏：丢弃内容，重新开始
                config = new LauncherConfig();
            }

            return Normalize(config);
        }

        /// <summary>
        /// 把配置收敛成「至少有一个内置 .minecraft」的形状，并顺手迁移老版本的单目录配置。
        /// 读盘和运行期都会走到这里，所以手改配置文件也不会把界面搞坏。
        /// </summary>
        private static LauncherConfig Normalize(LauncherConfig config)
        {
            config.Isolation = GameDirs.Normalize(config.Isolation);

            if (config.GameDirs == null) config.GameDirs = new List<GameDirEntry>();

            // 老配置只有一个自定义目录：当成一个自定义文件夹迁过来
            string legacy = GameDirs.NormalizePath(config.GameDir);
            if (config.GameDirs.Count == 0 && legacy.Length > 0)
            {
                config.GameDirs.Add(new GameDirEntry
                {
                    Path = legacy,
                    Isolation = config.Isolation
                });
            }
            config.GameDir = null;

            var entries = new List<GameDirEntry>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in config.GameDirs)
            {
                string full = GameDirs.NormalizePath(entry.Path);
                if (full.Length == 0 || !seen.Add(full)) continue;

                entry.Path = full;
                entry.Id = GameDirs.MakeId(full);
                entry.Isolation = GameDirs.Normalize(entry.Isolation);
                entry.BuiltIn = false;
                entries.Add(entry);
            }

            // 内置目录永远在，而且排第一个
            string defaultPath = GameDirs.NormalizePath(GameDirs.DefaultDir);
            var builtIn = entries.FirstOrDefault(item =>
                string.Equals(item.Path, defaultPath, StringComparison.OrdinalIgnoreCase));
            if (builtIn == null)
            {
                builtIn = new GameDirEntry { Path = defaultPath, Isolation = config.Isolation };
                entries.Insert(0, builtIn);
            }
            else
            {
                entries.Remove(builtIn);
                entries.Insert(0, builtIn);
            }
            builtIn.BuiltIn = true;

            config.GameDirs = entries;

            string active = GameDirs.NormalizePath(config.ActiveDir);
            bool activeKnown = entries.Any(item =>
                string.Equals(item.Path, active, StringComparison.OrdinalIgnoreCase));
            config.ActiveDir = activeKnown ? active : defaultPath;

            return config;
        }

        private static string ResolvePath()
        {
            try
            {
                string probe = Path.Combine(AppContext.BaseDirectory, ".write-test");
                File.WriteAllText(probe, string.Empty);
                File.Delete(probe);
                return Path.Combine(AppContext.BaseDirectory, "StarLaunch.config.json");
            }
            catch (Exception)
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "StarLaunch");
                Directory.CreateDirectory(dir);
                return Path.Combine(dir, "StarLaunch.config.json");
            }
        }
    }
}
