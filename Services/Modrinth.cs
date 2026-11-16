/*=====================================================================
   StarLaunch · Modrinth
   ---------------------------------------------------------------------
   Mod / 光影 / 材质包 / 整合包都从 Modrinth 的开放接口取（不需要 API Key）。

   用到的三个接口：
     /v2/search                 搜索（facets 里带项目类型、游戏版本、加载器）
     /v2/project/{id}           项目详情（含正文、图集、许可证）
     /v2/project/{id}/version   这个项目适配某版本的文件列表
     /v2/version/{id}           单个文件（补依赖时用）

   下载任务本身由 DownloadManager 排队，这里只提供接口和「怎么装到本地」。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>一个待下载的 Modrinth 文件（含它写到本地的路径）。</summary>
    internal sealed class ModrinthFileTask
    {
        public string Url { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string RelativePath { get; set; } = string.Empty;
        public string? Sha1 { get; set; }
        public long Size { get; set; }
        public string Title { get; set; } = string.Empty;
    }

    internal static class Modrinth
    {
        private const string Api = "https://api.modrinth.com/v2";

        /// <summary>项目类型 → 本地目录名。整合包走另一条路（解压），不在这里。</summary>
        public static string? FolderOf(string kind)
        {
            switch ((kind ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "mod":
                    return "mods";
                case "shader":
                case "shaderpack":
                    return "shaderpacks";
                case "resourcepack":
                case "resource":
                    return "resourcepacks";
                default:
                    return null;
            }
        }

        public static string NormalizeKind(string? kind)
        {
            switch ((kind ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "shader":
                case "shaderpack":
                    return "shader";
                case "resource":
                case "resourcepack":
                    return "resourcepack";
                case "modpack":
                    return "modpack";
                default:
                    return "mod";
            }
        }

        /* -----------------------------------------------------------------
           搜索
           ----------------------------------------------------------------- */

        public static async Task<JsonDocument> SearchAsync(
            string kind, string? query, string? gameVersion, string? loader,
            string? sort, int offset, int limit, CancellationToken token)
        {
            var facets = new List<string> { "[\"project_type:" + NormalizeKind(kind) + "\"]" };

            if (!string.IsNullOrWhiteSpace(gameVersion))
            {
                facets.Add("[\"versions:" + Escape(gameVersion!.Trim()) + "\"]");
            }
            if (!string.IsNullOrWhiteSpace(loader) && !loader!.Equals("all", StringComparison.OrdinalIgnoreCase))
            {
                // 光影 / 材质包的「类型」也是 categories 里的一类（iris、optifine、16x…）
                facets.Add("[\"categories:" + Escape(loader.Trim()) + "\"]");
            }

            string url = Api + "/search?query=" + Escape(query ?? string.Empty) +
                         "&facets=" + Escape("[" + string.Join(",", facets) + "]") +
                         "&index=" + Escape(string.IsNullOrWhiteSpace(sort) ? "relevance" : sort!.Trim()) +
                         "&offset=" + Math.Max(0, offset) +
                         "&limit=" + Math.Clamp(limit, 1, 50);

            return await JsonHttp.GetJsonCandidatesAsync(Mirrors.ModrinthCandidates(url), token)
                .ConfigureAwait(false);
        }

        public static async Task<JsonDocument> ProjectAsync(string idOrSlug, CancellationToken token)
        {
            string url = Api + "/project/" + Escape(idOrSlug.Trim());
            return await JsonHttp.GetJsonCandidatesAsync(Mirrors.ModrinthCandidates(url), token)
                .ConfigureAwait(false);
        }

        public static async Task<JsonDocument> VersionsAsync(
            string idOrSlug, string? gameVersion, string? loader, CancellationToken token)
        {
            var query = new List<string>();
            if (!string.IsNullOrWhiteSpace(gameVersion))
            {
                query.Add("game_versions=" + Escape("[\"" + gameVersion!.Trim() + "\"]"));
            }
            if (!string.IsNullOrWhiteSpace(loader) && !loader!.Equals("all", StringComparison.OrdinalIgnoreCase))
            {
                query.Add("loaders=" + Escape("[\"" + loader.Trim() + "\"]"));
            }

            string url = Api + "/project/" + Escape(idOrSlug.Trim()) + "/version" +
                         (query.Count > 0 ? "?" + string.Join("&", query) : string.Empty);
            return await JsonHttp.GetJsonCandidatesAsync(Mirrors.ModrinthCandidates(url), token)
                .ConfigureAwait(false);
        }

        public static async Task<JsonDocument> VersionAsync(string versionId, CancellationToken token)
        {
            return await JsonHttp
                .GetJsonCandidatesAsync(
                    Mirrors.ModrinthCandidates(Api + "/version/" + Escape(versionId.Trim())), token)
                .ConfigureAwait(false);
        }

        /// <summary>主文件的下载地址（Modrinth 每个版本都标了 primary）。</summary>
        public static ModrinthFileTask? PrimaryFile(JsonElement version, string folder)
        {
            var files = JsonRead.Array(version, "files");
            if (files.ValueKind != JsonValueKind.Array) return null;

            JsonElement chosen = default;
            foreach (var file in files.EnumerateArray())
            {
                if (JsonRead.Bool(file, "primary"))
                {
                    chosen = file;
                    break;
                }
                if (chosen.ValueKind != JsonValueKind.Object) chosen = file;
            }
            if (chosen.ValueKind != JsonValueKind.Object) return null;

            string url = JsonRead.String(chosen, "url");
            string name = JsonRead.String(chosen, "filename");
            if (url.Length == 0 || name.Length == 0) return null;

            var hashes = JsonRead.Object(chosen, "hashes");
            string sha1 = JsonRead.String(hashes, "sha1");

            return new ModrinthFileTask
            {
                Url = url,
                FileName = Path.GetFileName(name),
                RelativePath = folder + "/" + Path.GetFileName(name),
                Sha1 = sha1.Length > 0 ? sha1 : null,
                Size = JsonRead.Long(chosen, "size"),
                Title = name
            };
        }

        /// <summary>
        /// 把一个版本 + 它必须的依赖整理成待下载列表（最多往下找三层，防止循环依赖）。
        /// 已经装过的同名文件会跳过。
        /// </summary>
        public static async Task<List<ModrinthFileTask>> CollectAsync(
            JsonElement version, string kind, string instancePath, CancellationToken token)
        {
            string folder = FolderOf(kind) ?? "mods";
            var planned = new List<ModrinthFileTask>();
            var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenVersions = new HashSet<string>(StringComparer.Ordinal);

            var primary = PrimaryFile(version, folder);
            if (primary != null)
            {
                planned.Add(primary);
                seenNames.Add(primary.FileName);
            }

            string? versionId = JsonRead.StringOrNull(version, "id");
            if (versionId != null) seenVersions.Add(versionId);

            // 依赖：只补 required 的（optional 交给人自己判断）
            var queue = new Queue<(JsonElement Dependency, int Depth)>();
            var dependencies = JsonRead.Array(version, "dependencies");
            if (dependencies.ValueKind == JsonValueKind.Array)
            {
                foreach (var dependency in dependencies.EnumerateArray())
                {
                    queue.Enqueue((dependency, 1));
                }
            }

            while (queue.Count > 0)
            {
                var (dependency, depth) = queue.Dequeue();
                if (depth > 3) continue;

                string type = JsonRead.String(dependency, "dependency_type");
                if (!type.Equals("required", StringComparison.OrdinalIgnoreCase)) continue;

                string dependencyVersion = JsonRead.String(dependency, "version_id");
                if (dependencyVersion.Length == 0) continue;
                if (!seenVersions.Add(dependencyVersion)) continue;

                JsonDocument document;
                try
                {
                    document = await VersionAsync(dependencyVersion, token).ConfigureAwait(false);
                }
                catch (HttpError)
                {
                    continue; // 依赖查不到就别拦住主文件
                }

                using (document)
                {
                    var root = document.RootElement;
                    var file = PrimaryFile(root, folder);
                    if (file != null && seenNames.Add(file.FileName))
                    {
                        planned.Add(file);
                    }

                    var nested = JsonRead.Array(root, "dependencies");
                    if (nested.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in nested.EnumerateArray())
                        {
                            queue.Enqueue((item, depth + 1));
                        }
                    }
                }
            }

            // 本地已经有同名文件：不重复下
            string targetRoot = Path.Combine(instancePath, folder);
            return planned
                .Where(item => !File.Exists(Path.Combine(targetRoot, item.FileName)))
                .ToList();
        }

        /// <summary>把文件列表下到实例目录里，返回装了几个。</summary>
        public static async Task<int> DownloadAsync(
            DownloadJob job, IReadOnlyList<ModrinthFileTask> files, string instancePath, CancellationToken token)
        {
            if (files.Count == 0) return 0;

            long totalBytes = files.Sum(item => Math.Max(0, item.Size));
            job.SetTotalBytes(totalBytes);
            job.SetCount(0, files.Count);
            job.SetPhase("正在下载文件");

            int done = 0;
            using (var gate = new SemaphoreSlim(Math.Max(2, DownloadManager.Parallelism / 2)))
            {
                var running = new List<Task>(files.Count);
                foreach (var file in files)
                {
                    await gate.WaitAsync(token).ConfigureAwait(false);
                    running.Add(Task.Run(async () =>
                    {
                        try
                        {
                            string target = Path.Combine(
                                instancePath, file.RelativePath.Replace('/', Path.DirectorySeparatorChar));

                            long written = 0;
                            await JsonHttp.DownloadFileAsync(
                                Mirrors.ModrinthCandidates(file.Url), target, file.Sha1, chunk =>
                            {
                                job.AddBytes(chunk - written);
                                written = chunk;
                            }, token).ConfigureAwait(false);

                            job.Step(files.Count);
                            Interlocked.Increment(ref done);
                        }
                        finally
                        {
                            gate.Release();
                        }
                    }));
                }

                await Task.WhenAll(running).ConfigureAwait(false);
            }

            return done;
        }

        /* -----------------------------------------------------------------
           给网页用的瘦身版数据
           ----------------------------------------------------------------- */

        /// <summary>搜索结果 → 界面要的字段（去掉 body / gallery 这些大块）。</summary>
        public static Dictionary<string, object?> ToSearchHit(JsonElement hit)
        {
            return new Dictionary<string, object?>
            {
                ["id"] = JsonRead.String(hit, "project_id"),
                ["slug"] = JsonRead.String(hit, "slug"),
                ["title"] = JsonRead.String(hit, "title"),
                ["description"] = JsonRead.String(hit, "description"),
                ["author"] = JsonRead.String(hit, "author"),
                ["icon"] = JsonRead.String(hit, "icon_url"),
                ["downloads"] = JsonRead.Long(hit, "downloads"),
                ["follows"] = JsonRead.Long(hit, "follows"),
                ["categories"] = JsonRead.Strings(hit, "display_categories"),
                ["allCategories"] = JsonRead.Strings(hit, "categories"),
                ["versions"] = JsonRead.Strings(hit, "versions"),
                ["updated"] = JsonRead.String(hit, "date_modified"),
                ["type"] = JsonRead.String(hit, "project_type"),
                ["license"] = JsonRead.String(hit, "license")
            };
        }

        public static Dictionary<string, object?> ToProject(JsonElement project)
        {
            return new Dictionary<string, object?>
            {
                ["id"] = JsonRead.String(project, "id"),
                ["slug"] = JsonRead.String(project, "slug"),
                ["title"] = JsonRead.String(project, "title"),
                ["description"] = JsonRead.String(project, "description"),
                ["body"] = JsonRead.String(project, "body"),
                ["icon"] = JsonRead.String(project, "icon_url"),
                ["downloads"] = JsonRead.Long(project, "downloads"),
                ["follows"] = JsonRead.Long(project, "followers"),
                ["categories"] = JsonRead.Strings(project, "categories"),
                ["gameVersions"] = JsonRead.Strings(project, "game_versions"),
                ["loaders"] = JsonRead.Strings(project, "loaders"),
                ["updated"] = JsonRead.String(project, "updated"),
                ["type"] = JsonRead.String(project, "project_type"),
                ["source"] = JsonRead.String(project, "source_url"),
                ["issues"] = JsonRead.String(project, "issues_url")
            };
        }

        public static Dictionary<string, object?> ToVersion(JsonElement version)
        {
            var files = new List<Dictionary<string, object?>>();
            var array = JsonRead.Array(version, "files");
            if (array.ValueKind == JsonValueKind.Array)
            {
                foreach (var file in array.EnumerateArray())
                {
                    var hashes = JsonRead.Object(file, "hashes");
                    files.Add(new Dictionary<string, object?>
                    {
                        ["url"] = JsonRead.String(file, "url"),
                        ["filename"] = JsonRead.String(file, "filename"),
                        ["primary"] = JsonRead.Bool(file, "primary"),
                        ["size"] = JsonRead.Long(file, "size"),
                        ["sha1"] = JsonRead.String(hashes, "sha1")
                    });
                }
            }

            var dependencies = new List<Dictionary<string, object?>>();
            var deps = JsonRead.Array(version, "dependencies");
            if (deps.ValueKind == JsonValueKind.Array)
            {
                foreach (var dependency in deps.EnumerateArray())
                {
                    dependencies.Add(new Dictionary<string, object?>
                    {
                        ["projectId"] = JsonRead.String(dependency, "project_id"),
                        ["versionId"] = JsonRead.String(dependency, "version_id"),
                        ["type"] = JsonRead.String(dependency, "dependency_type")
                    });
                }
            }

            return new Dictionary<string, object?>
            {
                ["id"] = JsonRead.String(version, "id"),
                ["name"] = JsonRead.String(version, "name"),
                ["versionNumber"] = JsonRead.String(version, "version_number"),
                ["channel"] = JsonRead.String(version, "version_type"),
                ["gameVersions"] = JsonRead.Strings(version, "game_versions"),
                ["loaders"] = JsonRead.Strings(version, "loaders"),
                ["published"] = JsonRead.String(version, "date_published"),
                ["downloads"] = JsonRead.Long(version, "downloads"),
                ["files"] = files,
                ["dependencies"] = dependencies
            };
        }

        private static string Escape(string value) => WebUtility.UrlEncode(value);
    }
}
