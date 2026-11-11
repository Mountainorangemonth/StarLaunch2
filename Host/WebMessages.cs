/*=====================================================================
   StarLaunch · 宿主消息：网页 → 宿主的指令分发
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
                    OpenWallpaperFolder();
                    return;
                }

                // 版本管理：游戏文件夹的增删与设置（多文件夹，PCL 式）
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
                        OpenGameDir(ReadString(root, "path"));
                        return;
                    case "open-instance-dir":
                        OpenInstanceDir(ReadString(root, "path"));
                        return;
                    case "import-modpack":
                        ImportModpack();
                        return;
                }

                // 自定义主页：打开文件 / 打开文件夹 / 恢复默认
                switch (type.GetString())
                {
                    case "open-custom-home":
                        OpenCustomHomeFile();
                        return;
                    case "open-custom-home-folder":
                        OpenCustomHomeFolder();
                        return;
                    case "reset-custom-home":
                        ResetCustomHome();
                        return;
                    case "open-path":
                        // 自定义主页里的「打开文件 / 打开文件夹」事件
                        OpenPath(ReadString(root, "path"), ReadString(root, "base"));
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

        /// <summary>
        /// 打开任意路径或命令，供自定义主页的「打开文件 / 打开文件夹 / 下载文件」事件使用。
        /// 相对路径按 Custom.xaml 所在目录解析（和 PCL 一样），环境变量会展开。
        /// 链接仍然只允许 http/https。
        /// </summary>
        private void OpenPath(string? raw, string? basePath)
        {
            if (string.IsNullOrWhiteSpace(raw)) return;
            string path = raw!.Trim().Trim('"');

            if (Uri.TryCreate(path, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                OpenExternal(uri.AbsoluteUri);
                return;
            }

            try
            {
                path = Environment.ExpandEnvironmentVariables(path);

                // 相对路径：先看 Custom.xaml 旁边，再退回启动器目录
                if (!Path.IsPathRooted(path))
                {
                    string root = string.IsNullOrWhiteSpace(basePath) ? CustomHome.Folder : basePath!;
                    string candidate = Path.Combine(root, path);
                    if (File.Exists(candidate) || Directory.Exists(candidate))
                    {
                        path = candidate;
                    }
                    else
                    {
                        string fallback = Path.Combine(AppContext.BaseDirectory, path);
                        if (File.Exists(fallback) || Directory.Exists(fallback)) path = fallback;
                    }
                }

                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
            catch
            {
                // 路径不存在或没有关联程序：网页端已经给过提示
            }
        }

        /// <summary>取消息里的字符串字段，类型不对或不存在就返回 null。</summary>
        private static string? ReadString(JsonElement root, string name)
        {
            return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
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
