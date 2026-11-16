/*=====================================================================
   StarLaunch · 原版游戏安装（Mojang 版本清单 → 完整依赖）
   ---------------------------------------------------------------------
   一次安装做这些事（和官方启动器下载的东西一致）：

     versions\<id>\<id>.json   版本定义（扫描器就是靠它认出这个版本）
     versions\<id>\<id>.jar    客户端本体
     versions\<id>\natives\    老版本的本地库（解压自 natives-*.jar）
     libraries\...             运行库（按 rules 过滤，只下 Windows 能用的）
     assets\indexes\<id>.json  资源索引
     assets\objects\xx\yyyyy  资源对象（按哈希去重，已存在就跳过）
     assets\log_configs\...    日志配置

   已经存在的文件只要大小对得上就跳过 —— 所以「重装」等于「补缺」，
   中断了再点一次也能接着下。

   没做：Forge / Fabric 这些加载器的安装（它们自己的安装器另算一套流程）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>安装结果：给网页写一句「下载了 N 个文件 / 跳过 M 个」。</summary>
    internal sealed class InstallSummary
    {
        public string VersionId { get; set; } = string.Empty;
        public string VersionDir { get; set; } = string.Empty;
        public int Downloaded { get; set; }
        public int Skipped { get; set; }
        public long Bytes { get; set; }

        public string Describe()
        {
            string size = Bytes > 0 ? "，" + FormatSize(Bytes) : string.Empty;
            return "已安装 Minecraft " + VersionId + "：下载 " + Downloaded + " 个文件" +
                   (Skipped > 0 ? "，跳过 " + Skipped + " 个已存在的文件" : string.Empty) + size;
        }

        public static string FormatSize(long bytes)
        {
            if (bytes >= 1024L * 1024 * 1024) return Math.Round(bytes / 1024.0 / 1024 / 1024, 1) + " GB";
            if (bytes >= 1024L * 1024) return Math.Round(bytes / 1024.0 / 1024, 1) + " MB";
            if (bytes >= 1024) return Math.Round(bytes / 1024.0, 0) + " KB";
            return bytes + " B";
        }
    }

    internal static class MinecraftInstaller
    {
        private static readonly object ManifestGate = new object();
        private static string? _manifestText;
        private static DateTimeOffset _manifestAt = DateTimeOffset.MinValue;

        /// <summary>一个待下载的文件。</summary>
        private sealed class FileTask
        {
            public FileTask(string url, string path, string? sha1, long size)
            {
                Url = url;
                Path = path;
                Sha1 = sha1;
                Size = size;
            }

            public string Url { get; set; }
            public string Path { get; }
            public string? Sha1 { get; }
            public long Size { get; }
        }

        /* -----------------------------------------------------------------
           版本清单
           ----------------------------------------------------------------- */

        /// <summary>版本清单（10 分钟内复用，不给 Mojang 添堵）。调用方负责 Dispose。</summary>
        public static async Task<JsonDocument> GetManifestAsync(CancellationToken token)
        {
            string? text;
            lock (ManifestGate)
            {
                text = DateTimeOffset.UtcNow - _manifestAt < TimeSpan.FromMinutes(10) ? _manifestText : null;
            }

            if (string.IsNullOrEmpty(text))
            {
                text = await JsonHttp
                    .GetStringCandidatesAsync(Mirrors.VersionManifestCandidates, token)
                    .ConfigureAwait(false);
                lock (ManifestGate)
                {
                    _manifestText = text;
                    _manifestAt = DateTimeOffset.UtcNow;
                }
            }

            return JsonDocument.Parse(text!);
        }

        /// <summary>在清单里找版本，拿到它自己的 JSON 地址和 sha1。</summary>
        public static bool TryFindVersion(
            JsonElement manifestRoot, string versionId, out string url, out string? sha1)
        {
            url = string.Empty;
            sha1 = null;
            var versions = JsonRead.Array(manifestRoot, "versions");
            if (versions.ValueKind != JsonValueKind.Array) return false;

            foreach (var item in versions.EnumerateArray())
            {
                if (!string.Equals(JsonRead.String(item, "id"), versionId, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                url = JsonRead.String(item, "url");
                string hash = JsonRead.String(item, "sha1");
                if (hash.Length > 0) sha1 = hash;
                return url.Length > 0;
            }
            return false;
        }

        /// <summary>清单里的发布时间（界面上显示「发布于 …」）。</summary>
        public static string? FindReleaseTime(JsonElement manifestRoot, string versionId)
        {
            var versions = JsonRead.Array(manifestRoot, "versions");
            if (versions.ValueKind != JsonValueKind.Array) return null;

            foreach (var item in versions.EnumerateArray())
            {
                if (string.Equals(JsonRead.String(item, "id"), versionId, StringComparison.OrdinalIgnoreCase))
                {
                    string time = JsonRead.String(item, "releaseTime");
                    return time.Length > 0 ? time : null;
                }
            }
            return null;
        }

        /* -----------------------------------------------------------------
           安装
           ----------------------------------------------------------------- */

        public static async Task<InstallSummary> InstallAsync(
            DownloadJob job, string gameDir, string versionId, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(versionId)) throw new HttpError("没有指定版本号");
            if (string.IsNullOrWhiteSpace(gameDir)) throw new HttpError("没有指定游戏目录");

            string root = Path.GetFullPath(gameDir);
            var summary = new InstallSummary { VersionId = versionId };

            /* 1. 版本清单 → 这个版本的 JSON 地址 */
            job.SetPhase("正在获取版本清单…");
            string versionUrl;
            string? versionSha1;
            using (var manifest = await GetManifestAsync(token).ConfigureAwait(false))
            {
                if (!TryFindVersion(manifest.RootElement, versionId, out versionUrl, out versionSha1))
                {
                    throw new HttpError("版本清单里没有「" + versionId + "」，可能已经被 Mojang 下架");
                }
            }

            /* 2. 版本 JSON */
            string versionDir = Path.Combine(root, "versions", versionId);
            Directory.CreateDirectory(versionDir);
            string jsonPath = Path.Combine(versionDir, versionId + ".json");
            summary.VersionDir = versionDir;

            job.SetPhase("正在下载版本信息…");
            /* 这一层传原始地址就好：候选地址（镜像 / 官方）由 DownloadWithRetryAsync 排 */
            await DownloadWithRetryAsync(
                versionUrl, jsonPath, versionSha1, (Action<long>?)null, token)
                .ConfigureAwait(false);

            string rawJson = await File.ReadAllTextAsync(jsonPath, token).ConfigureAwait(false);
            JsonDocument version;
            try
            {
                version = JsonDocument.Parse(rawJson, new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                });
            }
            catch (JsonException)
            {
                throw new HttpError("版本 JSON 解析失败，文件可能下载不完整，删掉再试一次");
            }

            var tasks = new List<FileTask>();
            var natives = new List<(string Path, List<string> Exclude)>();

            using (version)
            {
                var body = version.RootElement;

                /* 3. 客户端 jar */
                job.SetPhase("正在整理要下载的文件…");
                var clientDownload = JsonRead.Object(JsonRead.Object(body, "downloads"), "client");
                string clientUrl = JsonRead.String(clientDownload, "url");
                if (clientUrl.Length > 0)
                {
                    tasks.Add(new FileTask(
                        clientUrl,
                        Path.Combine(versionDir, versionId + ".jar"),
                        JsonRead.StringOrNull(clientDownload, "sha1"),
                        JsonRead.Long(clientDownload, "size")));
                }

                /* 4. 运行库 */
                string librariesRoot = Path.Combine(root, "libraries");
                CollectLibraries(body, librariesRoot, tasks, natives);

                /* 5. 资源索引 + 资源对象 */
                var assetIndex = JsonRead.Object(body, "assetIndex");
                string assetsRoot = Path.Combine(root, "assets");
                string? indexId = JsonRead.StringOrNull(assetIndex, "id");
                if (indexId != null)
                {
                    string indexPath = Path.Combine(assetsRoot, "indexes", indexId + ".json");
                    string indexUrl = JsonRead.String(assetIndex, "url");
                    if (indexUrl.Length > 0)
                    {
                        job.SetPhase("正在读取资源索引…");
                        await DownloadWithRetryAsync(
                            indexUrl, indexPath,
                            JsonRead.StringOrNull(assetIndex, "sha1"), null, token).ConfigureAwait(false);

                        CollectAssets(indexPath, Path.Combine(assetsRoot, "objects"), tasks);
                    }
                }

                /* 6. 日志配置（1.7+ 才有，读不到不影响） */
                var loggingFile = JsonRead.Object(JsonRead.Object(JsonRead.Object(body, "logging"), "client"), "file");
                string loggingUrl = JsonRead.String(loggingFile, "url");
                string loggingId = JsonRead.String(loggingFile, "id");
                if (loggingUrl.Length > 0 && loggingId.Length > 0)
                {
                    tasks.Add(new FileTask(
                        loggingUrl,
                        Path.Combine(assetsRoot, "log_configs", loggingId),
                        JsonRead.StringOrNull(loggingFile, "sha1"),
                        JsonRead.Long(loggingFile, "size")));
                }
            }

            /* 7. 开下 */
            long totalBytes = tasks.Sum(item => Math.Max(0, item.Size));
            job.SetTotalBytes(totalBytes);
            job.SetCount(0, tasks.Count);
            job.SetPhase(tasks.Count == 0 ? "没有需要下载的文件" : "正在下载游戏文件");

            int total = tasks.Count;
            int downloaded = 0;
            int skipped = 0;
            long written = 0;

            using (var gate = new SemaphoreSlim(DownloadManager.Parallelism))
            {
                var running = new List<Task>(total);
                foreach (var task in tasks)
                {
                    await gate.WaitAsync(token).ConfigureAwait(false);
                    running.Add(Task.Run(async () =>
                    {
                        try
                        {
                            bool wasSkipped = await FetchAsync(job, task, total, token).ConfigureAwait(false);
                            if (wasSkipped)
                            {
                                Interlocked.Increment(ref skipped);
                            }
                            else
                            {
                                Interlocked.Increment(ref downloaded);
                                Interlocked.Add(ref written, task.Size);
                            }
                        }
                        finally
                        {
                            gate.Release();
                        }
                    }));
                }

                await Task.WhenAll(running).ConfigureAwait(false);
            }

            summary.Downloaded = downloaded;
            summary.Skipped = skipped;
            summary.Bytes = written;

            /* 8. 解压老版本的 natives */
            if (natives.Count > 0)
            {
                job.SetPhase("正在解压运行库…");
                ExtractNatives(versionDir, natives, token);
            }

            job.SetPhase("正在写入版本信息…");
            // 版本 JSON 已经在 versions\<id>\<id>.json 了，这里只需要保证它完整
            if (!File.Exists(jsonPath))
            {
                await File.WriteAllTextAsync(jsonPath, rawJson, token).ConfigureAwait(false);
            }

            return summary;
        }

        /* -----------------------------------------------------------------
           运行库
           ----------------------------------------------------------------- */

        private static void CollectLibraries(
            JsonElement body, string librariesRoot, List<FileTask> tasks,
            List<(string Path, List<string> Exclude)> natives)
        {
            var libraries = JsonRead.Array(body, "libraries");
            if (libraries.ValueKind != JsonValueKind.Array) return;

            foreach (var library in libraries.EnumerateArray())
            {
                if (!IsAllowed(library)) continue;

                var downloads = JsonRead.Object(library, "downloads");

                // 普通运行库
                var artifact = JsonRead.Object(downloads, "artifact");
                string relative = JsonRead.String(artifact, "path");
                if (relative.Length > 0)
                {
                    string local = Path.Combine(librariesRoot, relative.Replace('/', Path.DirectorySeparatorChar));
                    string url = JsonRead.String(artifact, "url");
                    if (url.Length == 0)
                    {
                        url = "https://libraries.minecraft.net/" + relative;
                    }
                    tasks.Add(new FileTask(
                        url, local,
                        JsonRead.StringOrNull(artifact, "sha1"),
                        JsonRead.Long(artifact, "size")));
                }

                // 老版本的 natives（1.18 以前靠它把 lwjgl 的 dll 解出来）
                var nativesMap = JsonRead.Object(library, "natives");
                if (nativesMap.ValueKind != JsonValueKind.Object) continue;

                string classifier = JsonRead.String(nativesMap, "windows")
                    .Replace("${arch}", Environment.Is64BitProcess ? "64" : "32");
                if (classifier.Length == 0) continue;

                var native = JsonRead.Object(JsonRead.Object(downloads, "classifiers"), classifier);
                string nativePath = JsonRead.String(native, "path");
                if (nativePath.Length == 0) continue;

                string nativeLocal = Path.Combine(
                    librariesRoot, nativePath.Replace('/', Path.DirectorySeparatorChar));
                string nativeUrl = JsonRead.String(native, "url");
                if (nativeUrl.Length == 0) nativeUrl = "https://libraries.minecraft.net/" + nativePath;

                tasks.Add(new FileTask(
                    nativeUrl, nativeLocal,
                    JsonRead.StringOrNull(native, "sha1"),
                    JsonRead.Long(native, "size")));

                natives.Add((nativeLocal, JsonRead.Strings(JsonRead.Object(library, "extract"), "exclude")));
            }
        }

        /// <summary>
        /// 判断一个运行库在这台机器上要不要下。规则和官方启动器一致：
        /// 没有 rules 就是全平台都要；有 rules 时按顺序找第一条命中的，
        /// allow 就下、disallow 就跳过，一条都不命中就跳过。
        /// </summary>
        private static bool IsAllowed(JsonElement library)
        {
            var rules = JsonRead.Array(library, "rules");
            if (rules.ValueKind != JsonValueKind.Array || rules.GetArrayLength() == 0) return true;

            foreach (var rule in rules.EnumerateArray())
            {
                var os = JsonRead.Object(rule, "os");
                if (os.ValueKind == JsonValueKind.Object)
                {
                    string name = JsonRead.String(os, "name");
                    if (name.Length > 0 && !name.Equals("windows", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    string arch = JsonRead.String(os, "arch");
                    if (arch.Length > 0)
                    {
                        // Mojang 的 arch 只有 "x86"（32 位）；64 位系统不该装 32 位那份
                        bool is32Bit = arch.Equals("x86", StringComparison.OrdinalIgnoreCase);
                        if (is32Bit && Environment.Is64BitProcess) continue;
                    }
                }

                string action = JsonRead.String(rule, "action");
                return action.Equals("allow", StringComparison.OrdinalIgnoreCase);
            }

            return false;
        }

        /* -----------------------------------------------------------------
           资源
           ----------------------------------------------------------------- */

        /// <summary>资源索引里的每个对象都是「哈希命名的文件」，相同内容只存在一份。</summary>
        private static void CollectAssets(string indexPath, string objectsRoot, List<FileTask> tasks)
        {
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(indexPath));
                var objects = JsonRead.Object(document.RootElement, "objects");
                if (objects.ValueKind != JsonValueKind.Object) return;

                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in objects.EnumerateObject())
                {
                    string hash = JsonRead.String(property.Value, "hash");
                    if (hash.Length < 2 || !seen.Add(hash)) continue;

                    long size = JsonRead.Long(property.Value, "size");
                    string local = Path.Combine(objectsRoot, hash.Substring(0, 2), hash);
                    tasks.Add(new FileTask(
                        "https://resources.download.minecraft.net/" + hash.Substring(0, 2) + "/" + hash,
                        local, hash, size));
                }
            }
            catch (Exception ex) when (ex is JsonException || ex is IOException)
            {
                // 索引坏了：至少让运行库和 jar 下完，资源下次再补
            }
        }

        /* -----------------------------------------------------------------
           下载
           ----------------------------------------------------------------- */

        private static async Task<bool> FetchAsync(
            DownloadJob job, FileTask task, int total, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();

            if (IsUpToDate(task.Path, task.Size))
            {
                job.AddBytes(task.Size);
                job.Step(total);
                return true;
            }

            long written = 0;
            await DownloadWithRetryAsync(task.Url, task.Path, task.Sha1, chunk =>
            {
                job.AddBytes(chunk - written);
                written = chunk;
            }, token).ConfigureAwait(false);

            job.Step(total);
            return false;
        }

        /// <summary>
        /// 下一个文件。候选地址由 Mirrors 排好（当前下载源 → 另一种源），
        /// JsonHttp 负责逐个试、并在传输层抖动时用断点重试 —— 这里不用再自己兜底了。
        /// </summary>
        private static Task DownloadWithRetryAsync(
            string url, string path, string? sha1, Action<long>? onChunk, CancellationToken token)
        {
            return JsonHttp.DownloadFileAsync(Mirrors.VanillaCandidates(url), path, sha1, onChunk, token);
        }

        private static bool IsUpToDate(string path, long size)
        {
            try
            {
                if (!File.Exists(path)) return false;
                if (size <= 0) return true;
                return new FileInfo(path).Length == size;
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        /* -----------------------------------------------------------------
           解压
           ----------------------------------------------------------------- */

        private static void ExtractNatives(
            string versionDir, List<(string Path, List<string> Exclude)> zips, CancellationToken token)
        {
            string target = Path.Combine(versionDir, "natives");
            Directory.CreateDirectory(target);

            foreach (var (zipPath, excludes) in zips)
            {
                if (!File.Exists(zipPath)) continue;
                try
                {
                    using var archive = ZipFile.OpenRead(zipPath);
                    foreach (var entry in archive.Entries)
                    {
                        token.ThrowIfCancellationRequested();
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        if (IsExcluded(entry.FullName, excludes)) continue;

                        string destination = Path.Combine(target, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                        string? folder = Path.GetDirectoryName(destination);
                        if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
                        entry.ExtractToFile(destination, overwrite: true);
                    }
                }
                catch (Exception ex) when (ex is IOException || ex is InvalidDataException ||
                                           ex is UnauthorizedAccessException)
                {
                    // 单个库解不开不影响整体安装（大多是老版本的 32 位库）
                }
            }
        }

        private static bool IsExcluded(string entryName, List<string> excludes)
        {
            foreach (string exclude in excludes)
            {
                if (exclude.Length > 0 &&
                    entryName.StartsWith(exclude, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }
}
