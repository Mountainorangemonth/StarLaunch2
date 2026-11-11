/*=====================================================================
   StarLaunch · 壁纸接口：扫描外部目录并提供 /wallpapers/*
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。
   =====================================================================*/
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private static readonly Lazy<string> WallpaperFolderPath = new(ResolveWallpaperFolder);

        /// <summary>
        /// 用户壁纸目录：优先用 exe 同级的 wallpapers（便携版），
        /// 该目录不可写时退回 %LOCALAPPDATA%\StarLaunch\wallpapers。
        /// </summary>
        private static string GetWallpaperFolder() => WallpaperFolderPath.Value;

        private static string ResolveWallpaperFolder()
        {
            string portable = Path.Combine(AppContext.BaseDirectory, "wallpapers");
            try
            {
                Directory.CreateDirectory(portable);
                string probe = Path.Combine(portable, ".write-test");
                File.WriteAllText(probe, string.Empty);
                File.Delete(probe);
                return portable;
            }
            catch
            {
                string local = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "StarLaunch", "wallpapers");
                Directory.CreateDirectory(local);
                return local;
            }
        }

        private void OpenWallpaperFolder()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = GetWallpaperFolder(),
                    UseShellExecute = true
                });
            }
            catch
            {
                // 资源管理器打不开时静默忽略，网页端已有提示
            }
        }

        private static bool IsWallpaperImage(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".bmp" or ".avif" => true,
                _ => false
            };
        }

        private void RespondWallpaperManifest(CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                string folder = GetWallpaperFolder();
                var items = Directory.EnumerateFiles(folder)
                    .Where(IsWallpaperImage)
                    .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase)
                    .Select(path =>
                    {
                        var info = new FileInfo(path);
                        return new
                        {
                            name = info.Name,
                            // 带 mtime 查询串：图片内容变了 URL 也会变，避免浏览器继续用旧缓存
                            url = "/wallpapers/" + Uri.EscapeDataString(info.Name) + "?v=" + info.LastWriteTimeUtc.Ticks,
                            size = info.Length
                        };
                    })
                    .ToArray();

                string payload = JsonSerializer.Serialize(new { folder, items });
                byte[] bytes = Encoding.UTF8.GetBytes(payload);
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    new MemoryStream(bytes), 200, "OK",
                    "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store");
            }
            catch (Exception ex)
            {
                string payload = JsonSerializer.Serialize(new { error = ex.Message });
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    new MemoryStream(Encoding.UTF8.GetBytes(payload)), 500, "Internal Server Error",
                    "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store");
            }
        }

        private void RespondWallpaperFile(CoreWebView2WebResourceRequestedEventArgs e, string escapedName)
        {
            try
            {
                string folder = Path.GetFullPath(GetWallpaperFolder());
                string name = Uri.UnescapeDataString(escapedName);

                // 只允许壁纸目录下的单层图片文件名，拒绝 ..、子目录和绝对路径
                if (!IsWallpaperImage(name) || Path.GetFileName(name) != name)
                {
                    RespondNotFound(e);
                    return;
                }

                string fullPath = Path.GetFullPath(Path.Combine(folder, name));
                if (!fullPath.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                    !File.Exists(fullPath))
                {
                    RespondNotFound(e);
                    return;
                }

                FileStream stream = File.OpenRead(fullPath);
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    stream, 200, "OK",
                    $"Content-Type: {GetContentType(fullPath)}\r\nCache-Control: private, max-age=3600");
            }
            catch (Exception)
            {
                RespondNotFound(e);
            }
        }

    }
}
