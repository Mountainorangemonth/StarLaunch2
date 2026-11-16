/*=====================================================================
   StarLaunch · 资源图标：Mod / 材质包 / 光影自己的图标
   ---------------------------------------------------------------------
   这三类文件本来就带着自己的图标，只是从来没人去读：

     · Mod（.jar）    fabric.mod.json 的 icon 字段 → assets/<modid>/icon.png
                      → 老 Forge 的 logoFile → 根目录的 logo.png / icon.png；
     · 材质包 / 光影  压缩包或文件夹根目录的 pack.png（列表里显示成一张小图预览）。

   为什么不在扫描时读：/api/versions 每次刷新都全盘扫一遍，几百个 jar 各开一次
   zip 会明显拖慢列表。这里改成「网页渲染到哪一行就请求哪一行的图标」，
   宿主按 文件路径+大小+修改时间 做内存缓存，滚动列表也不会反复解压。

   网页地址：/api/asset-icon?dir=<资源目录>&name=<文件名>
   目录必须落在登记过的游戏文件夹里、且最后一级是 mods / resourcepacks / shaderpacks，
   文件名只能是最后一段 —— 和 instance-asset 一套校验。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>图标缓存：路径 → (大小, 修改时间, 字节)。改过文件会自动失效。</summary>
        private static readonly Dictionary<string, (long Size, DateTime Stamp, byte[]? Bytes)> IconCache =
            new Dictionary<string, (long, DateTime, byte[]?)>(StringComparer.OrdinalIgnoreCase);

        private static readonly object IconGate = new object();

        /// <summary>单个图标最多回这么多字节，避免有人把整张壁纸塞进 jar 当 logo。</summary>
        private const int MaxIconBytes = 512 * 1024;

        private void RespondAssetIcon(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string? dir = ReadQuery(uri, "dir");
            string? name = ReadQuery(uri, "name");

            if (!TryResolveIconTarget(dir, name, out string full, out byte[]? bytes))
            {
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    null, 404, "Not Found", "Cache-Control: no-store");
                return;
            }

            if (bytes == null || bytes.Length == 0)
            {
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    null, 404, "Not Found", "Cache-Control: no-store");
                return;
            }

            e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                new MemoryStream(bytes), 200, "OK",
                "Content-Type: " + SniffImageType(bytes) + "\r\nCache-Control: no-store");
        }

        private static string? ReadQuery(Uri uri, string name)
        {
            string query = uri.Query ?? string.Empty;
            foreach (string pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                int cut = pair.IndexOf('=');
                if (cut <= 0) continue;
                if (!pair.Substring(0, cut).Equals(name, StringComparison.OrdinalIgnoreCase)) continue;
                return Uri.UnescapeDataString(pair.Substring(cut + 1));
            }
            return null;
        }

        /// <summary>校验路径并取出图标字节（命中缓存就直接给）。</summary>
        private static bool TryResolveIconTarget(string? dir, string? name, out string full, out byte[]? bytes)
        {
            full = string.Empty;
            bytes = null;

            if (string.IsNullOrWhiteSpace(dir) || string.IsNullOrWhiteSpace(name)) return false;

            string kind = string.Empty;
            try
            {
                full = Path.GetFullPath(dir!);
                kind = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
                    .ToLowerInvariant();
            }
            catch (Exception)
            {
                return false;
            }

            if (kind != "mods" && kind != "resourcepacks" && kind != "shaderpacks") return false;
            if (!IsInsideAnyGameDir(full)) return false;

            // 文件名只能是最后一段，不能带路径分隔符
            string file = name!.Trim();
            if (file.Length == 0) return false;
            if (!string.Equals(Path.GetFileName(file), file, StringComparison.Ordinal)) return false;

            string target = Path.Combine(full, file);
            bytes = ReadIcon(target, kind);
            return true;
        }

        private static byte[]? ReadIcon(string path, string kind)
        {
            DateTime stamp;
            long size;
            try
            {
                if (Directory.Exists(path))
                {
                    stamp = Directory.GetLastWriteTimeUtc(path);
                    size = 0;
                }
                else if (File.Exists(path))
                {
                    var info = new FileInfo(path);
                    stamp = info.LastWriteTimeUtc;
                    size = info.Length;
                }
                else
                {
                    return null;
                }
            }
            catch (Exception)
            {
                return null;
            }

            lock (IconGate)
            {
                if (IconCache.TryGetValue(path, out var cached) &&
                    cached.Size == size && cached.Stamp == stamp)
                {
                    return cached.Bytes;
                }
            }

            byte[]? bytes = null;
            try
            {
                bytes = Directory.Exists(path) ? IconFromFolder(path) : IconFromArchive(path, kind);
            }
            catch (Exception)
            {
                bytes = null;
            }

            lock (IconGate)
            {
                if (IconCache.Count > 600) IconCache.Clear();
                IconCache[path] = (size, stamp, bytes);
            }

            return bytes;
        }

        /* -----------------------------------------------------------------
           压缩包里的图标
           ----------------------------------------------------------------- */

        private static byte[]? IconFromArchive(string path, string kind)
        {
            using var archive = ZipFile.OpenRead(path);

            if (kind == "mods")
            {
                // Fabric：fabric.mod.json 的 icon 字段（字符串，或 { size: path } 的对象）
                foreach (string iconPath in FabricIconPaths(archive))
                {
                    byte[]? found = ReadEntry(archive, iconPath);
                    if (found != null) return found;
                }

                // 老 Forge：META-INF/mods.toml 里的 logoFile
                byte[]? toml = ReadEntry(archive, "META-INF/mods.toml");
                if (toml != null)
                {
                    foreach (string line in System.Text.Encoding.UTF8.GetString(toml).Split('\n'))
                    {
                        string text = line.Trim();
                        if (!text.StartsWith("logoFile", StringComparison.OrdinalIgnoreCase)) continue;
                        int cut = text.IndexOf('=');
                        if (cut < 0) continue;
                        string value = text.Substring(cut + 1).Trim().Trim('"', '\'');
                        byte[]? found = ReadEntry(archive, value);
                        if (found != null) return found;
                    }
                }
            }

            if (kind != "mods")
            {
                // 材质包 / 光影：根目录的 pack.png 就是它自己的预览图
                byte[]? pack = ReadEntry(archive, "pack.png");
                if (pack != null) return pack;
            }

            // 兜底：根目录（不含子目录）里第一张像图标的 png
            var rootImages = archive.Entries
                .Where(entry => entry.Name.Length > 0 && entry.FullName.IndexOf('/') < 0)
                .Where(entry => entry.Name.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            foreach (var entry in rootImages)
            {
                byte[]? found = ReadEntry(archive, entry.FullName);
                if (found != null) return found;
            }

            return null;
        }

        /// <summary>fabric.mod.json 里声明的图标路径（含常见的默认位置）。</summary>
        private static List<string> FabricIconPaths(ZipArchive archive)
        {
            var list = new List<string>();
            byte[]? meta = ReadEntry(archive, "fabric.mod.json");
            string modId = string.Empty;

            if (meta != null)
            {
                try
                {
                    using var document = JsonDocument.Parse(meta);
                    var root = document.RootElement;
                    if (root.ValueKind == JsonValueKind.Object)
                    {
                        if (root.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                        {
                            modId = id.GetString() ?? string.Empty;
                        }

                        if (root.TryGetProperty("icon", out var icon))
                        {
                            if (icon.ValueKind == JsonValueKind.String)
                            {
                                string? text = icon.GetString();
                                if (!string.IsNullOrWhiteSpace(text)) list.Add(text!.TrimStart('/'));
                            }
                            else if (icon.ValueKind == JsonValueKind.Object)
                            {
                                // { "128": "assets/xxx/icon_128.png" }：挑最大的那张
                                foreach (var pair in icon.EnumerateObject())
                                {
                                    if (pair.Value.ValueKind != JsonValueKind.String) continue;
                                    string? text = pair.Value.GetString();
                                    if (!string.IsNullOrWhiteSpace(text)) list.Add(text!.TrimStart('/'));
                                }
                            }
                        }
                    }
                }
                catch (JsonException)
                {
                    // 模组元数据坏了就用下面的默认位置
                }
            }

            if (modId.Length > 0)
            {
                list.Add("assets/" + modId + "/icon.png");
            }

            list.Add("icon.png");
            list.Add("logo.png");
            return list;
        }

        private static byte[]? ReadEntry(ZipArchive archive, string entryPath)
        {
            string normalized = entryPath.Replace('\\', '/').TrimStart('/');
            if (normalized.Length == 0) return null;

            ZipArchiveEntry? entry = archive.Entries.FirstOrDefault(item =>
                string.Equals(item.FullName, normalized, StringComparison.OrdinalIgnoreCase));
            if (entry == null) return null;
            if (entry.Length <= 0 || entry.Length > MaxIconBytes) return null;

            try
            {
                using var stream = entry.Open();
                using var buffer = new MemoryStream((int)Math.Min(entry.Length, MaxIconBytes));
                stream.CopyTo(buffer);
                return buffer.ToArray();
            }
            catch (Exception)
            {
                return null;
            }
        }

        /* -----------------------------------------------------------------
           文件夹形态的材质包 / 光影
           ----------------------------------------------------------------- */

        private static byte[]? IconFromFolder(string folder)
        {
            foreach (string name in new[] { "pack.png", "icon.png", "logo.png" })
            {
                string file = Path.Combine(folder, name);
                if (!File.Exists(file)) continue;

                var info = new FileInfo(file);
                if (info.Length <= 0 || info.Length > MaxIconBytes) continue;

                try
                {
                    return File.ReadAllBytes(file);
                }
                catch (Exception)
                {
                    // 读不了就试下一个
                }
            }
            return null;
        }

        /// <summary>按文件头判断图片类型：图标大多是 png，偶尔是 jpg。</summary>
        private static string SniffImageType(byte[] bytes)
        {
            if (bytes.Length >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50) return "image/png";
            if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8) return "image/jpeg";
            if (bytes.Length >= 12 && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 &&
                bytes[8] == 0x57 && bytes[9] == 0x45) return "image/webp";
            return "image/png";
        }
    }
}
