/*=====================================================================
   StarLaunch · 下载消息：网页 → 宿主
   ---------------------------------------------------------------------
   网页点「安装」发一条消息，宿主把活丢进 DownloadManager 队列，
   然后通过 download-state 把进度推回网页：

     download-install-version   装原版（完整依赖，见 MinecraftInstaller）
     download-modrinth          装 Mod / 光影 / 材质包（含必需依赖）
     download-modpack           装整合包（.mrpack：解压 + 补下所有文件）
     download-cancel            取消一个任务
     download-clear             清掉已完成的任务
     download-mirror            切换下载源

   路径一律先用已登记的游戏文件夹校验：网页传来的路径不当真。
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
        private bool _downloadBridgeReady;

        /// <summary>把队列的变化接到网页上。页面加载完调一次。</summary>
        private void StartDownloadBridge()
        {
            if (_downloadBridgeReady) return;
            _downloadBridgeReady = true;

            DownloadManager.Changed += () =>
            {
                try
                {
                    Dispatcher.BeginInvoke(new Action(PostDownloadState));
                }
                catch (Exception)
                {
                    // 窗口关掉了
                }
            };

            DownloadManager.Finished += job =>
            {
                DownloadQueueStore.Forget(job.Id);
                try
                {
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        PostDownloadState();
                        PostPageMessage("download-finished", job.ToView());
                    }));
                }
                catch (Exception)
                {
                    // 同上
                }
            };

            /* 上次没下完的任务（关软件 / 暂停）重新入队：已有的文件会跳过，.part 会续传 */
            RestorePendingDownloads();
        }

        /// <summary>
        /// 读 downloads.json，把上次没结束的任务按原样再发一遍。
        /// 先 Take 清空再发：入队时会重新写一份带新 id 的记录，不会越堆越多。
        /// </summary>
        private void RestorePendingDownloads()
        {
            var pending = DownloadQueueStore.Take();
            if (pending.Count == 0) return;

            try
            {
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    foreach (var (_, raw) in pending)
                    {
                        try
                        {
                            using var document = JsonDocument.Parse(raw);
                            var root = document.RootElement;
                            if (!root.TryGetProperty("type", out var typeElement)) continue;
                            string? type = typeElement.GetString();
                            if (string.IsNullOrWhiteSpace(type)) continue;
                            HandleDownloadMessage(type, root);
                        }
                        catch (Exception)
                        {
                            // 单条坏了不影响其他任务
                        }
                    }
                }));
            }
            catch (Exception)
            {
                // 窗口还没准备好
            }
        }

        private void PostDownloadState()
        {
            var jobs = DownloadManager.Snapshot().Select(item => item.ToView()).ToList();
            PostPageMessage("download-state", new Dictionary<string, object?>
            {
                ["jobs"] = jobs,
                ["source"] = Mirrors.Current,
                ["modrinthSource"] = Mirrors.ModrinthCurrent,
                ["modrinthFallback"] = Mirrors.PreferModrinthMirror
            });
        }

        /// <summary>下载相关消息的分发入口。返回 false 表示不归这里管。</summary>
        private bool HandleDownloadMessage(string? type, JsonElement root)
        {
            switch (type)
            {
                case "download-install-version":
                    InstallMinecraftVersion(root);
                    return true;
                case "download-modrinth":
                    InstallModrinth(root);
                    return true;
                case "download-modpack":
                    InstallModpack(root);
                    return true;
                case "download-cancel":
                    DownloadManager.Cancel(ReadString(root, "id"));
                    PostDownloadState();
                    return true;
                case "download-pause":
                    DownloadManager.Pause(ReadString(root, "id"));
                    PostDownloadState();
                    return true;
                case "download-resume":
                    DownloadManager.Resume(ReadString(root, "id"));
                    PostDownloadState();
                    return true;
                case "download-clear":
                    DownloadManager.ClearFinished();
                    PostDownloadState();
                    return true;
                case "download-mirror":
                    Mirrors.Set(ReadString(root, "source"));
                    PostDownloadState();
                    return true;
                case "download-modrinth-source":
                    Mirrors.SetModrinth(ReadString(root, "source"));
                    PostDownloadState();
                    return true;
                case "download-concurrency":
                    DownloadManager.Parallelism = ParseInt(ReadString(root, "concurrency"), 6);
                    PostDownloadState();
                    return true;
                default:
                    return false;
            }
        }

        /* -----------------------------------------------------------------
           原版游戏
           ----------------------------------------------------------------- */

        private void InstallMinecraftVersion(JsonElement root)
        {
            string? versionId = ReadString(root, "versionId");
            if (string.IsNullOrWhiteSpace(versionId))
            {
                PostDownloadError("version", null, "没有收到要安装的版本号");
                return;
            }

            string loader = LoaderCatalog.NormalizeLoader(ReadString(root, "loader"));
            string loaderVersion = (ReadString(root, "loaderVersion") ?? string.Empty).Trim();

            var target = ResolveGameDir(ReadString(root, "dir"));
            if (target == null)
            {
                PostDownloadError("version", versionId, "这个游戏文件夹不在列表里");
                return;
            }

            try
            {
                GameDirs.Ensure(target.Path);
            }
            catch (Exception ex)
            {
                PostDownloadError("version", versionId, "游戏目录建不出来：" + ex.Message);
                return;
            }

            string id = versionId!;
            string alias = (ReadString(root, "name") ?? string.Empty).Trim();
            if (alias.Length > 64) alias = alias.Substring(0, 64);
            // 名字是用户自己敲的才动文件夹；自动生成的默认名（Minecraft 1.21.11 + …）只当显示名
            bool nameTouched = ReadBoolField(root, "nameTouched");

            string defaultName = "Minecraft " + id +
                (loader == LoaderCatalog.Vanilla ? string.Empty : " + " + LoaderCatalog.DisplayName(loader));
            string displayName = alias.Length > 0 ? alias : defaultName;

            var job = DownloadManager.Enqueue(
                "version", displayName, target.Path,
                async item =>
                {
                    // 记下装之前有哪些版本：装完 / 装失败都靠这个差集认出「这次新建的实例」
                    var before = SnapshotVersionFolders(target.Path);

                    try
                    {
                        // 先装原版（已经装过的话只会补缺），再叠加载器
                        var summary = await MinecraftInstaller
                            .InstallAsync(item, target.Path, id, item.Token).ConfigureAwait(false);
                        string detail = summary.Describe();

                        if (loader != LoaderCatalog.Vanilla)
                        {
                            item.SetPhase("正在安装 " + LoaderCatalog.DisplayName(loader) + "…");
                            string extra = await LoaderInstaller
                                .InstallAsync(item, target.Path, id, loader, loaderVersion, item.Token)
                                .ConfigureAwait(false);
                            detail += "；" + extra;
                        }

                        ApplyInstanceAlias(target.Path, before, alias, id, nameTouched);
                        item.Detail = detail;
                    }
                    catch (OperationCanceledException)
                    {
                        // 暂停：半成品留着，下次接着补；直接取消就把刚建出来的版本目录清掉
                        if (!item.PauseRequested) RemoveNewVersionFolders(target.Path, before);
                        throw;
                    }
                    catch (Exception)
                    {
                        // 装失败了别留半个实例：把这次新建出来的版本目录清掉
                        RemoveNewVersionFolders(target.Path, before);
                        throw;
                    }
                });

            DownloadQueueStore.Remember(job.Id, root.GetRawText(), displayName, "version");
            PostPageMessage("download-queued", job.ToView());
            PostDownloadState();
        }

        /* -----------------------------------------------------------------
           实例显示名 / 半成品清理
           ----------------------------------------------------------------- */

        /// <summary>versions 下「有同名 json」的目录名，用来算一次安装新建了哪些版本。</summary>
        private static HashSet<string> SnapshotVersionFolders(string gameDir)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                string root = Path.Combine(gameDir, "versions");
                if (!Directory.Exists(root)) return set;
                foreach (string dir in Directory.GetDirectories(root))
                {
                    string name = Path.GetFileName(dir);
                    if (File.Exists(Path.Combine(dir, name + ".json"))) set.Add(name);
                }
            }
            catch (Exception)
            {
                // 读不了就当空的
            }
            return set;
        }

        /// <summary>
        /// 处理用户填的实例名。
        ///
        /// 用户**自己敲过**名字（nameTouched）时，直接把这次装出来的版本目录改名 ——
        /// 目录名、里面的 &lt;名字&gt;.json / &lt;名字&gt;.jar、以及 json 里的 "id" 一起改，
        /// 这样其它启动器看到的也是这个名字，而不是「启动器里一个名、文件夹里另一个名」。
        ///
        /// 改名失败（重名、非法字符、被占用）或用户没改过名字时，退回原来的做法：
        /// 只写 StarLaunch.instance.json 的 alias 当显示名。
        /// </summary>
        private static void ApplyInstanceAlias(
            string gameDir, HashSet<string> before, string alias, string versionId, bool nameTouched)
        {
            if (string.IsNullOrWhiteSpace(alias)) return;

            if (nameTouched && TryRenameInstalledVersion(gameDir, before, versionId, alias) != null) return;

            if (string.Equals(alias, "Minecraft " + versionId, StringComparison.Ordinal)) return; // 就是默认名，不用落盘

            var added = SnapshotVersionFolders(gameDir);
            added.ExceptWith(before);
            if (added.Count == 0) added.Add(versionId);   // 重装已有版本：名字落到原版目录上

            foreach (string name in added)
            {
                string dir = Path.Combine(gameDir, "versions", name);
                var settings = InstanceSettingsStore.Load(dir) ?? new InstanceSettings();
                if (string.Equals(settings.Alias, alias, StringComparison.Ordinal)) continue;
                settings.Alias = alias;
                InstanceSettingsStore.Save(dir, settings, out _);
            }
        }

        /// <summary>这次装出来的「主版本」目录：原版就是版本号，带加载器时是新建的加载器版本。</summary>
        private static string? PrimaryInstalledVersion(HashSet<string> before, string versionId, string gameDir)
        {
            var added = SnapshotVersionFolders(gameDir);
            added.ExceptWith(before);
            if (added.Count == 0) return null;
            if (added.Count == 1) return added.First();

            string? loader = added.FirstOrDefault(name =>
                !string.Equals(name, versionId, StringComparison.OrdinalIgnoreCase));
            return loader ?? added.First();
        }

        /// <summary>把版本目录改成用户填的名字；返回新的目录名，改不了返回 null。</summary>
        private static string? TryRenameInstalledVersion(
            string gameDir, HashSet<string> before, string versionId, string wanted)
        {
            string? main = PrimaryInstalledVersion(before, versionId, gameDir);
            if (main == null) return null;
            return RenameVersionFolder(gameDir, main, wanted);
        }

        /// <summary>
        /// 重命名 versions\&lt;旧名&gt; 及其内部的 json / jar / json 里的 id。
        /// 目标目录已存在、名字非法、或者正在被占用时返回 null（调用方退回 alias）。
        /// </summary>
        private static string? RenameVersionFolder(string gameDir, string oldId, string wanted)
        {
            string name = SanitizeVersionName(wanted);
            if (name.Length == 0) return null;
            if (string.Equals(name, oldId, StringComparison.OrdinalIgnoreCase)) return oldId;

            string versions = Path.Combine(gameDir, "versions");
            string from = Path.Combine(versions, oldId);
            string to = Path.Combine(versions, name);
            if (!Directory.Exists(from) || Directory.Exists(to)) return null;

            try
            {
                Directory.Move(from, to);
            }
            catch (Exception)
            {
                return null;   // 被占用 / 权限不足：留在原名，退回 alias
            }

            try
            {
                // Minecraft 按「文件夹名.json」找版本，里面的文件得跟着改
                foreach (string extension in new[] { ".json", ".jar" })
                {
                    string source = Path.Combine(to, oldId + extension);
                    string destination = Path.Combine(to, name + extension);
                    if (File.Exists(source) && !File.Exists(destination)) File.Move(source, destination);
                }

                string json = Path.Combine(to, name + ".json");
                if (File.Exists(json)) RewriteVersionId(json, name);

                // 旧 alias 会把新目录名盖掉，清掉
                var settings = InstanceSettingsStore.Load(to);
                if (settings?.Alias != null && settings.Alias.Length > 0)
                {
                    settings.Alias = null;
                    InstanceSettingsStore.Save(to, settings, out _);
                }
            }
            catch (Exception)
            {
                // 文件名没改全也比丢掉整个版本强，至少目录已经是新名字了
            }

            return name;
        }

        /// <summary>版本名要当文件夹名用：去掉非法字符、首尾的空格和点，最长 64。</summary>
        private static string SanitizeVersionName(string wanted)
        {
            string name = (wanted ?? string.Empty).Trim();
            if (name.Length == 0) return string.Empty;

            foreach (char bad in Path.GetInvalidFileNameChars())
            {
                name = name.Replace(bad, '_');
            }

            name = name.Trim(' ', '.');
            if (name.Length == 0 || name == "." || name == "..") return string.Empty;
            if (name.Length > 64) name = name.Substring(0, 64).TrimEnd(' ', '.');
            return name;
        }

        /// <summary>版本 JSON 里的 "id" 改成新名字（其它字段原样保留）。</summary>
        private static void RewriteVersionId(string jsonPath, string newId)
        {
            try
            {
                string text = File.ReadAllText(jsonPath);
                using var document = JsonDocument.Parse(text, new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                });

                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return;
                if (!root.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String) return;
                if (string.Equals(idElement.GetString(), newId, StringComparison.Ordinal)) return;

                using var buffer = new MemoryStream();
                using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = true }))
                {
                    writer.WriteStartObject();
                    foreach (var property in root.EnumerateObject())
                    {
                        if (string.Equals(property.Name, "id", StringComparison.Ordinal)) writer.WriteString("id", newId);
                        else property.WriteTo(writer);
                    }
                    writer.WriteEndObject();
                }

                File.WriteAllBytes(jsonPath, buffer.ToArray());
            }
            catch (Exception)
            {
                // json 改不动就算了，文件夹名才是启动器认的
            }
        }

        /// <summary>安装失败时删掉这次新建的版本目录（只删自己建的，不动用户已有的版本）。</summary>
        private static void RemoveNewVersionFolders(string gameDir, HashSet<string> before)
        {
            var added = SnapshotVersionFolders(gameDir);
            added.ExceptWith(before);

            foreach (string name in added)
            {
                string dir = Path.Combine(gameDir, "versions", name);
                try
                {
                    if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
                }
                catch (Exception)
                {
                    // 删不掉就留着，最多是列表里多一个「装坏的版本」
                }
            }
        }

        /* -----------------------------------------------------------------
           Mod / 光影 / 材质包
           ----------------------------------------------------------------- */

        private void InstallModrinth(JsonElement root)
        {
            string kind = Modrinth.NormalizeKind(ReadString(root, "kind"));
            string? projectId = ReadString(root, "projectId");
            string? versionId = ReadString(root, "versionId");
            string? game = ReadString(root, "game");
            string? loader = ReadString(root, "loader");
            string displayName = ReadString(root, "name") ?? projectId ?? "Modrinth 项目";

            if (string.IsNullOrWhiteSpace(projectId))
            {
                PostDownloadError(kind, null, "没有收到项目 ID");
                return;
            }

            var instance = ResolveInstanceDir(ReadString(root, "instancePath"));
            if (instance == null)
            {
                PostDownloadError(kind, displayName, "这个实例目录不在登记的游戏文件夹里");
                return;
            }

            string instancePath = instance!;
            string? folder = Modrinth.FolderOf(kind);
            if (folder == null)
            {
                PostDownloadError(kind, displayName, "这个下载类型走整合包流程");
                return;
            }

            string project = projectId!;
            string targetFolder = Path.Combine(instancePath, folder);

            var job = DownloadManager.Enqueue(kind, displayName, targetFolder, async item =>
            {
                item.SetPhase("正在获取文件列表…");

                JsonElement version;
                if (!string.IsNullOrWhiteSpace(versionId))
                {
                    using var document = await Modrinth
                        .VersionAsync(versionId!, item.Token).ConfigureAwait(false);
                    version = document.RootElement.Clone();
                }
                else
                {
                    using var list = await Modrinth
                        .VersionsAsync(project, game, loader, item.Token).ConfigureAwait(false);
                    if (list.RootElement.ValueKind != JsonValueKind.Array || list.RootElement.GetArrayLength() == 0)
                    {
                        throw new HttpError("这个项目没有适配所选版本的文件，换个游戏版本或加载器试试");
                    }
                    version = list.RootElement[0].Clone();
                }

                var files = await Modrinth
                    .CollectAsync(version, kind, instancePath, item.Token).ConfigureAwait(false);

                if (files.Count == 0)
                {
                    item.Detail = "本地已经有这个文件了，没有重复下载";
                    return;
                }

                item.SetCount(0, files.Count);
                int count = await Modrinth
                    .DownloadAsync(item, files, instancePath, item.Token).ConfigureAwait(false);

                item.Detail = "已安装 " + count + " 个文件到 " + folder;
            });

            DownloadQueueStore.Remember(job.Id, root.GetRawText(), displayName, kind);
            PostPageMessage("download-queued", job.ToView());
            PostDownloadState();
        }

        /* -----------------------------------------------------------------
           整合包
           ----------------------------------------------------------------- */

        private void InstallModpack(JsonElement root)
        {
            string? projectId = ReadString(root, "projectId");
            string? versionId = ReadString(root, "versionId");
            string? game = ReadString(root, "game");
            string displayName = ReadString(root, "name") ?? projectId ?? "整合包";

            if (string.IsNullOrWhiteSpace(projectId))
            {
                PostDownloadError("modpack", null, "没有收到项目 ID");
                return;
            }

            var target = ResolveGameDir(ReadString(root, "dir"));
            if (target == null)
            {
                PostDownloadError("modpack", displayName, "这个游戏文件夹不在列表里");
                return;
            }

            try
            {
                GameDirs.Ensure(target.Path);
            }
            catch (Exception ex)
            {
                PostDownloadError("modpack", displayName, "游戏目录建不出来：" + ex.Message);
                return;
            }

            string project = projectId!;
            string gameDir = target.Path;

            var job = DownloadManager.Enqueue("modpack", displayName, gameDir, async item =>
            {
                // 记下装之前有哪些版本：失败时把这次新建的删掉，别在版本列表里留半个实例
                var before = SnapshotVersionFolders(gameDir);
                try
                {
                    await ImportModpackAsync(item, project, game, versionId, gameDir, displayName)
                        .ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    // 暂停：留着半成品等继续；直接取消就清掉这次建的版本目录
                    if (!item.PauseRequested) RemoveNewVersionFolders(gameDir, before);
                    throw;
                }
                catch (Exception)
                {
                    RemoveNewVersionFolders(gameDir, before);
                    throw;
                }
            });

            DownloadQueueStore.Remember(job.Id, root.GetRawText(), displayName, "modpack");
            PostPageMessage("download-queued", job.ToView());
            PostDownloadState();
        }

        /// <summary>下 .mrpack → 解压导入 → 补下清单里的文件。失败时由调用方清理半成品。</summary>
        private static async Task ImportModpackAsync(
            DownloadJob item, string project, string? game, string? versionId, string gameDir, string displayName)
        {
            item.SetPhase("正在获取整合包信息…");

            JsonElement version;
            if (!string.IsNullOrWhiteSpace(versionId))
            {
                using var document = await Modrinth.VersionAsync(versionId!, item.Token).ConfigureAwait(false);
                version = document.RootElement.Clone();
            }
            else
            {
                using var list = await Modrinth
                    .VersionsAsync(project, game, null, item.Token).ConfigureAwait(false);
                if (list.RootElement.ValueKind != JsonValueKind.Array || list.RootElement.GetArrayLength() == 0)
                {
                    throw new HttpError("这个整合包没有可用的版本");
                }
                version = list.RootElement[0].Clone();
            }

            var primary = Modrinth.PrimaryFile(version, string.Empty);
            if (primary == null) throw new HttpError("这个版本没有可下载的文件");

            string temp = Path.Combine(
                Path.GetTempPath(), "StarLaunch-pack-" + Guid.NewGuid().ToString("n") + ".mrpack");

            try
            {
                item.SetPhase("正在下载整合包…");
                item.SetTotalBytes(Math.Max(0, primary.Size));

                long written = 0;
                await JsonHttp.DownloadFileAsync(
                    Mirrors.ModrinthCandidates(primary.Url), temp, primary.Sha1, chunk =>
                    {
                        item.AddBytes(chunk - written);
                        written = chunk;
                    }, item.Token).ConfigureAwait(false);

                item.SetPhase("正在解压整合包…");
                var result = await Task.Run(
                    () => ModpackImporter.Import(temp, gameDir), item.Token).ConfigureAwait(false);

                if (!result.Ok)
                {
                    throw new HttpError(result.Error ?? "整合包导入失败");
                }

                if (result.PendingFiles.Count > 0 && !string.IsNullOrWhiteSpace(result.VersionDir))
                {
                    await DownloadPackFilesAsync(item, result, item.Token).ConfigureAwait(false);
                }

                var notes = new List<string>
                {
                    "已导入「" + (result.Name ?? displayName) + "」"
                };
                if (!string.IsNullOrWhiteSpace(result.MinecraftVersion))
                {
                    notes.Add("需要 Minecraft " + result.MinecraftVersion);
                }
                if (!string.IsNullOrWhiteSpace(result.LoaderCoordinate))
                {
                    notes.Add(result.LoaderCoordinate!);
                }
                if (result.PendingFiles.Count > 0)
                {
                    notes.Add("补下 " + result.PendingFiles.Count + " 个文件");
                }
                item.Detail = string.Join(" · ", notes);
            }
            finally
            {
                try
                {
                    if (File.Exists(temp)) File.Delete(temp);
                }
                catch (Exception)
                {
                    // 临时文件删不掉交给系统清理
                }
            }
        }

        /// <summary>把 .mrpack 里清单声明的文件下到版本目录（mods/、config/ 等）。</summary>
        private static async Task DownloadPackFilesAsync(
            DownloadJob job, ModpackImportResult result, CancellationToken token)
        {
            string versionDir = result.VersionDir!;
            var files = result.PendingFiles;

            job.SetPhase("正在补下整合包文件");
            job.SetCount(0, files.Count);
            job.SetTotalBytes(files.Sum(item => Math.Max(0, item.Size)));

            using var gate = new SemaphoreSlim(Math.Max(2, DownloadManager.Parallelism / 2));
            var running = new List<Task>(files.Count);
            foreach (var file in files)
            {
                await gate.WaitAsync(token).ConfigureAwait(false);
                running.Add(Task.Run(async () =>
                {
                    try
                    {
                        string relative = file.Path.Replace('/', Path.DirectorySeparatorChar);
                        string target = Path.Combine(versionDir, relative);
                        if (File.Exists(target) && file.Size > 0 && new FileInfo(target).Length == file.Size)
                        {
                            job.AddBytes(file.Size);
                            job.Step(files.Count);
                            return;
                        }

                        long written = 0;
                        await JsonHttp.DownloadFileAsync(
                            Mirrors.ModrinthCandidates(file.Url), target, file.Sha1, chunk =>
                        {
                            job.AddBytes(chunk - written);
                            written = chunk;
                        }, token).ConfigureAwait(false);

                        job.Step(files.Count);
                    }
                    finally
                    {
                        gate.Release();
                    }
                }));
            }

            await Task.WhenAll(running).ConfigureAwait(false);
        }

        /* -----------------------------------------------------------------
           路径校验
           ----------------------------------------------------------------- */

        private static GameDirEntry? ResolveGameDir(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return GameDirs.Active();
            return GameDirs.Find(path);
        }

        /// <summary>
        /// 实例工作目录：必须落在某个已登记的游戏文件夹里。
        /// 没给就用当前文件夹（有些调用方只装到根目录）。
        /// </summary>
        private string? ResolveInstanceDir(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return GameDirs.Active().Path;

            string full;
            try
            {
                full = Path.GetFullPath(path!);
            }
            catch (Exception)
            {
                return null;
            }

            foreach (var entry in GameDirs.ResolveAll())
            {
                if (!IsInside(full, entry.Path)) continue;
                try
                {
                    Directory.CreateDirectory(full);
                }
                catch (Exception)
                {
                    return null;
                }
                return full;
            }
            return null;
        }

        private void PostDownloadError(string kind, string? name, string message)
        {
            PostPageMessage("download-error", new Dictionary<string, object?>
            {
                ["kind"] = kind,
                ["name"] = name,
                ["error"] = message
            });
        }
    }
}
