/*=====================================================================
   StarLaunch · 宿主消息：网页 → 宿主的指令分发
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
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
                    RunOpen("wallpapers", ReadString(root, "id"), OpenWallpaperFolder);
                    return;
                }

                // 版本管理：游戏文件夹的增删与设置
                switch (type.GetString())
                {
                    case "add-game-dirs":
                    case "pick-game-dir":          // 旧网页的叫法，保留兼容
                        AddGameDirs(ReadString(root, "isolation"));
                        return;
                    case "remove-game-dir":
                        RemoveGameDir(ReadString(root, "path"));
                        return;
                    case "set-dir-isolation":
                        SetDirIsolation(ReadString(root, "path"), ReadString(root, "isolation"));
                        return;
                    case "set-active-dir":
                        SetActiveDir(ReadString(root, "path"));
                        return;
                    case "reset-game-dir":
                        ResetGameDir();
                        return;
                    case "open-game-dir":
                    case "open-folder":
                        RunOpen("game-dir", ReadString(root, "id"),
                            () => OpenGameDir(ReadString(root, "path")));
                        return;
                    case "open-instance-dir":
                        RunOpen("instance-dir", ReadString(root, "id"),
                            () => OpenInstanceDir(ReadString(root, "path")));
                        return;
                    case "import-modpack":
                        ImportModpack();
                        return;
                }

                // 自定义主页：打开文件 / 打开文件夹 / 恢复默认
                switch (type.GetString())
                {
                    case "open-custom-home":
                        RunOpen("custom-home", ReadString(root, "id"), OpenCustomHomeFile);
                        return;
                    case "open-custom-home-folder":
                        RunOpen("custom-home-folder", ReadString(root, "id"), OpenCustomHomeFolder);
                        return;
                    case "reset-custom-home":
                        ResetCustomHome();
                        return;
                    case "open-path":
                        // 自定义主页里的「打开文件 / 打开文件夹」事件
                        RunOpen("path", ReadString(root, "id"),
                            () => OpenPath(ReadString(root, "path"), ReadString(root, "base")));
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
                    RunOpen("external", ReadString(root, "id"),
                        () => OpenExternal(urlElement.GetString()));
                    return;
                }

                // 网页那边发现「提权导致打不开」时，可以叫我们以普通权限重开一次
                if (type.GetString() == "restart-as-user")
                {
                    RestartAsStandardUser();
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
            catch (Exception ex)
            {
                // 动作执行中出了意外：回一条 host-error，网页用自己的浮层显示，
                // 不再让它悄悄消失（宿主关掉了 DevTools，吞掉就真的查不到了）
                PostPageMessage("host-error", new Dictionary<string, object?>
                {
                    ["title"] = "启动器内部出错了",
                    ["message"] = ex.Message
                });
            }
        }

        private static ShellLaunchResult OpenExternal(string? url)
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                return ShellLaunchResult.Failure(string.Empty, "没有给出链接");
            }
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return ShellLaunchResult.Failure(url, "只允许打开 http / https 链接");
            }
            return ShellLaunch.OpenUrl(uri.AbsoluteUri);
        }

        /// <summary>
        /// 打开任意路径或命令，供自定义主页的「打开文件 / 打开文件夹 / 下载文件」事件使用。
        /// 相对路径按 Custom.xaml 所在目录解析（和 PCL 一样），环境变量会展开，链接交给默认浏览器。
        /// </summary>
        private static ShellLaunchResult OpenPath(string? raw, string? basePath)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return ShellLaunchResult.Failure(string.Empty, "没有给出要打开的路径");
            }
            string root = string.IsNullOrWhiteSpace(basePath) ? CustomHome.Folder : basePath!;
            return ShellLaunch.Open(raw, root);
        }

        /// <summary>取消息里的字符串字段，类型不对或不存在就返回 null。</summary>
        private static string? ReadString(JsonElement root, string name)
        {
            return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        }

        /// <summary>
        /// 执行一次「打开位置」的动作并把结果回给网页。
        /// 网页带着 id 来，回包原样带回，它据此知道自己等的是哪一次（超时也能对上号）。
        /// 这里兜住所有异常：打开失败只是失败，不该让整条消息通道炸掉。
        /// </summary>
        private void RunOpen(string action, string? id, Func<ShellLaunchResult> run)
        {
            ShellLaunchResult result;
            try
            {
                result = run();
            }
            catch (Exception ex)
            {
                result = ShellLaunchResult.Failure(string.Empty, ex.Message);
            }

            PostPageMessage("open-result", new Dictionary<string, object?>
            {
                ["id"] = id,
                ["action"] = action,
                ["ok"] = result.Ok,
                ["path"] = result.Path,
                ["folder"] = result.Folder,
                ["error"] = result.Error,
                // 提权状态下打不开多半是「Windows 不允许提权进程驱动资源管理器」，
                // 网页据此把提示里的「以普通权限重启」做成能点的按钮
                ["elevated"] = ShellLaunch.IsElevated()
            });
        }

        /// <summary>
        /// 以普通权限重启（默认管理员权限下的逃生门）：新实例起来后关掉当前窗口。
        /// 先回包再退出，让网页有机会把「正在重启」画出来。
        /// </summary>
        private async void RestartAsStandardUser()
        {
            ElevationResult result = Elevation.RestartAsStandardUser();

            PostPageMessage("restart-result", new Dictionary<string, object?>
            {
                ["ok"] = result.Ok,
                ["error"] = result.Error
            });

            if (!result.Ok) return;

            await System.Threading.Tasks.Task.Delay(400);
            Close();
        }

        private void PostPageMessage(string messageType, Dictionary<string, object?> payload)
        {
            try
            {
                var message = new Dictionary<string, object?> { ["type"] = messageType };
                foreach (var pair in payload) message[pair.Key] = pair.Value;
                webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));
            }
            catch (Exception)
            {
                // WebView2 已关闭时忽略
            }
        }

    }
}
