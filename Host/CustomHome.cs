/*=====================================================================
   StarLaunch · 自定义主页：推送 Custom.xaml 与文件监听
   ---------------------------------------------------------------------
   和 PCL 一样，Custom.xaml 是用户自己的文件：
     · 启动时确保它存在（没有就写一份模板），并把内容推给网页；
     · 用户改完保存，FileSystemWatcher 防抖后自动重新推送，界面即时刷新；
     · 设置页可以打开文件 / 打开所在文件夹 / 恢复默认模板。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        private FileSystemWatcher? _customHomeWatcher;
        private DispatcherTimer? _customHomeTimer;

        /// <summary>初始化：建好文件、推一次内容、开始监听改动。</summary>
        private void StartCustomHome()
        {
            CustomHome.Ensure();
            PushCustomHome("init");
            if (_customHomeWatcher != null) return; // 页面再次导航时不重复挂监听
            StartCustomHomeWatcher();
        }

        /// <summary>
        /// 监听配置目录里的 Custom.xaml。编辑器保存往往是「写临时文件 → 改名覆盖」，
        /// 所以 Changed / Created / Renamed / Deleted 都要接，防抖后再推。
        /// </summary>
        private void StartCustomHomeWatcher()
        {
            try
            {
                _customHomeWatcher = new FileSystemWatcher(CustomHome.Folder, CustomHome.FileName)
                {
                    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size |
                                   NotifyFilters.FileName | NotifyFilters.CreationTime,
                    EnableRaisingEvents = true
                };

                _customHomeWatcher.Changed += OnCustomHomeTouched;
                _customHomeWatcher.Created += OnCustomHomeTouched;
                _customHomeWatcher.Deleted += OnCustomHomeTouched;
                _customHomeWatcher.Renamed += OnCustomHomeTouched;
            }
            catch (Exception)
            {
                // 目录不存在或没有监视权限：退化成「打开设置时重新读取」
            }
        }

        private void OnCustomHomeTouched(object sender, FileSystemEventArgs e)
        {
            // 文件系统事件可能连环触发，攒 260ms 再读一次
            try
            {
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (_customHomeTimer == null)
                    {
                        _customHomeTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(260) };
                        _customHomeTimer.Tick += (_, __) =>
                        {
                            _customHomeTimer!.Stop();
                            CustomHome.Ensure();
                            PushCustomHome("change");
                        };
                    }
                    _customHomeTimer.Stop();
                    _customHomeTimer.Start();
                }));
            }
            catch (Exception)
            {
                // 窗口正在关闭时忽略
            }
        }

        /// <summary>GET /api/custom-home：网页启动时拉一次 Custom.xaml 的内容。</summary>
        private void RespondCustomHome(CoreWebView2WebResourceRequestedEventArgs e)
        {
            CustomHome.Ensure();
            if (CustomHome.TryRead(out string text, out string error))
            {
                RespondJson(e, 200, new
                {
                    ok = true,
                    path = CustomHome.FilePath,
                    folder = CustomHome.Folder,
                    name = CustomHome.FileName,
                    text
                });
                return;
            }

            RespondJson(e, 200, new
            {
                ok = false,
                path = CustomHome.FilePath,
                folder = CustomHome.Folder,
                name = CustomHome.FileName,
                error
            });
        }

        /// <summary>把 Custom.xaml 的当前内容推给网页（网页端来源为「启动器目录」时直接换掉内容）。</summary>
        private void PushCustomHome(string reason)
        {
            try
            {
                string path = CustomHome.FilePath;
                if (!File.Exists(path)) CustomHome.Ensure();

                if (CustomHome.TryRead(out string text, out string error))
                {
                    PostPageMessage("custom-home", new Dictionary<string, object?>
                    {
                        ["ok"] = true,
                        ["reason"] = reason,
                        ["path"] = path,
                        ["folder"] = CustomHome.Folder,
                        ["name"] = CustomHome.FileName,
                        ["text"] = text
                    });
                }
                else
                {
                    PostPageMessage("custom-home", new Dictionary<string, object?>
                    {
                        ["ok"] = false,
                        ["reason"] = reason,
                        ["path"] = path,
                        ["folder"] = CustomHome.Folder,
                        ["name"] = CustomHome.FileName,
                        ["error"] = error
                    });
                }
            }
            catch (Exception)
            {
                // WebView2 尚未就绪或已关闭：网页端下次打开设置时会再要一次
            }
        }

        /// <summary>用系统默认程序打开 Custom.xaml；没有关联程序时退回记事本。</summary>
        private void OpenCustomHomeFile()
        {
            string path = CustomHome.Ensure();
            try
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
            catch (Exception)
            {
                try
                {
                    Process.Start(new ProcessStartInfo("notepad.exe", "\"" + path + "\"") { UseShellExecute = true });
                }
                catch (Exception)
                {
                    // 连记事本都起不来就没什么可做的了
                }
            }
        }

        /// <summary>在资源管理器里打开配置目录。</summary>
        private void OpenCustomHomeFolder()
        {
            try
            {
                CustomHome.Ensure();
                Process.Start(new ProcessStartInfo(CustomHome.Folder) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // 打不开文件夹时静默忽略
            }
        }

        /// <summary>把 Custom.xaml 恢复成内置模板（覆盖用户内容）。</summary>
        private void ResetCustomHome()
        {
            bool ok = CustomHome.WriteDefault(true);
            PushCustomHome(ok ? "reset" : "error");
        }

        /// <summary>窗口关闭时停掉监听，避免退出后还有事件回调。</summary>
        private void StopCustomHomeWatcher()
        {
            try
            {
                if (_customHomeWatcher != null)
                {
                    _customHomeWatcher.EnableRaisingEvents = false;
                    _customHomeWatcher.Dispose();
                    _customHomeWatcher = null;
                }
                if (_customHomeTimer != null)
                {
                    _customHomeTimer.Stop();
                    _customHomeTimer = null;
                }
            }
            catch (Exception)
            {
                // 退出流程里出错不影响关闭
            }
        }
    }
}
