/*=====================================================================
   StarLaunch · 加载器安装
   ---------------------------------------------------------------------
   两种路子：

     ① Fabric / Quilt —— 纯下载。官方给的 profile JSON 本身就是一份
        版本定义（带 inheritsFrom 和 libraries），存到
        versions/<id>/<id>.json 再把它列的库下到 libraries/ 就完事，
        不需要 Java。

     ② Forge / NeoForge —— 必须跑官方安装器 jar。它会自己往 .minecraft
        里写版本 JSON、库、以及需要 patch 的原版文件，所以这里只负责
        下载安装器、找一台合适的 Java、把 --installClient 指过去，
        然后检查 versions 下有没有冒出对应的版本。

     OptiFine 没有公开下载接口，只能引导用户去官网（PCL 也是这么做的）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    internal static class LoaderInstaller
    {
        private const string ForgeMaven = "https://maven.minecraftforge.net/";
        private const string NeoForgeMavenMirror = "https://bmclapi2.bangbang93.com/maven/";
        private const string NeoForgeMaven = "https://maven.neoforged.net/releases/";
        private const string FabricProfileMirror = "https://bmclapi2.bangbang93.com/fabric-meta";
        private const string FabricProfile = "https://meta.fabricmc.net";
        private const string QuiltProfile = "https://meta.quiltmc.org";

        /// <summary>
        /// 装一个加载器。返回一句给界面的说明；失败抛 HttpError（消息直接可读）。
        /// 调用前应该已经装好对应的原版版本。
        /// </summary>
        public static async Task<string> InstallAsync(
            DownloadJob job, string gameDir, string mcVersion, string loaderKey, string loaderVersion,
            CancellationToken token)
        {
            string loader = LoaderCatalog.NormalizeLoader(loaderKey);
            string version = (loaderVersion ?? string.Empty).Trim();

            switch (loader)
            {
                case LoaderCatalog.Fabric:
                    return await InstallFromProfileAsync(
                        job, gameDir, mcVersion, loader, version,
                        new[]
                        {
                            FabricProfileMirror + "/v2/versions/loader/" + Uri.EscapeDataString(mcVersion) + "/" +
                            Uri.EscapeDataString(version) + "/profile/json",
                            FabricProfile + "/v2/versions/loader/" + Uri.EscapeDataString(mcVersion) + "/" +
                            Uri.EscapeDataString(version) + "/profile/json"
                        }, token).ConfigureAwait(false);

                case LoaderCatalog.Quilt:
                    return await InstallFromProfileAsync(
                        job, gameDir, mcVersion, loader, version,
                        new[]
                        {
                            QuiltProfile + "/v3/versions/loader/" + Uri.EscapeDataString(mcVersion) + "/" +
                            Uri.EscapeDataString(version) + "/profile/json"
                        }, token).ConfigureAwait(false);

                case LoaderCatalog.Forge:
                case LoaderCatalog.NeoForge:
                    return await RunInstallerAsync(job, gameDir, mcVersion, loader, version, token)
                        .ConfigureAwait(false);

                case LoaderCatalog.OptiFine:
                    throw new HttpError("OptiFine 需要到 optifine.net 手动下载后自己放进 versions 目录");

                default:
                    return "原版";
            }
        }

        /* -----------------------------------------------------------------
           ① profile JSON 路线（Fabric / Quilt）
           ----------------------------------------------------------------- */

        private static async Task<string> InstallFromProfileAsync(
            DownloadJob job, string gameDir, string mcVersion, string loader, string version,
            string[] profileUrls, CancellationToken token)
        {
            if (version.Length == 0) throw new HttpError("没有指定 " + LoaderCatalog.DisplayName(loader) + " 的版本");

            job.SetPhase("正在获取 " + LoaderCatalog.DisplayName(loader) + " 的版本信息…");

            string? body = null;
            foreach (string url in profileUrls)
            {
                body = await TryGetAsync(url, token).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(body)) break;
            }
            if (string.IsNullOrWhiteSpace(body))
            {
                throw new HttpError("拿不到 " + LoaderCatalog.DisplayName(loader) + " " + version + " 的版本信息");
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(body!);
            }
            catch (JsonException)
            {
                throw new HttpError("加载器返回的版本信息不是有效 JSON");
            }

            using (document)
            {
                var root = document.RootElement;
                string id = JsonRead.String(root, "id");
                if (id.Length == 0)
                {
                    id = loader + "-loader-" + version + "-" + mcVersion;
                }

                string versionDir = Path.Combine(gameDir, "versions", id);
                Directory.CreateDirectory(versionDir);

                /* 版本 JSON：原样保存 profile，补上 inheritsFrom（Fabric 一般自带） */
                string jsonPath = Path.Combine(versionDir, id + ".json");
                if (JsonRead.String(root, "inheritsFrom").Length == 0)
                {
                    var patched = JsonSerializer.Deserialize<Dictionary<string, object?>>(body!) ??
                                  new Dictionary<string, object?>();
                    patched["inheritsFrom"] = mcVersion;
                    await File.WriteAllTextAsync(
                        jsonPath, JsonSerializer.Serialize(patched, new JsonSerializerOptions { WriteIndented = true }),
                        token).ConfigureAwait(false);
                }
                else
                {
                    await File.WriteAllTextAsync(jsonPath, body!, token).ConfigureAwait(false);
                }

                /* 运行库 */
                var libraries = JsonRead.Array(root, "libraries");
                var tasks = new List<(string Url, string Path, string? Sha1, long Size)>();
                if (libraries.ValueKind == JsonValueKind.Array)
                {
                    string librariesRoot = Path.Combine(gameDir, "libraries");
                    foreach (var library in libraries.EnumerateArray())
                    {
                        string relative = MavenPath(JsonRead.String(library, "name"));
                        if (relative.Length == 0) continue;

                        string baseUrl = JsonRead.String(library, "url");
                        if (baseUrl.Length == 0) baseUrl = FabricProfile + "/";

                        string sha1 = JsonRead.String(library, "sha1");
                        tasks.Add((
                            baseUrl.TrimEnd('/') + "/" + relative,
                            Path.Combine(librariesRoot, relative.Replace('/', Path.DirectorySeparatorChar)),
                            sha1.Length > 0 ? sha1 : null,
                            JsonRead.Long(library, "size")));
                    }
                }

                job.SetPhase("正在下载 " + LoaderCatalog.DisplayName(loader) + " 的运行库");
                job.SetCount(0, tasks.Count);
                job.SetTotalBytes(tasks.Sum(item => Math.Max(0, item.Size)));

                using (var gate = new SemaphoreSlim(Math.Max(2, DownloadManager.Parallelism / 2)))
                {
                    var running = new List<Task>(tasks.Count);
                    foreach (var task in tasks)
                    {
                        await gate.WaitAsync(token).ConfigureAwait(false);
                        running.Add(Task.Run(async () =>
                        {
                            try
                            {
                                if (!IsUpToDate(task.Path, task.Size))
                                {
                                    await JsonHttp.DownloadFileAsync(
                                        Mirrors.Rewrite(task.Url), task.Path, task.Sha1, null, token)
                                        .ConfigureAwait(false);
                                }
                                job.Step(tasks.Count);
                            }
                            finally
                            {
                                gate.Release();
                            }
                        }));
                    }
                    await Task.WhenAll(running).ConfigureAwait(false);
                }

                return "已安装 " + LoaderCatalog.DisplayName(loader) + " " + version +
                       "（" + id + "，共 " + tasks.Count + " 个运行库）";
            }
        }

        /* -----------------------------------------------------------------
           ② 官方安装器路线（Forge / NeoForge）
           ----------------------------------------------------------------- */

        private static async Task<string> RunInstallerAsync(
            DownloadJob job, string gameDir, string mcVersion, string loader, string version,
            CancellationToken token)
        {
            if (version.Length == 0) throw new HttpError("没有指定 " + LoaderCatalog.DisplayName(loader) + " 的版本");

            string name = LoaderCatalog.DisplayName(loader);
            string fileName;
            var urls = new List<string>();

            if (loader == LoaderCatalog.Forge)
            {
                fileName = "forge-" + mcVersion + "-" + version + "-installer.jar";
                string relative = "net/minecraftforge/forge/" + mcVersion + "-" + version + "/" + fileName;
                urls.Add(Mirrors.ToMirror(ForgeMaven + relative));
                urls.Add(ForgeMaven + relative);
            }
            else
            {
                fileName = "neoforge-" + version + "-installer.jar";
                string relative = "net/neoforged/neoforge/" + version + "/" + fileName;
                urls.Add(NeoForgeMavenMirror + relative);
                urls.Add(NeoForgeMaven + relative);
            }

            string temp = Path.Combine(Path.GetTempPath(), "StarLaunch-loader-" + Guid.NewGuid().ToString("n"));
            Directory.CreateDirectory(temp);
            string installer = Path.Combine(temp, fileName);

            try
            {
                job.SetPhase("正在下载 " + name + " 安装器…");
                HttpError? lastError = null;
                foreach (string url in urls)
                {
                    try
                    {
                        await JsonHttp.DownloadFileAsync(url, installer, null, null, token).ConfigureAwait(false);
                        lastError = null;
                        break;
                    }
                    catch (HttpError ex)
                    {
                        lastError = ex;
                    }
                }
                if (lastError != null || !File.Exists(installer))
                {
                    throw new HttpError("下载 " + name + " 安装器失败：" + (lastError?.Message ?? "文件不存在"));
                }

                /* 安装器会检查 launcher_profiles.json 是否存在 */
                EnsureLauncherProfiles(gameDir);

                int required = RequiredJava(mcVersion, loader);
                var java = JavaRuntime.Best(required) ?? JavaRuntime.Best(8);
                if (java == null)
                {
                    throw new HttpError(
                        "没找到可用的 Java，" + name + " 需要用它跑一次安装器。" +
                        "装一个 Java " + required + "+ 之后再试，或者手动运行刚下载的安装器");
                }

                job.SetPhase("正在运行 " + name + " 安装器（Java " + java.Major + "）…");
                var (exitCode, output) = await RunProcessAsync(
                    java.Path, BuildInstallerArguments(installer, gameDir, mcVersion), gameDir, token)
                    .ConfigureAwait(false);

                if (exitCode != 0)
                {
                    throw new HttpError(name + " 安装器退出码 " + exitCode + "：" + Tail(output));
                }

                string? installed = FindInstalledVersion(gameDir, mcVersion, loader);
                if (installed == null)
                {
                    throw new HttpError(name + " 安装器跑完了，但 versions 里没找到对应的版本：" + Tail(output));
                }

                return "已安装 " + name + " " + version + "（" + installed + "）";
            }
            finally
            {
                try
                {
                    if (Directory.Exists(temp)) Directory.Delete(temp, true);
                }
                catch (Exception)
                {
                    // 临时目录删不掉交给系统清理
                }
            }
        }

        private static string BuildInstallerArguments(string installer, string gameDir, string mcVersion)
        {
            // 1.13 以前的安装器没有 --installClient，只认当前工作目录
            if (IsLegacy(mcVersion)) return "-jar \"" + installer + "\"";
            return "-jar \"" + installer + "\" --installClient \"" + gameDir + "\"";
        }

        /// <summary>Forge 1.13+ 需要 Java 17 跑安装器；老版本 8 就够。NeoForge 起点更高。</summary>
        private static int RequiredJava(string mcVersion, string loader)
        {
            if (loader == LoaderCatalog.NeoForge) return 21;
            if (IsLegacy(mcVersion)) return 8;

            var (major, minor) = ParseMinecraftVersion(mcVersion);
            if (major > 1) return 21;
            if (minor >= 17) return 17;
            return 8;
        }

        private static bool IsLegacy(string mcVersion)
        {
            var (major, minor) = ParseMinecraftVersion(mcVersion);
            return major == 1 && minor <= 12;
        }

        private static (int Major, int Minor) ParseMinecraftVersion(string? version)
        {
            if (string.IsNullOrWhiteSpace(version)) return (1, 0);

            string[] parts = version!.Trim().Split('.');
            int major = 0;
            int minor = 0;
            if (parts.Length > 0) int.TryParse(parts[0], out major);
            if (parts.Length > 1) int.TryParse(parts[1], out minor);
            return (major, minor);
        }

        /// <summary>versions 下找一个 name 里带加载器标记、且 inheritsFrom 是这个原版版本的目录。</summary>
        private static string? FindInstalledVersion(string gameDir, string mcVersion, string loader)
        {
            string versions = Path.Combine(gameDir, "versions");
            if (!Directory.Exists(versions)) return null;

            string marker = loader == LoaderCatalog.Forge ? "-forge-" : "-neoforge-";
            foreach (string folder in Directory.EnumerateDirectories(versions))
            {
                string name = Path.GetFileName(folder);
                if (name.IndexOf(marker, StringComparison.OrdinalIgnoreCase) < 0) continue;

                string json = Path.Combine(folder, name + ".json");
                if (!File.Exists(json)) continue;

                try
                {
                    using var document = JsonDocument.Parse(File.ReadAllText(json));
                    string inherits = JsonRead.String(document.RootElement, "inheritsFrom");
                    if (inherits.Length == 0 || inherits.Equals(mcVersion, StringComparison.OrdinalIgnoreCase))
                    {
                        return name;
                    }
                }
                catch (Exception ex) when (ex is IOException || ex is JsonException)
                {
                    // 坏 json 跳过
                }
            }
            return null;
        }

        private static void EnsureLauncherProfiles(string gameDir)
        {
            string path = Path.Combine(gameDir, "launcher_profiles.json");
            if (File.Exists(path)) return;

            try
            {
                File.WriteAllText(path,
                    "{\"profiles\":{},\"settings\":{\"enableSnapshots\":false},\"version\":3}");
            }
            catch (Exception)
            {
                // 写不进去就让安装器自己报错
            }
        }

        private static async Task<(int ExitCode, string Output)> RunProcessAsync(
            string fileName, string arguments, string workingDirectory, CancellationToken token)
        {
            var output = new StringBuilder();

            var start = new ProcessStartInfo(fileName, arguments)
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = new Process { StartInfo = start };
            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data == null) return;
                lock (output) output.AppendLine(e.Data);
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data == null) return;
                lock (output) output.AppendLine(e.Data);
            };

            if (!process.Start()) throw new HttpError("启动安装器进程失败");

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            // 安装器可能要跑几分钟：每 200ms 看一次，顺便响应取消
            while (!process.WaitForExit(200))
            {
                if (token.IsCancellationRequested)
                {
                    try { process.Kill(true); } catch (Exception) { }
                    token.ThrowIfCancellationRequested();
                }
            }
            process.WaitForExit();

            lock (output)
            {
                return (process.ExitCode, output.ToString());
            }
        }

        private static string Tail(string output)
        {
            if (string.IsNullOrWhiteSpace(output)) return "（安装器没有输出）";

            var lines = output.Replace("\r", string.Empty)
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Where(line => line.Trim().Length > 0)
                .ToList();
            if (lines.Count > 12) lines = lines.Skip(lines.Count - 12).ToList();
            return string.Join(" / ", lines).Trim();
        }

        /* -----------------------------------------------------------------
           小工具
           ----------------------------------------------------------------- */

        /// <summary>net.fabricmc:fabric-loader:0.16.5 → net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar</summary>
        internal static string MavenPath(string? coordinate)
        {
            if (string.IsNullOrWhiteSpace(coordinate)) return string.Empty;

            string[] parts = coordinate!.Trim().Split(':');
            if (parts.Length < 3) return string.Empty;

            string group = parts[0];
            string artifact = parts[1];
            string version = parts[2];
            string classifier = parts.Length > 3 ? parts[3] : string.Empty;

            string file = artifact + "-" + version + (classifier.Length > 0 ? "-" + classifier : string.Empty) + ".jar";
            return group.Replace('.', '/') + "/" + artifact + "/" + version + "/" + file;
        }

        private static bool IsUpToDate(string path, long size)
        {
            try
            {
                if (!File.Exists(path)) return false;
                if (size <= 0) return true;
                return new FileInfo(path).Length == size;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return false;
            }
        }

        /// <summary>取文本（地址已经选好源，不再走 Mirrors.Rewrite，原因见 LoaderCatalog）。</summary>
        private static async Task<string?> TryGetAsync(string url, CancellationToken token)
        {
            try
            {
                return await JsonHttp.GetStringAsync(url, token).ConfigureAwait(false);
            }
            catch (HttpError)
            {
                return null;
            }
        }
    }
}
