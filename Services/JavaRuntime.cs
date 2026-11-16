/*=====================================================================
   StarLaunch · Java 运行时查找
   ---------------------------------------------------------------------
   Forge / NeoForge 的安装器是 jar，得用 Java 跑一遍才能把版本装进
   .minecraft。启动器还没有完整的 Java 管理，但「找到一台能跑的 Java」
   这件事本身不难：

     · JAVA_HOME
     · PATH 里的 java.exe
     · 常见安装目录（Adoptium / Oracle / Microsoft / Zulu / Corretto / BellSoft）
     · 微软启动器自带的 runtime（.minecraft\runtime\...）
     · 游戏文件夹里的 runtime

   每个候选跑一次 `java -version` 读出大版本号，按版本从高到低排。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace StarLaunch.Services
{
    internal sealed class JavaInstall
    {
        public string Path { get; set; } = string.Empty;
        public int Major { get; set; }
        public string Version { get; set; } = string.Empty;
        public string Source { get; set; } = string.Empty;
    }

    internal static class JavaRuntime
    {
        private static readonly object Gate = new object();
        private static List<JavaInstall>? _cache;
        private static List<string> _failures = new List<string>();

        /// <summary>上一轮扫描里「找到了但读不出来」的 Java（路径 + 原因）。</summary>
        public static IReadOnlyList<string> Failures
        {
            get { lock (Gate) return _failures.ToArray(); }
        }

        /// <summary>扫描本机的 Java（结果缓存；refresh 为真时重扫）。</summary>
        public static List<JavaInstall> Discover(bool refresh = false)
        {
            lock (Gate)
            {
                if (_cache != null && !refresh) return _cache;

                var found = new List<JavaInstall>();
                var failures = new List<string>();
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var candidate in Candidates())
                {
                    string full;
                    try
                    {
                        full = Path.GetFullPath(candidate);
                    }
                    catch (Exception)
                    {
                        continue;
                    }
                    if (!File.Exists(full) || !seen.Add(full)) continue;

                    var info = Probe(full, out string? reason);
                    if (info != null) found.Add(info);
                    else if (reason != null) failures.Add(full + "（" + reason + "）");
                }

                _failures = failures;
                // 一个都没认出来时不要缓存：探测失败常常是「当时内存不够」这类一次性原因，
                // 缓存成空列表会让用户腾出内存后重试也永远说「没有 Java」。
                _cache = found.Count == 0
                    ? null
                    : found.OrderByDescending(item => item.Major).ThenBy(item => item.Path).ToList();
                return _cache ?? found;
            }
        }

        /// <summary>给报错用的一句话：扫到几个、为什么都用不了。</summary>
        public static string Describe()
        {
            var list = Discover();
            var failures = Failures;
            if (list.Count > 0)
            {
                return "本机可用的 Java：" + string.Join("、", list.Select(item => "Java " + item.Version));
            }
            if (failures.Count == 0)
            {
                return "本机没有扫到任何 java.exe（JAVA_HOME、PATH、常见安装目录、游戏自带的 runtime 都找过了）。";
            }

            return "扫到 " + failures.Count + " 个 java.exe，但都没能启动：\n" +
                string.Join("\n", failures.Take(4).Select(item => "· " + item)) +
                (failures.Count > 4 ? "\n…" : string.Empty) +
                "\n\n常见原因是系统内存 / 页面文件不够，或者这个 Java 装坏了。";
        }

        /// <summary>
        /// 找一台够用的 Java。
        /// 1.20.1 要 17 就用 17 —— 以前是「取最高的」，会拿 Java 24 去跑 1.20.1，
        /// 加载器和模组经常当场翻脸；所以精确匹配优先，其次才是「够用的最小版本」。
        /// 同一个版本号下，真实 JDK 目录优先于 Oracle 的 javapath 跳板。
        /// </summary>
        public static JavaInstall? Best(int minMajor)
        {
            var list = Discover();
            if (list.Count == 0) return null;

            var candidates = list.Where(item => item.Major >= minMajor).ToList();
            if (candidates.Count == 0) return null;

            return candidates
                .OrderBy(item => item.Major == minMajor ? 0 : 1)
                .ThenBy(item => item.Major)
                .ThenBy(item => IsShimPath(item.Path) ? 1 : 0)
                .ThenBy(item => item.Path, StringComparer.OrdinalIgnoreCase)
                .First();
        }

        /// <summary>Oracle / 部分安装器放的 javapath 跳板目录，优先级最低。</summary>
        private static bool IsShimPath(string path)
        {
            return path.IndexOf("\\javapath\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   path.IndexOf("/javapath/", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>读某一个具体的 java.exe（手填路径时用）；读不出返回 null。</summary>
        public static JavaInstall? Read(string javaPath)
        {
            return Probe(javaPath, out _);
        }

        /* -----------------------------------------------------------------
           候选
           ----------------------------------------------------------------- */

        private static IEnumerable<string> Candidates()
        {
            string exe = OperatingSystem.IsWindows() ? "java.exe" : "java";

            string? home = Environment.GetEnvironmentVariable("JAVA_HOME");
            if (!string.IsNullOrWhiteSpace(home))
            {
                yield return Path.Combine(home!.Trim(), "bin", exe);
            }

            string? path = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrWhiteSpace(path))
            {
                foreach (string folder in path!.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (folder.Trim().Length == 0) continue;
                    yield return Path.Combine(folder.Trim(), exe);
                }
            }

            foreach (string root in VendorRoots())
            {
                foreach (string candidate in ScanRoot(root, 3, exe)) yield return candidate;
            }

            // 官方启动器 / 启动器自己带的 runtime
            foreach (string gameRoot in GameRoots())
            {
                string runtime = Path.Combine(gameRoot, "runtime");
                foreach (string candidate in ScanRoot(runtime, 4, exe)) yield return candidate;
            }
        }

        private static IEnumerable<string> VendorRoots()
        {
            var roots = new List<string>();
            foreach (string variable in new[] { "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA" })
            {
                string? value = Environment.GetEnvironmentVariable(variable);
                if (string.IsNullOrWhiteSpace(value)) continue;

                foreach (string vendor in new[]
                {
                    "Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Zulu",
                    "BellSoft", "Amazon Corretto", "Semeru", "Temurin", "JetBrains"
                })
                {
                    roots.Add(Path.Combine(value!, vendor));
                }
                // 有些发行版放在 LOCALAPPDATA\Programs 下
                roots.Add(Path.Combine(value!, "Programs", "Java"));
                roots.Add(Path.Combine(value!, "Programs", "Eclipse Adoptium"));
            }
            return roots.Where(Directory.Exists);
        }

        private static IEnumerable<string> GameRoots()
        {
            foreach (var entry in GameDirs.ResolveAll())
            {
                if (!string.IsNullOrWhiteSpace(entry.Path)) yield return entry.Path;
            }
            yield return GameDirs.DefaultDir;
        }

        /// <summary>在 root 下按深度找 java.exe（找不到目录就直接空手而归）。</summary>
        private static IEnumerable<string> ScanRoot(string? root, int depth, string exe)
        {
            var results = new List<string>();
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return results;

            var queue = new Queue<(string Folder, int Depth)>();
            queue.Enqueue((root!, 0));
            int visited = 0;

            while (queue.Count > 0 && visited < 400)
            {
                var (folder, level) = queue.Dequeue();
                visited++;

                string direct = Path.Combine(folder, "bin", exe);
                if (File.Exists(direct)) results.Add(direct);

                if (level >= depth) continue;
                try
                {
                    foreach (string child in Directory.EnumerateDirectories(folder))
                    {
                        string name = Path.GetFileName(child);
                        // 跳过明显不是 JDK 的目录，省得扫爆磁盘
                        if (name.Equals("webview2data", StringComparison.OrdinalIgnoreCase)) continue;
                        queue.Enqueue((child, level + 1));
                    }
                }
                catch (Exception)
                {
                    // 权限不够就跳过这个目录
                }
            }
            return results;
        }

        /* -----------------------------------------------------------------
           读版本
           ----------------------------------------------------------------- */

        private static JavaInstall? Probe(string path, out string? reason)
        {
            reason = null;

            // 1. 先读 JDK 自带的 release 文件。不发子进程就完全没有成本，
            //    系统内存吃紧（`java -version` 都会 OOM 崩溃）时也能认出 Java。
            string home = HomeOf(path);
            if (home != null)
            {
                var released = ReadRelease(home);
                if (released.Major > 0)
                {
                    return new JavaInstall
                    {
                        Path = path,
                        Version = released.Version,
                        Major = released.Major,
                        Source = path
                    };
                }
            }

            // 2. 老 JDK 没有 release 文件，只能跑一次 -version；堆参数压到最小，
            //    免得在这台机器上「探测」把 JVM 自己撑死（HS 会写 hs_err 到工作目录）。
            try
            {
                var start = new ProcessStartInfo(path)
                {
                    Arguments = "-Xms8m -Xmx64m -XX:MaxMetaspaceSize=64m -version",
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(start);
                if (process == null)
                {
                    reason = "进程起不来";
                    return null;
                }

                string output = process.StandardError.ReadToEnd() + process.StandardOutput.ReadToEnd();
                if (!process.WaitForExit(6000))
                {
                    try { process.Kill(true); } catch (Exception) { }
                    reason = "6 秒没有响应";
                    return null;
                }

                var (version, major) = ParseVersion(output);
                if (major <= 0)
                {
                    // 3. 进程崩了也要尽量给一个版本号：先看输出，再猜目录名
                    major = GuessMajorFromPath(path);
                    if (major <= 0)
                    {
                        reason = process.ExitCode == 0
                            ? "读不出版本号"
                            : "java -version 直接退出（退出码 " + process.ExitCode + "，多半是内存或页面文件不够）";
                        return null;
                    }
                    version = version.Length > 0 ? version : "?" + major;
                }

                return new JavaInstall
                {
                    Path = path,
                    Version = version,
                    Major = major,
                    Source = path
                };
            }
            catch (Exception ex)
            {
                reason = ex.Message;
                return null;
            }
        }

        /// <summary>java.exe → JDK 根目录（…\bin\java.exe → …）。</summary>
        private static string? HomeOf(string javaExe)
        {
            try
            {
                string? bin = Path.GetDirectoryName(javaExe);
                if (string.IsNullOrEmpty(bin)) return null;
                if (Path.GetFileName(bin).Equals("bin", StringComparison.OrdinalIgnoreCase))
                {
                    return Path.GetDirectoryName(bin);
                }
                return bin;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>读 &lt;home&gt;\release 里的 JAVA_VERSION="21.0.1"。</summary>
        private static (string Version, int Major) ReadRelease(string home)
        {
            foreach (string file in new[] { Path.Combine(home, "release"), Path.Combine(home, "lib", "release") })
            {
                try
                {
                    if (!File.Exists(file)) continue;
                    foreach (string line in File.ReadLines(file))
                    {
                        string text = line.Trim();
                        if (!text.StartsWith("JAVA_VERSION=", StringComparison.Ordinal)) continue;

                        string value = text.Substring("JAVA_VERSION=".Length).Trim().Trim('"');
                        int major = GuessMajor(value);
                        if (major > 0) return (value, major);
                    }
                }
                catch (Exception)
                {
                    // 读不到就退回去跑 -version
                }
            }
            return (string.Empty, 0);
        }

        /// <summary>从 `java -version` 的输出里抠版本号：1.8.0_392 → 8，21.0.1 → 21。</summary>
        internal static (string Version, int Major) ParseVersion(string output)
        {
            if (string.IsNullOrWhiteSpace(output)) return (string.Empty, 0);

            int quote = output.IndexOf('"');
            if (quote < 0) return (string.Empty, 0);
            int end = output.IndexOf('"', quote + 1);
            if (end < 0) return (string.Empty, 0);

            string version = output.Substring(quote + 1, end - quote - 1).Trim();
            return (version, GuessMajor(version));
        }

        /// <summary>版本串 → 大版本号（1.8.0_392 → 8，24.0.2+12 → 24）。</summary>
        internal static int GuessMajor(string version)
        {
            if (string.IsNullOrWhiteSpace(version)) return 0;
            string[] parts = version.Trim().Split('.', '_', '-', '+', ' ');
            if (parts.Length == 0) return 0;

            if (parts[0] == "1" && parts.Length > 1)
            {
                int.TryParse(parts[1], out int legacy);
                return legacy;
            }

            int cut = 0;
            while (cut < parts[0].Length && char.IsDigit(parts[0][cut])) cut++;
            return cut > 0 && int.TryParse(parts[0].Substring(0, cut), out int major) ? major : 0;
        }

        /// <summary>实在读不出来时按目录名猜：jdk-21.0.1 / jdk1.8.0_392 / java-17-openjdk。</summary>
        private static int GuessMajorFromPath(string path)
        {
            try
            {
                string folder = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(path)) ?? string.Empty);
                if (string.IsNullOrEmpty(folder)) return 0;

                // jdk1.8.0_392 / jre1.8.0_202 这种老命名
                int pos = folder.IndexOf("1.8", StringComparison.OrdinalIgnoreCase);
                if (pos >= 0) return 8;

                var match = System.Text.RegularExpressions.Regex.Match(folder, @"(?:jdk|jre|java|temurin|jdk-)?-?(\d{1,3})(?:[._-]|$)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out int major) && major >= 6 && major <= 40)
                {
                    return major;
                }
            }
            catch (Exception)
            {
                // 猜不出来就算了
            }
            return 0;
        }
    }
}
