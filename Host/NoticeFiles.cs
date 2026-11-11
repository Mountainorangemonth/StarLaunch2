/*=====================================================================
   StarLaunch · 公告文件：选择 / 读取 .md / .xaml
   ---------------------------------------------------------------------
   从 MainWindow.xaml.cs 拆出来的 partial，字段和事件都在主文件里。
   =====================================================================*/
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace StarLaunch
{
    public partial class MainWindow
    {

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

    }
}
