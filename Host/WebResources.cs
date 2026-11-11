/*=====================================================================
   StarLaunch · 虚拟域名资源服务：静态资源与 /api 路由
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var uri = new Uri(e.Request.Uri);

            // 壁纸由宿主实时扫描磁盘目录，不走嵌入式资源
            if (uri.AbsolutePath.Equals("/wallpapers/manifest.json", StringComparison.OrdinalIgnoreCase))
            {
                RespondWallpaperManifest(e);
                return;
            }
            if (uri.AbsolutePath.StartsWith("/wallpapers/", StringComparison.OrdinalIgnoreCase))
            {
                RespondWallpaperFile(e, uri.AbsolutePath.Substring("/wallpapers/".Length));
                return;
            }

            // 只读数据接口：网页用 fetch 读宿主侧的真实状态（版本列表等）
            if (uri.AbsolutePath.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                RespondApi(e, uri);
                return;
            }

            string relativePath = uri.LocalPath.TrimStart('/').Replace('/', '.');            string resourceName = $"StarLaunch.WebAssets.{relativePath}";

            var asm = Assembly.GetExecutingAssembly();
            Stream? stream = asm.GetManifestResourceStream(resourceName);

            if (stream == null)
            {
                // 如果资源找不到，明确返回 404，方便在页面上看到错误
                RespondNotFound(e);
                return;
            }

            string contentType = GetContentType(uri.LocalPath);

            // 关键：必须设置 e.Response，WebView2 才会使用你的数据
            // no-store：重新编译后不会继续用缓存里的旧 index.html / app.js
            e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                stream, 200, "OK",
                $"Content-Type: {contentType}\r\nCache-Control: no-store");
        }

        private static readonly JsonSerializerOptions ApiJsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private void RespondApi(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            try
            {
                if (uri.AbsolutePath.Equals("/api/versions", StringComparison.OrdinalIgnoreCase))
                {
                    RespondVersions(e, uri);
                    return;
                }

                // 自定义主页（Custom.xaml）：网页启动时拉一次当前内容
                if (uri.AbsolutePath.Equals("/api/custom-home", StringComparison.OrdinalIgnoreCase))
                {
                    RespondCustomHome(e);
                    return;
                }

                // Custom.xaml 里 local:MyImage 引用的本地图片
                if (uri.AbsolutePath.Equals("/api/local-image", StringComparison.OrdinalIgnoreCase))
                {
                    RespondLocalImage(e, uri);
                    return;
                }

                RespondJson(e, 404, new { ok = false, error = "未知接口：" + uri.AbsolutePath });
            }
            catch (Exception ex)
            {
                RespondJson(e, 500, new { ok = false, error = ex.Message });
            }
        }

        private void RespondJson(CoreWebView2WebResourceRequestedEventArgs e, int status, object payload)
        {
            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(payload, ApiJsonOptions);
            e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                new MemoryStream(bytes), status, status == 200 ? "OK" : "Error",
                "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store");
        }

        private void RespondNotFound(CoreWebView2WebResourceRequestedEventArgs e)        {
            e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                null, 404, "Not Found",
                "Content-Type: text/plain\r\nCache-Control: no-store");
        }

        private static string GetContentType(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".html" or ".htm" => "text/html; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".js" => "application/javascript; charset=utf-8",
                ".json" => "application/json; charset=utf-8",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                ".bmp" => "image/bmp",
                ".avif" => "image/avif",
                ".svg" => "image/svg+xml",
                ".ico" => "image/x-icon",
                _ => "application/octet-stream"
            };
        }

    }
}
