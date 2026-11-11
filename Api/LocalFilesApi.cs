/*=====================================================================
   StarLaunch · 本地图片接口：GET /api/local-image?path=…
   ---------------------------------------------------------------------
   自定义主页（Custom.xaml）里的 local:MyImage 允许写本地路径，
   网页在 https://app.local 这个虚拟域名下没法直接读磁盘，
   所以由宿主把图片读成内存流再交回去。

   安全边界：
     · 只放行图片扩展名，其它一律 404；
     · 单个文件不超过 16 MB；
     · 相对路径按 Custom.xaml 所在目录解析（和 PCL 一致）。
   =====================================================================*/
using System;
using System.IO;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private const long MaxLocalImageBytes = 16 * 1024 * 1024;

        private static bool IsLocalImage(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif"
                    or ".bmp" or ".svg" or ".ico" or ".avif" => true,
                _ => false
            };
        }

        /// <summary>把本地图片读进内存并作为 HTTP 响应返回。</summary>
        private void RespondLocalImage(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            string? raw = ReadQueryValue(uri, "path");
            string path = ResolveLocalImagePath(raw);

            if (path.Length == 0 || !IsLocalImage(path) || !File.Exists(path))
            {
                RespondNotFound(e);
                return;
            }

            try
            {
                var info = new FileInfo(path);
                if (info.Length > MaxLocalImageBytes)
                {
                    RespondNotFound(e);
                    return;
                }

                byte[] bytes = File.ReadAllBytes(path);
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    new MemoryStream(bytes), 200, "OK",
                    "Content-Type: " + GetContentType(path) + "\r\nCache-Control: no-cache");
            }
            catch (Exception)
            {
                RespondNotFound(e);
            }
        }

        /// <summary>把网页传来的路径收敛成绝对路径；不合法就返回空串。</summary>
        private static string ResolveLocalImagePath(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

            string path = raw!.Trim().Trim('"');
            try
            {
                if (path.StartsWith("file://", StringComparison.OrdinalIgnoreCase) &&
                    Uri.TryCreate(path, UriKind.Absolute, out var uri))
                {
                    path = uri.LocalPath;
                }

                path = Environment.ExpandEnvironmentVariables(path);

                if (!Path.IsPathRooted(path))
                {
                    path = Path.Combine(CustomHome.Folder, path);
                }

                return Path.GetFullPath(path);
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }
    }
}
