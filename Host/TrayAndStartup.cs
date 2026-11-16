/*=====================================================================
   StarLaunch · 窗口行为 + 托盘 + 启动时的后台任务
   ---------------------------------------------------------------------
   设置里的这几个开关以前点了只弹 toast，状态没人用。现在都落到宿主：

     · 记住窗口尺寸      → 关闭时存进 StarLaunch.config.json，下次恢复；
     · 关闭时最小化到托盘 → 真画一个托盘图标（Win32 Shell_NotifyIcon，
                            不引 WinForms，免得和 WPF 的 MessageBox 撞名）；
     · 自动清理安装缓存  → %TEMP%\StarLaunch-* 里超过 7 天的临时文件；
     · 检查启动器更新    → 启动后 2.5 秒问一次 GitHub Releases。

   托盘图标只在窗口隐藏时存在；恢复窗口就收掉，和 PCL 一致。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private const int TrayCallbackMessage = 0x8000 + 101;   // WM_APP + 101
        private const int WmLeftButtonUp = 0x0202;
        private const int WmLeftButtonDblClk = 0x0203;
        private const int WmRightButtonUp = 0x0205;
        private const int WmNull = 0x0000;

        private const uint NimAdd = 0;
        private const uint NimModify = 1;
        private const uint NimDelete = 2;
        private const uint NifMessage = 0x0001;
        private const uint NifIcon = 0x0002;
        private const uint NifTip = 0x0004;

        private const uint MfString = 0x0000;
        private const uint TpmReturnCmd = 0x0100;
        private const uint TpmRightButton = 0x0002;

        private bool _exiting;
        private bool _trayHooked;
        private bool _trayAdded;
        private IntPtr _trayIcon;

        /// <summary>上一次托盘图标创建失败的原因（没失败过就是 null）。</summary>
        private string? _trayError;

        /* -----------------------------------------------------------------
           窗口尺寸
           ----------------------------------------------------------------- */

        /// <summary>从配置恢复上次的窗口尺寸（「记住窗口尺寸」开着时才恢复）。</summary>
        private void RestoreWindowSize()
        {
            var config = LauncherConfigStore.Current;
            if (!config.RememberWindowSize) return;
            if (config.WindowWidth <= 0 || config.WindowHeight <= 0) return;

            try
            {
                Width = config.WindowWidth;
                Height = config.WindowHeight;
            }
            catch (Exception)
            {
                // 值不合理就用 XAML 里的默认尺寸
            }
        }

        private void SaveWindowSize()
        {
            try
            {
                var config = LauncherConfigStore.Current;
                if (!config.RememberWindowSize) return;
                if (WindowState != System.Windows.WindowState.Normal) return;
                if (Width < 320 || Height < 240) return;

                config.WindowWidth = Width;
                config.WindowHeight = Height;
                LauncherConfigStore.Save();
            }
            catch (Exception)
            {
                // 存不下来不影响关闭
            }
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            SaveWindowSize();

            // 「关闭时最小化到托盘」：不是真退出，只是藏起来（托盘图标负责叫回来）
            if (!_exiting && LauncherConfigStore.Current.CloseToTray)
            {
                if (ShowTrayIcon())
                {
                    e.Cancel = true;
                    Hide();
                    return;
                }

                // 图标建不出来的话绝对不能藏：界面没了、通知区也没图标，
                // 用户只能去任务管理器结束进程。先把原因摆到界面上。
                ReportTrayError();
                if (!_trayFailureShown)
                {
                    _trayFailureShown = true;
                    e.Cancel = true;
                    return;
                }
                // 再点一次关闭就按真退出处理，别把人困在窗口里
                _exiting = true;
            }

            CloseLaunchReporter();
            HideTrayIcon();
            base.OnClosing(e);
        }

        private bool _trayFailureShown;

        /* -----------------------------------------------------------------
           托盘
           ----------------------------------------------------------------- */

        /// <summary>
        /// 把图标加进通知区。返回 false 时 <see cref="_trayError"/> 里是原因——
        /// 关闭到托盘要靠这个结果决定「到底能不能藏窗口」。
        /// </summary>
        private bool ShowTrayIcon()
        {
            try
            {
                IntPtr window = new WindowInteropHelper(this).Handle;
                if (window == IntPtr.Zero)
                {
                    _trayError = "窗口句柄还没创建";
                    return false;
                }

                if (!_trayHooked)
                {
                    HwndSource.FromHwnd(window)?.AddHook(TrayWndProc);
                    _trayHooked = true;
                }
                if (_trayAdded) return true;

                if (_trayIcon == IntPtr.Zero) _trayIcon = LoadAppIcon();

                var data = new NotifyIconData
                {
                    Size = Marshal.SizeOf<NotifyIconData>(),
                    Window = window,
                    Id = 1,
                    Flags = NifMessage | NifIcon | NifTip,
                    CallbackMessage = TrayCallbackMessage,
                    Icon = _trayIcon,
                    Tip = "StarLaunch",
                    Info = string.Empty,
                    InfoTitle = string.Empty
                };

                _trayAdded = ShellNotifyIcon(NimAdd, ref data);

                // 上一次的图标没删干净（比如资源管理器刚重启）时 NIM_ADD 会失败，
                // 这时用 NIM_MODIFY 覆盖回同一个 ID 也能让它冒出来
                if (!_trayAdded) _trayAdded = ShellNotifyIcon(NimModify, ref data);

                if (!_trayAdded)
                {
                    // 图标句柄拿不到时别硬塞一个空的：先补一张系统默认图标再试
                    if (_trayIcon != IntPtr.Zero)
                    {
                        _trayIcon = LoadIcon(IntPtr.Zero, new IntPtr(32512)); // IDI_APPLICATION
                        data.Icon = _trayIcon;
                        _trayAdded = ShellNotifyIcon(NimAdd, ref data);
                    }
                }

                _trayError = _trayAdded ? null : "Shell_NotifyIcon 返回失败（错误码 " + Marshal.GetLastWin32Error() + "）";
                return _trayAdded;
            }
            catch (Exception ex)
            {
                _trayError = ex.Message;
                _trayAdded = false;
                return false;
            }
        }

        private void HideTrayIcon()
        {
            if (!_trayAdded) return;
            try
            {
                var data = new NotifyIconData
                {
                    Size = Marshal.SizeOf<NotifyIconData>(),
                    Window = new WindowInteropHelper(this).Handle,
                    Id = 1,
                    Tip = string.Empty,
                    Info = string.Empty,
                    InfoTitle = string.Empty
                };
                ShellNotifyIcon(NimDelete, ref data);
            }
            catch (Exception)
            {
                // 已经没了
            }
            _trayAdded = false;
        }

        /// <summary>托盘建不起来时用网页浮层说清楚（宿主自己的界面就是网页）。</summary>
        private void ReportTrayError()
        {
            if (_trayError == null) return;
            PostPageMessage("host-error", new Dictionary<string, object?>
            {
                ["title"] = "后台托盘图标没能创建",
                ["message"] = "开启「关闭时最小化到托盘」时没能把图标加到通知区：" + _trayError +
                    "\n\n窗口没有被藏起来，你可以继续正常使用；如果一直这样，多半是资源管理器的通知区域出了状况，重启一次资源管理器再试。"
            });
        }

        private IntPtr TrayWndProc(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (message != TrayCallbackMessage) return IntPtr.Zero;

            handled = true;
            int mouse = (int)(lParam.ToInt64() & 0xFFFF);
            if (mouse == WmLeftButtonDblClk || mouse == WmLeftButtonUp)
            {
                RestoreFromTray();
            }
            else if (mouse == WmRightButtonUp)
            {
                ShowTrayMenu(window);
            }
            return IntPtr.Zero;
        }

        private void ShowTrayMenu(IntPtr window)
        {
            IntPtr menu = CreatePopupMenu();
            if (menu == IntPtr.Zero) return;

            try
            {
                AppendMenu(menu, MfString, 1, "显示 StarLaunch");
                AppendMenu(menu, MfString, 2, "退出");

                if (!GetCursorPos(out Point point)) return;

                // 不先 SetForegroundWindow 的话，菜单点外面不会消失（Windows 的老脾气）
                SetForegroundWindow(window);

                int command = TrackPopupMenu(
                    menu, TpmReturnCmd | TpmRightButton, point.X, point.Y, 0, window, IntPtr.Zero);

                // 官方文档要求：菜单关掉后给窗口发一条 WM_NULL，否则下次点图标没反应
                PostMessage(window, WmNull, IntPtr.Zero, IntPtr.Zero);

                if (command == 1) RestoreFromTray();
                else if (command == 2) ExitFromTray();
            }
            finally
            {
                DestroyMenu(menu);
            }
        }

        private void RestoreFromTray()
        {
            try
            {
                Show();
                if (WindowState == System.Windows.WindowState.Minimized)
                {
                    WindowState = System.Windows.WindowState.Normal;
                }
                Activate();
                Topmost = true;
                Topmost = false;
                HideTrayIcon();
            }
            catch (Exception)
            {
                // 窗口正在关闭
            }
        }

        private void ExitFromTray()
        {
            _exiting = true;
            RestoreFromTray();
            Close();
        }

        /// <summary>通知区图标：优先取 exe 自带的（favicon.ico），拿不到退回系统默认图标。</summary>
        private static IntPtr LoadAppIcon()
        {
            try
            {
                string exe = Environment.ProcessPath
                    ?? Path.Combine(AppContext.BaseDirectory, "StarLaunch.exe");
                if (File.Exists(exe) &&
                    ExtractIconEx(exe, 0, out IntPtr large, out IntPtr small, 1) > 0)
                {
                    if (small != IntPtr.Zero) return small;
                    if (large != IntPtr.Zero) return large;
                }
            }
            catch (Exception)
            {
                // 退回系统默认图标
            }
            return LoadIcon(IntPtr.Zero, new IntPtr(32512)); // IDI_APPLICATION
        }

        /* -----------------------------------------------------------------
           启动时的后台任务
           ----------------------------------------------------------------- */

        /// <summary>导航完成后跑一次：清缓存 + 查更新。都不阻塞界面。</summary>
        private void RunStartupTasks()
        {
            var config = LauncherConfigStore.Current;
            if (config.CleanInstallCache) _ = Task.Run(CleanInstallCache);
            if (config.CheckLauncherUpdate) _ = CheckUpdateInBackground();
        }

        /// <summary>删掉 7 天前的安装临时文件（整合包 / 加载器安装器 / 解压目录）。</summary>
        private static void CleanInstallCache()
        {
            try
            {
                string temp = Path.GetTempPath();
                if (!Directory.Exists(temp)) return;

                DateTime deadline = DateTime.UtcNow.AddDays(-7);
                foreach (string path in Directory.EnumerateFileSystemEntries(temp, "StarLaunch-*"))
                {
                    try
                    {
                        string name = Path.GetFileName(path);
                        bool ours =
                            name.StartsWith("StarLaunch-pack-", StringComparison.OrdinalIgnoreCase) ||
                            name.StartsWith("StarLaunch-loader-", StringComparison.OrdinalIgnoreCase) ||
                            name.StartsWith("StarLaunch-import-", StringComparison.OrdinalIgnoreCase);
                        if (!ours) continue;

                        var info = new DirectoryInfo(path);
                        if (!info.Exists && info.LastWriteTimeUtc == DateTime.MinValue) continue;
                        if (info.LastWriteTimeUtc > deadline) continue;

                        if (Directory.Exists(path)) Directory.Delete(path, true);
                        else File.Delete(path);
                    }
                    catch (Exception)
                    {
                        // 正被别的进程占着，下次再说
                    }
                }
            }
            catch (Exception)
            {
                // 临时目录都读不了就算了
            }
        }

        private async Task CheckUpdateInBackground()
        {
            try
            {
                // 别和首屏渲染、版本扫描抢网络
                await Task.Delay(2500).ConfigureAwait(false);

                var info = await UpdateChecker.CheckAsync(CancellationToken.None).ConfigureAwait(false);
                if (!info.Available) return;

                PostAsync("update-available", new Dictionary<string, object?>
                {
                    ["latest"] = info.Latest,
                    ["current"] = info.Current,
                    ["url"] = info.Url
                });
            }
            catch (Exception)
            {
                // 离线 / 仓库没发版：静默
            }
        }

        /* -----------------------------------------------------------------
           Win32
           ----------------------------------------------------------------- */

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NotifyIconData
        {
            public int Size;
            public IntPtr Window;
            public uint Id;
            public uint Flags;
            public uint CallbackMessage;
            public IntPtr Icon;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string Tip;

            public uint State;
            public uint StateMask;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string Info;

            public uint TimeoutOrVersion;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string InfoTitle;

            public uint InfoFlags;
            public Guid ItemGuid;
            public IntPtr BalloonIcon;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Point
        {
            public int X;
            public int Y;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool ShellNotifyIcon(uint message, ref NotifyIconData data);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, int count);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr LoadIcon(IntPtr instance, IntPtr name);

        [DllImport("user32.dll")]
        private static extern IntPtr CreatePopupMenu();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool AppendMenu(IntPtr menu, uint flags, uint id, string text);

        [DllImport("user32.dll")]
        private static extern bool DestroyMenu(IntPtr menu);

        [DllImport("user32.dll")]
        private static extern int TrackPopupMenu(
            IntPtr menu, uint flags, int x, int y, int reserved, IntPtr window, IntPtr rect);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out Point point);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    }
}
