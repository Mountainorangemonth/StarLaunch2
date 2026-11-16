/*=====================================================================
   StarLaunch · 导出实例 / 整合包
   ---------------------------------------------------------------------
   版本设置里的「导出」标签：把勾选的内容打包成一个 zip，结构按整合包
   的常见布局：

       versions\<版本名>\...   版本本体（json / jar / natives / 版本设置）
       mods\...                模组
       config\...
       saves\...               存档

   zip 要写几百 MB，所以打包放在后台线程，界面不会卡住；回包统一是
   export-instance（ok / path / error / files / canceled）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using StarLaunch.Services;
using StarLaunch.Services;
namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>
        /// 导出选中的内容。这里先把消息里的字段全读出来再 await：
        /// JsonDocument 在 OnWebMessageReceived 返回时就被释放了，
        /// 异步块里再去读 root 会抛 ObjectDisposedException。
        /// </summary>
        private async void ExportInstance(JsonElement root)
        {
            string? path = ReadString(root, "path");
            string name = (ReadString(root, "name") ?? string.Empty).Trim();
            string version = (ReadString(root, "version") ?? string.Empty).Trim();

            var parts = new List<string>();
            if (root.TryGetProperty("parts", out var partsElement) && partsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in partsElement.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String) continue;
                    string? value = item.GetString();
                    if (!string.IsNullOrWhiteSpace(value)) parts.Add(value!.Trim());
                }
            }

            try
            {
                if (!TryResolveVersionDir(path, out string versionDir, out string error))
                {
                    PostExportMessage(false, null, error, 0);
                    return;
                }

                string folderName = Path.GetFileName(versionDir.TrimEnd('\\', '/'));
                string gameDir = Path.GetDirectoryName(Path.GetDirectoryName(versionDir.TrimEnd('\\', '/'))) ?? string.Empty;
                if (GameDirs.Find(gameDir) == null)
                {
                    PostExportMessage(false, null, "版本目录不属于登记的游戏文件夹", 0);
                    return;
                }

                if (name.Length == 0) name = folderName;
                if (version.Length == 0) version = "1.0.0";

                var dialog = new SaveFileDialog
                {
                    Title = "导出整合包",
                    Filter = "Zip 压缩包 (*.zip)|*.zip",
                    FileName = SafeFileName(name + "-" + version) + ".zip",
                    DefaultExt = ".zip",
                    AddExtension = true,
                    OverwritePrompt = true,
                    InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
                };

                if (dialog.ShowDialog(this) != true)
                {
                    PostExportMessage(false, null, null, 0, true);
                    return;
                }

                int fileCount = await System.Threading.Tasks.Task.Run(
                    () => BuildInstanceZip(dialog.FileName, versionDir, gameDir, folderName, parts));

                PostExportMessage(true, dialog.FileName, null, fileCount);
            }
            catch (Exception ex)
            {
                PostExportMessage(false, null, "导出失败：" + ex.Message, 0);
            }
        }

        /// <summary>
        /// 按勾选的分类把文件塞进 zip。版本本体永远带上：没有它这个包启动不了。
        /// 返回写入的文件数。
        /// </summary>
        private static int BuildInstanceZip(
            string zipPath, string versionDir, string gameDir, string versionName, List<string> parts)
        {
            var wanted = new HashSet<string>(parts, StringComparer.OrdinalIgnoreCase);
            int count = 0;

            if (File.Exists(zipPath)) File.Delete(zipPath);

            using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
            {
                void AddFile(string file, string entryName)
                {
                    if (!File.Exists(file)) return;
                    zip.CreateEntryFromFile(file, entryName.Replace('\\', '/'), CompressionLevel.Optimal);
                    count++;
                }

                void AddFolder(string folder, string prefix)
                {
                    if (!Directory.Exists(folder)) return;
                    foreach (string file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
                    {
                        string relative = Path.GetRelativePath(folder, file);
                        AddFile(file, prefix + "/" + relative);
                    }
                }

                AddFolder(versionDir, "versions/" + versionName);

                if (wanted.Contains("mods")) AddFolder(Path.Combine(gameDir, "mods"), "mods");
                if (wanted.Contains("config")) AddFolder(Path.Combine(gameDir, "config"), "config");
                if (wanted.Contains("saves")) AddFolder(Path.Combine(gameDir, "saves"), "saves");
                if (wanted.Contains("resourcepacks")) AddFolder(Path.Combine(gameDir, "resourcepacks"), "resourcepacks");
                if (wanted.Contains("shaderpacks")) AddFolder(Path.Combine(gameDir, "shaderpacks"), "shaderpacks");
                if (wanted.Contains("screenshots")) AddFolder(Path.Combine(gameDir, "screenshots"), "screenshots");
                if (wanted.Contains("options")) AddFile(Path.Combine(gameDir, "options.txt"), "options.txt");
                if (wanted.Contains("servers")) AddFile(Path.Combine(gameDir, "servers.dat"), "servers.dat");
            }

            return count;
        }

        /// <summary>去掉文件名里的非法字符，别让用户输入把对话框搞崩。</summary>
        private static string SafeFileName(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "StarLaunch";

            var builder = new StringBuilder();
            var invalid = Path.GetInvalidFileNameChars();
            foreach (char ch in value.Trim())
            {
                if (Array.IndexOf(invalid, ch) >= 0) continue;
                builder.Append(ch);
            }

            string result = builder.ToString().Trim();
            if (result.Length == 0) return "StarLaunch";
            return result.Length > 80 ? result.Substring(0, 80) : result;
        }

        private void PostExportMessage(bool ok, string? path, string? error, int files, bool canceled = false)
        {
            PostPageMessage("export-instance", new Dictionary<string, object?>
            {
                ["ok"] = ok,
                ["path"] = path,
                ["error"] = error,
                ["files"] = files,
                ["canceled"] = canceled
            });
        }
    }
}
