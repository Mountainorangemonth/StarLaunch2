/*=====================================================================
   StarLaunch · 下载接口
   ---------------------------------------------------------------------
   网页拿数据的只读接口（都要联网，所以统一走 deferral 把回复推迟）：

     GET /api/download/versions   原版版本清单（最新正式版 / 预览版 + 全量列表）
     GET /api/download/search     Modrinth 搜索（按类型 / 游戏版本 / 加载器）
     GET /api/download/project    项目详情 + 它的文件列表
     GET /api/download/files      只要文件列表（换游戏版本时单独拉）
     GET /api/download/state      下载队列快照 + 当前下载源
     GET /api/download/config     下载源 / 默认游戏目录

   真正的下载动作走 postMessage（见 Host\DownloadMessages.cs）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>/api/download/* 的入口：整个处理过程是异步的，用 deferral 撑住这次响应。</summary>
        private async void RespondDownloadApi(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            CoreWebView2Deferral? deferral = null;
            try
            {
                deferral = e.GetDeferral();
            }
            catch (Exception)
            {
                RespondNotFound(e);
                return;
            }

            try
            {
                string path = uri.AbsolutePath.ToLowerInvariant();
                switch (path)
                {
                    case "/api/download/versions":
                        await RespondDownloadVersionsAsync(e).ConfigureAwait(true);
                        break;
                    case "/api/download/loaders":
                        await RespondDownloadLoadersAsync(e, uri).ConfigureAwait(true);
                        break;
                    case "/api/download/search":
                        await RespondDownloadSearchAsync(e, uri).ConfigureAwait(true);
                        break;
                    case "/api/download/project":
                        await RespondDownloadProjectAsync(e, uri).ConfigureAwait(true);
                        break;
                    case "/api/download/files":
                        await RespondDownloadFilesAsync(e, uri).ConfigureAwait(true);
                        break;
                    case "/api/download/state":
                        RespondDownloadState(e);
                        break;
                    case "/api/download/config":
                        RespondDownloadConfig(e);
                        break;
                    default:
                        RespondJson(e, 404, new { ok = false, error = "未知接口：" + uri.AbsolutePath });
                        break;
                }
            }
            catch (HttpError ex)
            {
                RespondJson(e, 502, new { ok = false, error = ex.Message });
            }
            catch (OperationCanceledException)
            {
                RespondJson(e, 499, new { ok = false, error = "请求已取消" });
            }
            catch (Exception ex)
            {
                RespondJson(e, 500, new { ok = false, error = ex.Message });
            }
            finally
            {
                try { deferral?.Complete(); }
                catch (Exception) { /* 已经回复过了 */ }
            }
        }

        /* -----------------------------------------------------------------
           原版版本清单
           ----------------------------------------------------------------- */

        private async Task RespondDownloadVersionsAsync(CoreWebView2WebResourceRequestedEventArgs e)
        {
            using var document = await MinecraftInstaller
                .GetManifestAsync(CancellationToken.None).ConfigureAwait(true);
            var root = document.RootElement;

            var latest = new Dictionary<string, object?>();
            var latestElement = JsonRead.Object(root, "latest");
            if (latestElement.ValueKind == JsonValueKind.Object)
            {
                latest["release"] = JsonRead.String(latestElement, "release");
                latest["snapshot"] = JsonRead.String(latestElement, "snapshot");
            }

            var versions = new List<Dictionary<string, object?>>();
            var array = JsonRead.Array(root, "versions");
            if (array.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in array.EnumerateArray())
                {
                    string id = JsonRead.String(item, "id");
                    if (id.Length == 0) continue;
                    versions.Add(new Dictionary<string, object?>
                    {
                        ["id"] = id,
                        ["type"] = JsonRead.String(item, "type"),
                        ["releaseTime"] = JsonRead.String(item, "releaseTime")
                    });
                }
            }

            RespondJson(e, 200, new
            {
                ok = true,
                source = Mirrors.Current,
                latest,
                versions
            });
        }

        /* -----------------------------------------------------------------
           加载器清单（Forge / NeoForge / Fabric / Quilt / OptiFine）
           ----------------------------------------------------------------- */

        private async Task RespondDownloadLoadersAsync(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string mc = ReadQueryValue(uri, "mc") ?? string.Empty;
            if (mc.Length == 0)
            {
                RespondJson(e, 400, new { ok = false, error = "缺少游戏版本号（mc）" });
                return;
            }

            var loaders = await LoaderCatalog.ListAsync(mc, CancellationToken.None).ConfigureAwait(true);

            var payload = new List<Dictionary<string, object?>>();
            foreach (var loader in loaders)
            {
                var versions = new List<Dictionary<string, object?>>();
                foreach (var version in loader.Versions)
                {
                    versions.Add(new Dictionary<string, object?>
                    {
                        ["version"] = version.Version,
                        ["recommended"] = version.Recommended
                    });
                }

                payload.Add(new Dictionary<string, object?>
                {
                    ["key"] = loader.Key,
                    ["name"] = loader.Name,
                    ["note"] = loader.Note,
                    ["manual"] = loader.Manual,
                    ["manualUrl"] = loader.ManualUrl,
                    ["versions"] = versions
                });
            }

            RespondJson(e, 200, new
            {
                ok = true,
                mc,
                loaders = payload
            });
        }

        /* -----------------------------------------------------------------
           Modrinth
           ----------------------------------------------------------------- */

        private async Task RespondDownloadSearchAsync(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string kind = ReadQueryValue(uri, "kind") ?? "mod";
            string? query = ReadQueryValue(uri, "query");
            string? game = ReadQueryValue(uri, "game");
            string? loader = ReadQueryValue(uri, "loader");
            string? sort = ReadQueryValue(uri, "sort");
            int page = Math.Max(1, ParseInt(ReadQueryValue(uri, "page"), 1));
            int limit = Math.Clamp(ParseInt(ReadQueryValue(uri, "limit"), 20), 1, 50);

            using var document = await Modrinth
                .SearchAsync(kind, query, game, loader, sort, (page - 1) * limit, limit, CancellationToken.None)
                .ConfigureAwait(true);
            var root = document.RootElement;

            var hits = new List<Dictionary<string, object?>>();
            var array = JsonRead.Array(root, "hits");
            if (array.ValueKind == JsonValueKind.Array)
            {
                foreach (var hit in array.EnumerateArray()) hits.Add(Modrinth.ToSearchHit(hit));
            }

            RespondJson(e, 200, new
            {
                ok = true,
                kind = Modrinth.NormalizeKind(kind),
                total = JsonRead.Long(root, "total_hits"),
                offset = JsonRead.Long(root, "offset"),
                limit = JsonRead.Long(root, "limit"),
                page,
                hits
            });
        }

        private async Task RespondDownloadProjectAsync(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string? id = ReadQueryValue(uri, "id");
            if (string.IsNullOrWhiteSpace(id))
            {
                RespondJson(e, 400, new { ok = false, error = "缺少项目 ID" });
                return;
            }

            string? game = ReadQueryValue(uri, "game");
            string? loader = ReadQueryValue(uri, "loader");

            using var project = await Modrinth.ProjectAsync(id!, CancellationToken.None).ConfigureAwait(true);
            var versions = new List<Dictionary<string, object?>>();

            try
            {
                using var list = await Modrinth
                    .VersionsAsync(id!, game, loader, CancellationToken.None).ConfigureAwait(true);
                if (list.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var version in list.RootElement.EnumerateArray())
                    {
                        versions.Add(Modrinth.ToVersion(version));
                    }
                }
            }
            catch (HttpError)
            {
                // 项目本身能看就行，文件列表拉不到交给界面提示
            }

            RespondJson(e, 200, new
            {
                ok = true,
                project = Modrinth.ToProject(project.RootElement),
                versions
            });
        }

        private async Task RespondDownloadFilesAsync(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string? id = ReadQueryValue(uri, "id");
            if (string.IsNullOrWhiteSpace(id))
            {
                RespondJson(e, 400, new { ok = false, error = "缺少项目 ID" });
                return;
            }

            string? game = ReadQueryValue(uri, "game");
            string? loader = ReadQueryValue(uri, "loader");

            using var list = await Modrinth
                .VersionsAsync(id!, game, loader, CancellationToken.None).ConfigureAwait(true);

            var versions = new List<Dictionary<string, object?>>();
            if (list.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var version in list.RootElement.EnumerateArray()) versions.Add(Modrinth.ToVersion(version));
            }

            RespondJson(e, 200, new { ok = true, versions });
        }

        /* -----------------------------------------------------------------
           队列与设置
           ----------------------------------------------------------------- */

        private void RespondDownloadState(CoreWebView2WebResourceRequestedEventArgs e)
        {
            var jobs = DownloadManager.Snapshot().Select(item => item.ToView()).ToList();
            RespondJson(e, 200, new
            {
                ok = true,
                source = Mirrors.Current,
                jobs
            });
        }

        private void RespondDownloadConfig(CoreWebView2WebResourceRequestedEventArgs e)
        {
            RespondJson(e, 200, new
            {
                ok = true,
                source = Mirrors.Current,
                gameDir = GameDirs.Active().Path,
                hasHost = true
            });
        }

        private static int ParseInt(string? value, int fallback)
        {
            return int.TryParse(value, out int parsed) ? parsed : fallback;
        }
    }
}
