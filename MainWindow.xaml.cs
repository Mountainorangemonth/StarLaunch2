using Microsoft.Web.WebView2.Core;
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;

namespace StarLaunch
{
    public partial class MainWindow : Window
    {


        private bool _webViewSuspended;
        private bool _suspendInProgress;

        public MainWindow()
        {

            InitializeComponent();
            StateChanged += OnWindowStateChanged;
            Loaded += async (_, __) => await InitWebViewAsync();
        }

        private async System.Threading.Tasks.Task InitWebViewAsync()
        {



            await webView.EnsureCoreWebView2Async();

            var core = webView.CoreWebView2;
            // 方式一：全局禁用默认上下文菜单（推荐）
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            // 方式二：事件拦截（作为补充，可确保万无一失）
            core.ContextMenuRequested += (s, e) =>
            {
                // 将 Handled 设为 true，WebView2 将不会显示菜单
                e.Handled = true;
            };

            // 网页标题栏按钮（最小化 / 最大化 / 关闭）通过 postMessage 发回宿主
            core.WebMessageReceived += OnWebMessageReceived;

            // 1. 只拦截 https://app.local/ 下的请求
            core.AddWebResourceRequestedFilter(
                "https://app.local/*",
                CoreWebView2WebResourceContext.All);

            core.WebResourceRequested += OnWebResourceRequested;
            // 启用对非客户区（可拖拽区域）的支持
            webView.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true;

            // 2. 导航到虚拟域名（此地址磁盘上不存在）
            // Debug 构建通过环境变量 STARLAUNCH_DEV_URL 切到 Vite dev server，便于 HMR 联调；
            // Release 行为与之前完全一致。
#if DEBUG
            var devUrl = Environment.GetEnvironmentVariable("STARLAUNCH_DEV_URL");
            if (!string.IsNullOrEmpty(devUrl))
            {
                core.Navigate(devUrl);
                return;
            }
#endif
            core.Navigate("https://app.local/index.html");
        }

        private async void OnWindowStateChanged(object? sender, EventArgs e)
        {
            try
            {
                var core = webView.CoreWebView2;
                if (core == null) return;

                if (WindowState == System.Windows.WindowState.Minimized)
                {
                    if (_webViewSuspended || _suspendInProgress) return;
                    _suspendInProgress = true;
                    try
                    {
                        // 最小化时暂停 WebView2 渲染、计时器与网络活动
                        var suspended = await core.TrySuspendAsync();
                        if (suspended && WindowState != System.Windows.WindowState.Minimized)
                        {
                            // 挂起过程中窗口已经被恢复，立即唤醒，避免白屏
                            core.Resume();
                            _webViewSuspended = false;
                        }
                        else
                        {
                            _webViewSuspended = suspended;
                        }
                    }
                    finally
                    {
                        _suspendInProgress = false;
                    }
                }
                else if (_webViewSuspended)
                {
                    core.Resume();
                    _webViewSuspended = false;
                }
            }
            catch
            {
                // WebView2 正在关闭或尚未初始化时忽略
            }
        }

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                using var json = JsonDocument.Parse(e.WebMessageAsJson);
                var root = json.RootElement;

                if (!root.TryGetProperty("type", out var type) ||
                    type.GetString() != "window-control" ||
                    !root.TryGetProperty("action", out var actionElement))
                {
                    return;
                }

                switch (actionElement.GetString())
                {
                    case "minimize":
                        WindowState = System.Windows.WindowState.Minimized;
                        break;
                    case "maximize":
                        WindowState = WindowState == System.Windows.WindowState.Maximized
                            ? System.Windows.WindowState.Normal
                            : System.Windows.WindowState.Maximized;
                        break;
                    case "close":
                        Close();
                        break;
                }
            }
            catch (JsonException)
            {
                // 无法解析的网页消息直接忽略
            }
        }

        private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var uri = new Uri(e.Request.Uri);
            string relativePath = uri.LocalPath.TrimStart('/').Replace('/', '.');
            string resourceName = $"StarLaunch.WebAssets.{relativePath}";

            var asm = Assembly.GetExecutingAssembly();
            Stream? stream = asm.GetManifestResourceStream(resourceName);

            if (stream == null)
            {
                // 如果资源找不到，明确返回 404，方便在页面上看到错误
                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    null, 404, "Not Found", "Content-Type: text/plain\r\nCache-Control: no-store");
                return;
            }

            string contentType = Path.GetExtension(uri.LocalPath).ToLowerInvariant() switch
            {
                ".html" or ".htm" => "text/html; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".js" => "application/javascript; charset=utf-8",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                ".svg" => "image/svg+xml",
                ".ico" => "image/x-icon",
                _ => "application/octet-stream"
            };

            // 关键：必须设置 e.Response，WebView2 才会使用你的数据
            // no-store：前端入口文件名固定（app.js/style.css），禁止磁盘缓存跨启动复用旧版
            e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                stream, 200, "OK", $"Content-Type: {contentType}\r\nCache-Control: no-store");
        }

       
    }
}