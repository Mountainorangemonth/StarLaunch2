/*=====================================================================
   StarLaunch · 版本设置：查看 / 更换已经安装的模组加载器
   ---------------------------------------------------------------------
   PCL 的版本设置里有一页「修改」，能在已装好的实例上换加载器
   （比如原版装成 Fabric、Fabric 换成 Forge、或只是升一个 Fabric 版本）。
   这里补上同样的能力：

     loader-options { id, mc }
       → reply { ok, data: { mc, loader, loaderVersion, options: [LoaderChoice…] } }
         问的是「这个原版版本还能装哪些加载器、各有哪些版本」，和下载页同一个数据源。

     loader-change { id, mc, loader, loaderVersion }
       → 装一个新加载器（新版本目录，不动原来的实例），
       → 下载队列里能看到进度，装完推 loader-changed { ok, id, versionId }。

   为什么是「装一个新版本」而不是原地改：加载器是写进版本 JSON 的 mainClass +
   libraries 的，Forge 还会 patch 原版文件。原地改等于把别人的实例拆了重拼，
   出事之后没法回退；新建一个版本、让用户自己选留哪个，和 PCL 的做法一致。
   =====================================================================*/
using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private bool HandleLoaderMessage(string? type, JsonElement root)
        {
            switch (type)
            {
                case "loader-options":
                    SendLoaderOptions(ReadString(root, "id"), ReadString(root, "mc"));
                    return true;
                case "loader-change":
                    ChangeLoader(root);
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>这个原版版本能装哪些加载器（数据源和下载页完全一致）。</summary>
        private void SendLoaderOptions(string? id, string? mc)
        {
            string version = (mc ?? string.Empty).Trim();
            if (version.Length == 0)
            {
                ReplyOnUiThread(id, false, null, "没有收到原版版本号");
                return;
            }

            _ = Task.Run(async () =>
            {
                try
                {
                    var choices = await LoaderCatalog
                        .ListAsync(version, System.Threading.CancellationToken.None)
                        .ConfigureAwait(false);

                    var options = new System.Collections.Generic.List<object>();
                    foreach (var choice in choices)
                    {
                        options.Add(new
                        {
                            key = choice.Key,
                            name = choice.Name,
                            note = choice.Note,
                            manual = choice.Manual,
                            manualUrl = choice.ManualUrl,
                            // 手动投影成小写字段：Reply 通道用的是默认序列化，
                            // 直接把 LoaderVersionInfo 丢过去会变成 Version / Recommended，
                            // 网页读到 item.version 就是 undefined。
                            versions = choice.Versions.Select(item => new
                            {
                                version = item.Version,
                                recommended = item.Recommended
                            }).ToList()
                        });
                    }

                    ReplyOnUiThread(id, true, new
                    {
                        mc = version,
                        options
                    }, null);
                }
                catch (Exception ex)
                {
                    ReplyOnUiThread(id, false, null, "读不到加载器列表：" + ex.Message);
                }
            });
        }

        /// <summary>
        /// 装一个新加载器到新版本目录。原来的实例原封不动 —— 用户确认没问题再自己删。
        /// </summary>
        private void ChangeLoader(JsonElement root)
        {
            string requestId = ReadString(root, "id") ?? string.Empty;
            string mc = (ReadString(root, "mc") ?? string.Empty).Trim();
            string loader = LoaderCatalog.NormalizeLoader(ReadString(root, "loader"));
            string loaderVersion = (ReadString(root, "loaderVersion") ?? string.Empty).Trim();
            string? gameDir = ReadString(root, "dir");

            if (mc.Length == 0)
            {
                PostLoaderChanged(false, requestId, null, "没有收到原版版本号");
                return;
            }
            if (loader == LoaderCatalog.Vanilla)
            {
                PostLoaderChanged(false, requestId, null, "没有选择要安装的加载器");
                return;
            }
            if (loader == LoaderCatalog.OptiFine)
            {
                PostLoaderChanged(false, requestId, null,
                    "OptiFine 没有公开下载接口，要到 optifine.net 下载后自己放进 versions 目录");
                return;
            }

            var target = ResolveGameDir(gameDir);
            if (target == null)
            {
                PostLoaderChanged(false, requestId, null, "这个游戏文件夹不在列表里");
                return;
            }

            string display = "Minecraft " + mc + " + " + LoaderCatalog.DisplayName(loader) +
                (loaderVersion.Length > 0 ? " " + loaderVersion : string.Empty);

            var job = DownloadManager.Enqueue(
                "loader", display, target.Path,
                async item =>
                {
                    try
                    {
                        item.SetPhase("正在安装 " + LoaderCatalog.DisplayName(loader) + "…");
                        string extra = await LoaderInstaller
                            .InstallAsync(item, target.Path, mc, loader, loaderVersion, item.Token)
                            .ConfigureAwait(false);
                        item.Detail = extra;
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                });

            DownloadQueueStore.Remember(job.Id, root.GetRawText(), display, "loader");
            PostPageMessage("download-queued", job.ToView());
            PostDownloadState();

            // 装完之后把新版本目录名回给网页（用户可能想直接切过去）
            _ = Task.Run(async () =>
            {
                int waited = 0;
                while (!job.IsFinished && waited < 600)
                {
                    await Task.Delay(500).ConfigureAwait(false);
                    waited += 1;
                }

                if (job.Status == "done")
                {
                    PostLoaderChanged(true, requestId, display, null);
                }
                else
                {
                    PostLoaderChanged(false, requestId, null,
                        string.IsNullOrWhiteSpace(job.Error) ? "加载器安装没有完成" : job.Error);
                }
            });
        }

        private void PostLoaderChanged(bool ok, string id, string? name, string? error)
        {
            PostPageMessage("loader-changed", new System.Collections.Generic.Dictionary<string, object?>
            {
                ["id"] = id,
                ["ok"] = ok,
                ["name"] = name,
                ["error"] = error
            });
        }
    }
}
