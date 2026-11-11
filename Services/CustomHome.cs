/*=====================================================================
   StarLaunch · 自定义主页文件（PCL 的 Custom.xaml）
   ---------------------------------------------------------------------
   和 PCL 一样：启动器配置目录里放一个 Custom.xaml，网页端把它渲染成
   首页的自定义内容。文件不存在时自动生成一份模板，用户改完保存即可。

   目录和 StarLaunch.config.json 在一起：
     · 便携版：exe 同级
     · exe 同级不可写：%LOCALAPPDATA%\StarLaunch
   =====================================================================*/
using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;

namespace StarLaunch.Services
{
    internal static class CustomHome
    {
        public const string FileName = "Custom.xaml";

        /// <summary>模板在程序集里的资源名（Resources\Custom.xaml）。</summary>
        private const string TemplateResource = "StarLaunch.Resources.Custom.xaml";

        /// <summary>配置文件所在目录，和 StarLaunch.config.json 同一个地方。</summary>
        public static string Folder => LauncherConfigStore.Folder;

        /// <summary>Custom.xaml 的完整路径。</summary>
        public static string FilePath => Path.Combine(Folder, FileName);

        /// <summary>
        /// 确保 Custom.xaml 存在：没有就写一份模板。
        /// 返回当前路径，写不进去时也照样返回（调用方读文件会拿到错误）。
        /// </summary>
        public static string Ensure()
        {
            string path = FilePath;
            try
            {
                Directory.CreateDirectory(Folder);
                if (!File.Exists(path)) WriteDefault(false);
            }
            catch (Exception)
            {
                // 目录不可写：不阻塞界面，网页端会显示「读取失败」
            }
            return path;
        }

        /// <summary>写入模板内容。overwrite = false 时只在文件不存在时写。</summary>
        public static bool WriteDefault(bool overwrite)
        {
            string path = FilePath;
            try
            {
                Directory.CreateDirectory(Folder);
                if (!overwrite && File.Exists(path)) return true;

                File.WriteAllText(path, LoadTemplate(), new UTF8Encoding(false));
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// 读取 Custom.xaml。编辑器保存的瞬间文件可能被独占，失败时短暂重试几次。
        /// </summary>
        public static bool TryRead(out string text, out string error)
        {
            text = string.Empty;
            error = string.Empty;
            string path = FilePath;

            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    if (!File.Exists(path))
                    {
                        error = "文件不存在：" + path;
                        return false;
                    }
                    text = File.ReadAllText(path, Encoding.UTF8);
                    return true;
                }
                catch (IOException)
                {
                    Thread.Sleep(40);
                }
                catch (UnauthorizedAccessException ex)
                {
                    error = ex.Message;
                    return false;
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                    return false;
                }
            }

            error = "文件被占用，稍后再试";
            return false;
        }

        /// <summary>内嵌的模板文本；资源缺失时退回一段最小可用的内容。</summary>
        private static string LoadTemplate()
        {
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using Stream? stream = asm.GetManifestResourceStream(TemplateResource);
                if (stream != null)
                {
                    using var reader = new StreamReader(stream, Encoding.UTF8);
                    return reader.ReadToEnd();
                }
            }
            catch (Exception)
            {
                // 落到下面的兜底内容
            }

            return
                "<local:MyCard Title=\"自定义主页\" Margin=\"0,0,0,12\">\n" +
                "    <StackPanel Margin=\"16,12,16,14\">\n" +
                "        <TextBlock TextWrapping=\"Wrap\" Text=\"这是 StarLaunch 的自定义主页，直接编辑 Custom.xaml 即可。\" />\n" +
                "    </StackPanel>\n" +
                "</local:MyCard>\n";
        }
    }
}
