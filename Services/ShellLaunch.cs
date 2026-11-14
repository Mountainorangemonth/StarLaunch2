/*=====================================================================
   StarLaunch · 打开文件 / 文件夹 / 链接
   ---------------------------------------------------------------------
   所有「在资源管理器里打开」「用默认程序打开」「在浏览器里打开」都走这里，
   只做一件事：执行，然后把结果（成功 / 为什么失败）原样返回。

   打开文件夹为什么不能只写一句 Process.Start(UseShellExecute = true)：

     · 那条路走的是系统里的「文件夹」ShellExecute 关联。被第三方文件管理器
       接管、或者注册表里那项坏掉时，它会直接抛错；原来的写法 catch 住
       什么都不做，界面表现就是「点了没反应」。

     · 换成为「自己起一个 explorer.exe」同样不行：有些机器上（典型是启动器
       以管理员身份运行，或者 shell 的某个扩展 DLL 初始化失败）新起的
       explorer.exe 会以 0xc0000142 挂在加载器上，弹一个
       「explorer.exe - 应用程序无法正常启动」的系统框 —— 这个框是子进程
       弹的，CreateProcess 早就返回成功了，宿主既拿不到也拦不住。

   所以现在改成「把请求交给已经在跑的那个资源管理器」，不新建进程：
       1. SHParseDisplayName + SHOpenFolderAndSelectItems（shell 自带 API，
          和资源管理器里「在文件夹中显示」是一回事）；
       2. Shell.Application 的 Explore（老式 COM 入口，兜底）；
       3. 系统关联 ShellExecute（最后手段；管理员身份运行时跳过，Windows
          不允许提权进程去驱动资源管理器）。
   三条路都失败时，把每条失败的原因一起返回，网页用自己的浮层显示。

   另外 SuppressSystemErrorDialogs() 会把这类「加载器弹框」关掉：出了错由
   我们自己的界面说，不要弹一个用户看不懂的系统框。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace StarLaunch.Services
{
    /// <summary>一次打开动作的结果：成功与否、最终用的路径、失败原因。</summary>
    internal readonly struct ShellLaunchResult
    {
        public bool Ok { get; init; }

        /// <summary>真正去打开的那个路径（相对路径已经解析过）。</summary>
        public string Path { get; init; }

        /// <summary>目标是文件夹时为 true，网页据此换措辞。</summary>
        public bool Folder { get; init; }

        /// <summary>失败原因，含 Win32 错误码 / HRESULT；成功时为 null。</summary>
        public string? Error { get; init; }

        public static ShellLaunchResult Success(string path, bool folder)
        {
            return new ShellLaunchResult { Ok = true, Path = path, Folder = folder };
        }

        public static ShellLaunchResult Failure(string? path, string error)
        {
            return new ShellLaunchResult { Ok = false, Path = path ?? string.Empty, Error = error };
        }
    }

    internal static class ShellLaunch
    {
        /* ── Win32：shell 浏览 + 错误框抑制 + 提权判断 ───────────────── */

        private const uint SemFailCriticalErrors = 0x0001;
        private const uint SemNoOpenFileErrorBox = 0x8000;

        [DllImport("kernel32.dll")]
        private static extern uint SetErrorMode(uint mode);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHParseDisplayName(
            string name, IntPtr bindingContext, out IntPtr pidl, uint attributesIn, out uint attributesOut);

        [DllImport("shell32.dll")]
        private static extern int SHOpenFolderAndSelectItems(
            IntPtr folderPidl, uint count, IntPtr itemPidls, uint flags);

        [DllImport("shell32.dll")]
        private static extern void ILFree(IntPtr pidl);

        /// <summary>
        /// 关掉「应用程序无法正常启动」「找不到文件」这类系统错误框。
        /// 子进程会继承这个设置，所以我们起的进程出错时不会弹系统框，
        /// 而是走自己的返回值 → 网页浮层。启动时调一次即可。
        /// </summary>
        public static void SuppressSystemErrorDialogs()
        {
            try
            {
                SetErrorMode(SemFailCriticalErrors | SemNoOpenFileErrorBox);
            }
            catch (Exception)
            {
                // 老系统上没有这个 API 也不影响其它功能
            }
        }

        /// <summary>当前进程是不是以管理员身份在跑（提权后不能再驱动资源管理器）。</summary>
        public static bool IsElevated()
        {
            // 判断逻辑收在 Services\Elevation.cs 里，那边还要用同一个判断决定能不能降权重启
            return Elevation.IsElevated();
        }

        /* ── 打开 ──────────────────────────────────────────────────── */

        /// <summary>
        /// 打开任意路径或链接。相对路径按 baseDirectory 解析（默认用启动器配置目录），
        /// 环境变量会展开；http / https 交给默认浏览器。
        /// </summary>
        public static ShellLaunchResult Open(string? raw, string? baseDirectory = null)
        {
            string target = Clean(raw);
            if (target.Length == 0) return ShellLaunchResult.Failure(string.Empty, "没有给出要打开的路径");

            if (Uri.TryCreate(target, UriKind.Absolute, out var uri))
            {
                if (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
                {
                    return OpenUrl(uri.AbsoluteUri);
                }
                // file:///C:/... 这种写法和直接给路径当同一件事处理
                if (uri.IsFile) target = uri.LocalPath;
            }

            string path = Expand(target, baseDirectory);

            if (Directory.Exists(path)) return OpenFolder(path);
            if (File.Exists(path)) return OpenFile(path);

            return ShellLaunchResult.Failure(path, "找不到这个位置，文件可能已被移动或删除");
        }

        /// <summary>
        /// 只开文件夹，按「先交给已经在跑的资源管理器、再考虑新建进程」的顺序试。
        /// 每条失败的原因都会带回网页，出问题时不用再猜。
        /// </summary>
        public static ShellLaunchResult OpenFolder(string? raw)
        {
            string path = Expand(Clean(raw), null);
            if (path.Length == 0) return ShellLaunchResult.Failure(string.Empty, "没有给出要打开的文件夹");
            if (!Directory.Exists(path))
            {
                return ShellLaunchResult.Failure(path, "文件夹不存在，可能已被移动、删除或还在另一个磁盘上");
            }

            var problems = new List<string>();

            // 1. shell 原生：在已经跑着的资源管理器里打开 / 定位，不新建进程
            string? browserError = BrowseInShell(path);
            if (browserError == null) return ShellLaunchResult.Success(path, true);
            problems.Add("资源管理器定位：" + browserError);

            // 2. 老式 COM 入口，同样是交给现有 shell
            string? comError = ExploreWithShellApplication(path);
            if (comError == null) return ShellLaunchResult.Success(path, true);
            problems.Add("Shell.Application：" + comError);

            // 3. 系统关联（最后手段）。提权进程走这条路必然失败，还会弹系统框，直接跳过
            if (IsElevated())
            {
                problems.Add("启动器当前以管理员身份运行，已跳过 explorer.exe 这条路" +
                    "（Windows 不允许提权进程再去驱动资源管理器）");
            }
            else
            {
                string? assocError = ShellExecute(path);
                if (assocError == null) return ShellLaunchResult.Success(path, true);
                problems.Add("系统关联：" + assocError);
            }

            string detail = string.Join("；", problems);
            if (IsElevated())
            {
                return ShellLaunchResult.Failure(path,
                    "启动器是以管理员身份运行的，Windows 不允许提权进程再去驱动资源管理器，" +
                    "所以文件夹打不开。用普通权限重新启动 StarLaunch 就能恢复。\n\n" + detail);
            }
            return ShellLaunchResult.Failure(path, detail);
        }

        /// <summary>用系统默认程序打开一个文件。</summary>
        public static ShellLaunchResult OpenFile(string? raw)
        {
            string path = Expand(Clean(raw), null);
            if (path.Length == 0) return ShellLaunchResult.Failure(string.Empty, "没有给出要打开的文件");
            if (!File.Exists(path))
            {
                return ShellLaunchResult.Failure(path, "文件不存在，可能已被移动或删除");
            }

            string? error = ShellExecute(path);
            if (error == null) return ShellLaunchResult.Success(path, false);
            return ShellLaunchResult.Failure(path, "没有能打开这种文件的程序：" + error);
        }

        /// <summary>在默认浏览器里打开链接。</summary>
        public static ShellLaunchResult OpenUrl(string? url)
        {
            string target = (url ?? string.Empty).Trim();
            if (target.Length == 0) return ShellLaunchResult.Failure(string.Empty, "没有给出链接");

            string? error = ShellExecute(target);
            if (error == null) return ShellLaunchResult.Success(target, false);
            return ShellLaunchResult.Failure(target, "没有可用的默认浏览器：" + error);
        }

        /* ── 三种打开方式，返回 null 表示这一步成功 ────────────────── */

        private static string? BrowseInShell(string path)
        {
            IntPtr pidl = IntPtr.Zero;
            try
            {
                int hr = SHParseDisplayName(path, IntPtr.Zero, out pidl, 0, out _);
                if (hr != 0 || pidl == IntPtr.Zero)
                {
                    return "解析路径失败（0x" + hr.ToString("X8") + "）";
                }

                int opened = SHOpenFolderAndSelectItems(pidl, 0, IntPtr.Zero, 0);
                if (opened != 0) return "打开失败（0x" + opened.ToString("X8") + "）";
                return null;
            }
            catch (Exception ex)
            {
                return Describe(ex);
            }
            finally
            {
                if (pidl != IntPtr.Zero)
                {
                    try { ILFree(pidl); } catch (Exception) { /* 释放失败无所谓 */ }
                }
            }
        }

        private static string? ExploreWithShellApplication(string path)
        {
            object? shell = null;
            try
            {
                Type? type = Type.GetTypeFromProgID("Shell.Application");
                if (type == null) return "找不到 Shell.Application（系统没有注册它）";

                shell = Activator.CreateInstance(type);
                if (shell == null) return "创建 Shell.Application 失败";

                type.InvokeMember("Explore", BindingFlags.InvokeMethod, null, shell, new object[] { path });
                return null;
            }
            catch (Exception ex)
            {
                return Describe(ex);
            }
            finally
            {
                if (shell != null)
                {
                    try { Marshal.ReleaseComObject(shell); } catch (Exception) { /* 已经释放 */ }
                }
            }
        }

        private static string? ShellExecute(string target)
        {
            try
            {
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
                return null;
            }
            catch (Exception ex)
            {
                return Describe(ex);
            }
        }

        /* ── 工具 ──────────────────────────────────────────────────── */

        /// <summary>去空白、去成对引号。</summary>
        private static string Clean(string? raw)
        {
            return (raw ?? string.Empty).Trim().Trim('"').Trim();
        }

        /// <summary>展开环境变量；相对路径先看 baseDirectory，再退回启动器目录。</summary>
        private static string Expand(string raw, string? baseDirectory)
        {
            if (raw.Length == 0) return raw;

            string path = raw;
            try
            {
                path = Environment.ExpandEnvironmentVariables(path);
            }
            catch (ArgumentException)
            {
                // 变量名写坏了（比如没闭合的 %），按原样用，让后面的存在性检查去报错
            }

            if (path.Length == 0 || Path.IsPathRooted(path)) return path;

            string root = string.IsNullOrWhiteSpace(baseDirectory)
                ? LauncherConfigStore.Folder
                : baseDirectory!;

            string candidate = Path.Combine(root, path);
            if (File.Exists(candidate) || Directory.Exists(candidate)) return candidate;

            string fallback = Path.Combine(AppContext.BaseDirectory, path);
            if (File.Exists(fallback) || Directory.Exists(fallback)) return fallback;

            // 都不存在：返回第一个候选，报错信息里的路径才有意义
            return candidate;
        }

        private static string Describe(Exception ex)
        {
            if (ex is Win32Exception win32)
            {
                return win32.Message + "（Win32 " + win32.NativeErrorCode + "）";
            }
            return ex.Message;
        }
    }
}
