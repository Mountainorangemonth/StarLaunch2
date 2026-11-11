using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;
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

            // 自定义主页：Custom.xaml 建好并监听改动（页面加载完再第一次推送）
            core.NavigationCompleted += (_, __) => StartCustomHome();
            Closed += (_, __) => StopCustomHomeWatcher();

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

    }
}
