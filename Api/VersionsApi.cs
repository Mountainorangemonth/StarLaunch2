/*=====================================================================
   StarLaunch · 版本管理接口：GET /api/versions 与游戏文件夹动作
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。

   多文件夹（PCL 式）：
     · 登记的文件夹存在 StarLaunch.config.json，每个自带隔离策略；
     · /api/versions 一次扫完所有文件夹，返回合并版本列表 + 文件夹摘要；
     · 所有写操作都先用 GameDirs.Find() 校验路径已登记，网页传来的路径不当真。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>
        /// GET /api/versions
        ///
        /// 每次请求都重新扫一遍磁盘：用户往 versions 里丢一个新版本，网页刷新即可看到。
        /// 隔离策略来自每个文件夹自己的配置；旧版网页还会带 ?isolation=xxx，
        /// 这个值现在只当作「新添加文件夹的默认策略」记下来。
        /// </summary>
        private void RespondVersions(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string? isolation = ReadQueryValue(uri, "isolation");
            if (isolation != null)
            {
                string normalized = GameDirs.Normalize(isolation);
                var config = LauncherConfigStore.Current;
                if (!string.Equals(config.Isolation, normalized, StringComparison.Ordinal))
                {
                    config.Isolation = normalized;
                    LauncherConfigStore.Save();
                }
            }

            var result = MinecraftScanner.ScanAll(GameDirs.ResolveAll());
            RespondJson(e, 200, result);
        }

        /// <summary>从查询串里取一个参数，没有就返回 null。</summary>
        private static string? ReadQueryValue(Uri uri, string name)
        {
            string query = uri.Query ?? string.Empty;
            foreach (string pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                int separator = pair.IndexOf('=');
                if (separator <= 0) continue;
                if (!pair.Substring(0, separator).Equals(name, StringComparison.OrdinalIgnoreCase)) continue;
                return Uri.UnescapeDataString(pair.Substring(separator + 1));
            }
            return null;
        }

        /// <summary>
        /// 添加已有的 .minecraft 文件夹（可以一次多选）。
        /// 选到 .minecraft 的父目录时自动往下找一层；已经在列表里的文件夹不重复添加。
        /// </summary>
        private void AddGameDirs(string? isolation)
        {
            try
            {
                string current = GameDirs.Active().Path;
                var dialog = new OpenFolderDialog
                {
                    Title = "选择 .minecraft 文件夹（可多选）",
                    Multiselect = true,
                    InitialDirectory = Directory.Exists(current) ? current : AppContext.BaseDirectory
                };

                if (dialog.ShowDialog(this) != true)
                {
                    PostGameDirMessage("add", true, null);
                    return;
                }

                string fallbackIsolation = string.IsNullOrWhiteSpace(isolation)
                    ? LauncherConfigStore.Current.Isolation
                    : isolation!;

                var added = new List<string>();
                foreach (string folder in dialog.FolderNames)
                {
                    var entry = GameDirs.Add(folder, fallbackIsolation);
                    if (entry == null) continue;

                    // 空文件夹也收：直接当作新的游戏目录建起来（已经有内容的目录不会被改动）
                    try { GameDirs.Ensure(entry.Path); }
                    catch (Exception)
                    {
                        // 目录建不出来（权限 / 只读盘）：仍然登记，扫描时会标明不可读
                    }
                    added.Add(entry.Path);
                }

                var config = LauncherConfigStore.Current;
                if (added.Count > 0) config.ActiveDir = added[0];
                LauncherConfigStore.Save();

                PostGameDirMessage("add", false, null, added);
            }
            catch (Exception ex)
            {
                PostGameDirMessage("add", false, ex.Message);
            }
        }

        /// <summary>把一个文件夹从列表里移除。内置的 .minecraft 不允许移除。</summary>
        private void RemoveGameDir(string? path)
        {
            try
            {
                if (!GameDirs.Remove(path ?? string.Empty))
                {
                    PostGameDirMessage("remove", false, "内置的 .minecraft 不能移除");
                    return;
                }
                LauncherConfigStore.Save();
                PostGameDirMessage("remove", false, null);
            }
            catch (Exception ex)
            {
                PostGameDirMessage("remove", false, ex.Message);
            }
        }

        /// <summary>改某个文件夹自己的版本隔离策略。</summary>
        private void SetDirIsolation(string? path, string? isolation)
        {
            try
            {
                if (!GameDirs.SetIsolation(path ?? string.Empty, isolation ?? GameDirs.IsolationAll))
                {
                    PostGameDirMessage("isolation", false, "这个文件夹不在列表里");
                    return;
                }
                LauncherConfigStore.Save();
                PostGameDirMessage("isolation", false, null);
            }
            catch (Exception ex)
            {
                PostGameDirMessage("isolation", false, ex.Message);
            }
        }

        /// <summary>切换当前文件夹（侧栏高亮，也是导入整合包的目标）。</summary>
        private void SetActiveDir(string? path)
        {
            try
            {
                if (!GameDirs.SetActive(path ?? string.Empty))
                {
                    PostGameDirMessage("active", false, "这个文件夹不在列表里");
                    return;
                }
                LauncherConfigStore.Save();
                PostGameDirMessage("active", false, null);
            }
            catch (Exception ex)
            {
                PostGameDirMessage("active", false, ex.Message);
            }
        }

        /// <summary>清掉所有自定义文件夹，回到只有内置 .minecraft 的状态。</summary>
        private void ResetGameDir()
        {
            try
            {
                GameDirs.Reset();
                LauncherConfigStore.Save();

                string folder = GameDirs.DefaultDir;
                GameDirs.Ensure(folder);

                PostGameDirMessage("reset", false, null, new List<string> { folder });
            }
            catch (Exception ex)
            {
                PostGameDirMessage("reset", false, ex.Message);
            }
        }

        /// <summary>
        /// 在资源管理器里打开某个已登记的文件夹；不传路径就打开当前文件夹。
        /// 没登记、目录不在了都会带原因返回，网页会弹出来（以前是静默 return）。
        /// </summary>
        private ShellLaunchResult OpenGameDir(string? path = null)
        {
            GameDirEntry? entry;
            try
            {
                entry = string.IsNullOrWhiteSpace(path) ? GameDirs.Active() : GameDirs.Find(path);
            }
            catch (Exception ex)
            {
                return ShellLaunchResult.Failure(path, "读取游戏文件夹配置失败：" + ex.Message);
            }

            if (entry == null)
            {
                return ShellLaunchResult.Failure(path, "这个文件夹不在列表里，可能已经被移除");
            }
            return ShellLaunch.OpenFolder(entry.Path);
        }

        /// <summary>只允许打开已登记文件夹之内的路径，网页传来的路径不当真。</summary>
        private ShellLaunchResult OpenInstanceDir(string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return ShellLaunchResult.Failure(string.Empty, "没有给出版本目录");
            }

            string full;
            try
            {
                full = Path.GetFullPath(path!);
            }
            catch (Exception ex)
            {
                return ShellLaunchResult.Failure(path, "路径无效：" + ex.Message);
            }

            if (!Directory.Exists(full))
            {
                return ShellLaunchResult.Failure(full, "这个版本的目录不存在，可能已被移动或删除");
            }

            bool inside = GameDirs.ResolveAll().Any(entry => IsInside(full, entry.Path));
            if (!inside)
            {
                return ShellLaunchResult.Failure(full, "这个目录不在登记的游戏文件夹里");
            }
            return ShellLaunch.OpenFolder(full);
        }

        /// <summary>判断 full 是不是 root 本身或它的子目录（盘符根目录也能正确比较）。</summary>
        private static bool IsInside(string full, string root)
        {
            string trimmed = root.TrimEnd('\\', '/');
            if (trimmed.Length == 0) return false;
            if (string.Equals(full, trimmed, StringComparison.OrdinalIgnoreCase)) return true;
            return full.StartsWith(trimmed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// 导入整合包：选 zip / mrpack，解压进当前文件夹的 .minecraft。
        /// 开了版本隔离时，整合包会落成 versions 下的独立实例，模组进版本目录。
        /// </summary>
        private void ImportModpack()
        {
            try
            {
                var dialog = new OpenFileDialog
                {
                    Title = "选择整合包文件",
                    Filter = "整合包 (*.zip;*.mrpack)|*.zip;*.mrpack|压缩包 (*.zip)|*.zip|Modrinth 整合包 (*.mrpack)|*.mrpack",
                    CheckFileExists = true,
                    Multiselect = false
                };

                if (dialog.ShowDialog(this) != true)
                {
                    PostModpackMessage(null, true, null, null, null);
                    return;
                }

                var active = GameDirs.Active();
                try { GameDirs.Ensure(active.Path); }
                catch (Exception)
                {
                    // 目录建不出来时下面的导入会报具体错误
                }

                var result = ModpackImporter.Import(dialog.FileName, active.Path);
                PostModpackMessage(
                    result.Name,
                    false,
                    result.Ok ? null : result.Error,
                    active.Path,
                    result.Ok ? result.Message : null);
            }
            catch (Exception ex)
            {
                PostModpackMessage(null, false, ex.Message, null, ex.Message);
            }
        }

        private void PostGameDirMessage(string action, bool canceled, string? error, List<string>? added = null)
        {
            PostPageMessage("game-dirs", new Dictionary<string, object?>
            {
                ["ok"] = error == null,
                ["canceled"] = canceled,
                ["action"] = action,
                ["error"] = error,
                ["added"] = added,
                ["activeDir"] = GameDirs.Active().Path
            });
        }

        private void PostModpackMessage(string? name, bool canceled, string? error, string? target, string? message)
        {
            PostPageMessage("modpack-import", new Dictionary<string, object?>
            {
                ["ok"] = error == null,
                ["canceled"] = canceled,
                ["name"] = name,
                ["target"] = target,
                ["error"] = error,
                ["message"] = message
            });
        }

    }
}
