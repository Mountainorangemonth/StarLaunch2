using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Win32;

namespace StarLaunch
{
    public partial class MainWindow : Window
    {


        private bool _webViewSuspended;
        private bool _suspendInProgress;

        private const int DwmwaWindowCornerPreference = 33;
        private const int DwmwcpRound = 2;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        public MainWindow()
        {

            InitializeComponent();
            StateChanged += OnWindowStateChanged;
            Loaded += async (_, __) => await InitWebViewAsync();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            TryEnableRoundedCorners();
        }

        /// <summary>
        /// Windows 11 圆角。Win10 及更早版本没有这个属性，调用会失败，直接忽略。
        /// </summary>
        private void TryEnableRoundedCorners()
        {
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero) return;
                int preference = DwmwcpRound;
                DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref preference, sizeof(int));
            }
            catch
            {
                // dwmapi 不可用或系统版本不支持时保持默认窗口形状
            }
        }

        private async System.Threading.Tasks.Task InitWebViewAsync()
        {
            try
            {
                // WebView2 的缓存和用户数据放到 exe 同级目录，跟随程序一起移动。
                // 如果程序放在 Program Files 等只读目录，创建失败时退回 LocalAppData，
                // 避免直接白屏或启动崩溃。
                string userDataFolder = Path.Combine(AppContext.BaseDirectory, "WebView2Data");
                try
                {
                    Directory.CreateDirectory(userDataFolder);
                    string probe = Path.Combine(userDataFolder, ".write-test");
                    File.WriteAllText(probe, string.Empty);
                    File.Delete(probe);
                }
                catch
                {
                    userDataFolder = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "StarLaunch", "WebView2");
                    Directory.CreateDirectory(userDataFolder);
                }

                var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(environment);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "无法初始化内嵌浏览器（WebView2）。\n\n" +
                    "请确认系统已安装 Microsoft Edge WebView2 Runtime；\n" +
                    "如果程序放在受保护目录，请换到可写目录再试。\n\n" +
                    "错误信息：" + ex.Message,
                    "StarLaunch", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            var core = webView.CoreWebView2;
            // 方式一：全局禁用默认上下文菜单和开发者工具（推荐）
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            // 方式二：事件拦截（作为补充，可确保万无一失）
            core.ContextMenuRequested += (s, e) =>
            {
                // 将 Handled 设为 true，WebView2 将不会显示菜单
                e.Handled = true;
            };
            // 方式三：快捷键层兜底，彻底吃掉打开控制台 / 查看源代码的组合键

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
            core.Navigate("https://app.local/index.html");
        }

        /// <summary>
        /// 屏蔽掉所有能打开开发者工具 / 查看源代码的快捷键。
        /// WebView2 的 AreDevToolsEnabled=false 已经关掉了 DevTools，
        /// 这里再吃掉按键，避免焦点落在网页上时被浏览器加速键绕过去。
        /// </summary>
        private void OnAcceleratorKeyPressed(object? sender, CoreWebView2AcceleratorKeyPressedEventArgs e)
        {
            const uint F12 = 0x7B;
            const uint I = 0x49;
            const uint J = 0x4A;
            const uint C = 0x43;
            const uint K = 0x4B;
            const uint U = 0x55;
            const uint F = 0x46;

            uint key = e.VirtualKey;
            if (key == F12)
            {
                e.Handled = true;
                return;
            }

            bool ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);
            bool shift = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
            if (!ctrl) return;

            // Ctrl+U 查看源代码，Ctrl+Shift+I/J/C/K 打开控制台与元素面板
            if (key == U || (shift && (key == I || key == J || key == C || key == K || key == F)))
            {
                e.Handled = true;
            }
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

                if (!root.TryGetProperty("type", out var type))
                {
                    return;
                }

                // 设置页“打开文件夹”按钮
                if (type.GetString() == "open-wallpapers")
                {
                    OpenWallpaperFolder();
                    return;
                }

                // 公告：选择一个本地 .md / .xaml 文件
                if (type.GetString() == "pick-notice-file")
                {
                    PickNoticeFile();
                    return;
                }

                // 公告：重新读取已记住路径的文件（文件被修改后刷新）
                if (type.GetString() == "read-notice-file")
                {
                    string? path = root.TryGetProperty("path", out var pathElement)
                        ? pathElement.GetString()
                        : null;
                    if (!string.IsNullOrWhiteSpace(path)) ReadNoticeFile(path!);
                    return;
                }

                // 自定义公告里的链接交给系统浏览器打开
                if (type.GetString() == "open-external" &&
                    root.TryGetProperty("url", out var urlElement))
                {
                    OpenExternal(urlElement.GetString());
                    return;
                }

                if (type.GetString() != "window-control" ||
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

        /* ---------------- 公告文件（Markdown / XAML） ---------------- */

        private const long MaxNoticeFileBytes = 2 * 1024 * 1024;

        private static bool IsNoticeFile(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".md" or ".markdown" or ".xaml" or ".xml" or ".txt" => true,
                _ => false
            };
        }

        private void PickNoticeFile()
        {
            try
            {
                var dialog = new OpenFileDialog
                {
                    Title = "选择公告内容（Markdown 或 XAML）",
                    Filter = "公告文件 (*.md;*.xaml;*.xml;*.txt)|*.md;*.xaml;*.xml;*.txt|" +
                             "Markdown (*.md)|*.md|XAML (*.xaml;*.xml)|*.xaml;*.xml|所有文件 (*.*)|*.*",
                    Multiselect = false,
                    CheckFileExists = true
                };

                if (dialog.ShowDialog(this) != true)
                {
                    PostNoticeFile(new { ok = false, canceled = true });
                    return;
                }

                ReadNoticeFile(dialog.FileName);
            }
            catch (Exception ex)
            {
                PostNoticeFile(new { ok = false, canceled = false, error = ex.Message });
            }
        }

        private void ReadNoticeFile(string path)
        {
            try
            {
                string fullPath = Path.GetFullPath(path);
                if (!IsNoticeFile(fullPath))
                {
                    PostNoticeFile(new { ok = false, canceled = false, path = fullPath, error = "只支持 .md / .xaml / .xml / .txt 文件" });
                    return;
                }

                var info = new FileInfo(fullPath);
                if (!info.Exists)
                {
                    PostNoticeFile(new { ok = false, canceled = false, path = fullPath, error = "文件不存在" });
                    return;
                }
                if (info.Length > MaxNoticeFileBytes)
                {
                    PostNoticeFile(new { ok = false, canceled = false, path = fullPath, error = "文件超过 2 MB，请精简后再试" });
                    return;
                }

                string text = File.ReadAllText(fullPath, Encoding.UTF8);
                PostNoticeFile(new
                {
                    ok = true,
                    canceled = false,
                    path = fullPath,
                    name = info.Name,
                    text
                });
            }
            catch (Exception ex)
            {
                PostNoticeFile(new { ok = false, canceled = false, path, error = ex.Message });
            }
        }

        private void PostNoticeFile(object payload)
        {
            try
            {
                // 合并统一的 type 字段，页面只处理 notice-file
                var dict = new Dictionary<string, object?> { ["type"] = "notice-file" };
                foreach (var prop in payload.GetType().GetProperties())
                {
                    dict[prop.Name] = prop.GetValue(payload);
                }
                webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(dict));
            }
            catch
            {
                // WebView2 已关闭时忽略
            }
        }

        private void OpenExternal(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return;

            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch
            {
                // 没有可用的默认浏览器时忽略
            }
        }

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

            string relativePath = uri.LocalPath.TrimStart('/').Replace('/', '.');
            string resourceName = $"StarLaunch.WebAssets.{relativePath}";

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

        private void RespondNotFound(CoreWebView2WebResourceRequestedEventArgs e)
        {
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