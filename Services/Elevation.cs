/*=====================================================================
   StarLaunch · 提权状态判断 + 以普通权限重启
   ---------------------------------------------------------------------
   从 2026-11-14 起启动器默认以管理员身份运行（app.manifest 里
   requestedExecutionLevel = requireAdministrator）。这带来两个麻烦，
   这个文件就是拿来兜住的：

     · 提权后的进程不能再驱动资源管理器 —— 见 ShellLaunch.OpenFolder，
       那边会跳过 explorer.exe 那条路，并把原因带回网页。

     · WebView2 的内核进程永远跑在普通权限下。在打开了「管理员保护」
       （Administrator Protection）的系统上，提权后的用户和原来的用户
       根本不是同一个，网页内核读不到用户数据目录就会初始化失败，
       表现是白屏或者「无法初始化内嵌浏览器」。这时候唯一的出路是
       以普通权限重新启动自己 —— 就是 RestartAsStandardUser()。

   为什么不能直接 Process.Start 自己（或者 explorer.exe 拉自己）：
   exe 的清单写着 requireAdministrator，任何走 ShellExecute 的启动
   都会被 AppInfo 再提权一次，等于原地打转。真正的降权只能用
   CreateProcessAsUser / CreateProcessWithTokenW 拿「链接令牌」
   （TokenLinkedToken，也就是提权前的那个普通用户令牌）去开新进程，
   这条路不经过 AppInfo，不会弹 UAC。

   注意：Windows 在 CreateProcess 这一层也会检查「目标 exe 的清单要求
   提权、而给的令牌没提权」，这种情况会直接返回 740（请求的操作需要
   提升），所以这条降权路在有些系统上走不通。走不通时把原因原样带回
   界面，唯一可靠的出路是把 app.manifest 改成 asInvoker 再跑。
   =====================================================================*/
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace StarLaunch.Services
{
    /// <summary>一次「重启」尝试的结果。</summary>
    internal readonly struct ElevationResult
    {
        public bool Ok { get; init; }

        /// <summary>失败原因（含 Win32 错误码），成功时为 null。</summary>
        public string? Error { get; init; }

        public static ElevationResult Success() => new ElevationResult { Ok = true };

        public static ElevationResult Failure(string error) => new ElevationResult { Ok = false, Error = error };
    }

    internal static class Elevation
    {
        /* ── Win32 ─────────────────────────────────────────────────── */

        private const uint TokenQuery = 0x0008;
        private const uint SePrivilegeEnabled = 0x00000002;

        private const int TokenElevation = 20;
        private const int TokenLinkedToken = 19;

        private const uint CreateUnicodeEnvironment = 0x00000400;
        private const uint LogonWithProfile = 0x00000001;

        private const string SeAssignPrimaryToken = "SeAssignPrimaryTokenPrivilege";
        private const string SeIncreaseQuota = "SeIncreaseQuotaPrivilege";
        private const string SeImpersonate = "SeImpersonatePrivilege";

        [StructLayout(LayoutKind.Sequential)]
        private struct Luid
        {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TokenPrivileges
        {
            public uint Count;
            public Luid Luid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public int Size;
            public string? Reserved;
            public string? Desktop;
            public string? Title;
            public int X;
            public int Y;
            public int XSize;
            public int YSize;
            public int XCountChars;
            public int YCountChars;
            public int FillAttribute;
            public int Flags;
            public short ShowWindow;
            public short Reserved2;
            public IntPtr Reserved2Ptr;
            public IntPtr StdInput;
            public IntPtr StdOutput;
            public IntPtr StdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr Process;
            public IntPtr Thread;
            public int ProcessId;
            public int ThreadId;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetTokenInformation(
            IntPtr token, int infoClass, IntPtr buffer, int length, out int returned);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr token, bool disableAll, ref TokenPrivileges newState, int bufferLength,
            IntPtr previousState, IntPtr returnLength);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessAsUser(
            IntPtr token, string? applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
            uint creationFlags, IntPtr environment, string? currentDirectory,
            ref StartupInfo startupInfo, out ProcessInformation processInformation);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessWithTokenW(
            IntPtr token, uint logonFlags, string? applicationName, StringBuilder commandLine,
            uint creationFlags, IntPtr environment, string? currentDirectory,
            ref StartupInfo startupInfo, out ProcessInformation processInformation);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

        [DllImport("userenv.dll", SetLastError = true)]
        private static extern bool DestroyEnvironmentBlock(IntPtr environment);

        /* ── 状态 ─────────────────────────────────────────────────── */

        /// <summary>当前进程是不是以管理员身份在跑。</summary>
        public static bool IsElevated()
        {
            IntPtr token = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(GetCurrentProcess(), TokenQuery, out token)) return false;

                IntPtr buffer = Marshal.AllocHGlobal(sizeof(int));
                try
                {
                    if (!GetTokenInformation(token, TokenElevation, buffer, sizeof(int), out _)) return false;
                    return Marshal.ReadInt32(buffer) != 0;
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                if (token != IntPtr.Zero) CloseHandle(token);
            }
        }

        /* ── 降权重启 ──────────────────────────────────────────────── */

        /// <summary>
        /// 以普通（未提权）权限重新启动自己，成功后调用方应该关掉当前进程。
        /// 取的是当前令牌的「链接令牌」，也就是 UAC 之前那个用户令牌。
        /// </summary>
        public static ElevationResult RestartAsStandardUser()
        {
            if (!IsElevated()) return ElevationResult.Failure("当前本来就是普通权限，不需要降权。");

            string? exePath = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exePath))
            {
                return ElevationResult.Failure("取不到启动器自己的路径（Environment.ProcessPath 为空）。");
            }

            IntPtr currentToken = IntPtr.Zero;
            IntPtr linkedToken = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(GetCurrentProcess(), TokenQuery, out currentToken))
                {
                    return ElevationResult.Failure("打开自己的访问令牌失败：" + LastError());
                }

                linkedToken = GetLinkedToken(currentToken);
                if (linkedToken == IntPtr.Zero)
                {
                    return ElevationResult.Failure(
                        "拿不到普通权限的令牌（链接令牌不存在）。这台机器可能关掉了 UAC，" +
                        "管理员就是唯一身份，没法降权运行。");
                }

                // CreateProcessAsUser 需要 SeAssignPrimaryToken / SeIncreaseQuota，
                // 提权令牌上这两个权限默认是关的，先打开
                EnablePrivilege(currentToken, SeAssignPrimaryToken);
                EnablePrivilege(currentToken, SeIncreaseQuota);
                EnablePrivilege(currentToken, SeImpersonate);

                // 环境块按普通用户重新生成：管理员保护下提权进程属于另一个用户，
                // 直接继承环境变量会把 %USERPROFILE% 之类的指到管理员那边去。
                if (!CreateEnvironmentBlock(out environment, linkedToken, false)) environment = IntPtr.Zero;

                var startup = new StartupInfo
                {
                    Size = Marshal.SizeOf<StartupInfo>(),
                    Desktop = "winsta0\\default"
                };

                // 命令行：exe 路径带引号，后面接上这次的参数（跳过 argv[0]）
                var commandLine = new StringBuilder(BuildCommandLine(exePath));
                bool started = CreateProcessAsUser(
                    linkedToken, null, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                    CreateUnicodeEnvironment, environment, AppContext.BaseDirectory,
                    ref startup, out var process);
                string asUserError = started ? string.Empty : LastError();

                if (!started)
                {
                    // 权限可能没开成功，再来一次（两次都失败时错误码以第二次为准）
                    commandLine = new StringBuilder(BuildCommandLine(exePath));
                    started = CreateProcessAsUser(
                        linkedToken, null, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                        CreateUnicodeEnvironment, environment, AppContext.BaseDirectory,
                        ref startup, out process);
                    if (!started) asUserError = LastError();
                }

                // 第三种方式：只需要 SeImpersonate，权限上更容易过
                string withTokenError = string.Empty;
                if (!started)
                {
                    commandLine = new StringBuilder(BuildCommandLine(exePath));
                    started = CreateProcessWithTokenW(
                        linkedToken, LogonWithProfile, null, commandLine,
                        CreateUnicodeEnvironment, environment, AppContext.BaseDirectory,
                        ref startup, out process);
                    if (!started) withTokenError = LastError();
                }

                if (!started)
                {
                    return ElevationResult.Failure(
                        "以普通权限启动新实例失败。\nCreateProcessAsUser：" + asUserError +
                        "\nCreateProcessWithTokenW：" + withTokenError);
                }

                CloseHandle(process.Thread);
                CloseHandle(process.Process);
                return ElevationResult.Success();
            }
            catch (Exception ex)
            {
                return ElevationResult.Failure("以普通权限启动新实例时出错：" + ex.Message);
            }
            finally
            {
                if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
                if (linkedToken != IntPtr.Zero) CloseHandle(linkedToken);
                if (currentToken != IntPtr.Zero) CloseHandle(currentToken);
            }
        }

        /// <summary>取当前令牌的链接令牌（提权前的那个）；失败返回 Zero。</summary>
        private static IntPtr GetLinkedToken(IntPtr token)
        {
            IntPtr buffer = Marshal.AllocHGlobal(IntPtr.Size);
            try
            {
                if (!GetTokenInformation(token, TokenLinkedToken, buffer, IntPtr.Size, out _)) return IntPtr.Zero;
                return Marshal.ReadIntPtr(buffer);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        /// <summary>打开当前令牌上的一个权限。失败不抛异常，只是这条路走不通。</summary>
        private static void EnablePrivilege(IntPtr token, string name)
        {
            try
            {
                if (!LookupPrivilegeValue(null, name, out var luid)) return;

                var state = new TokenPrivileges
                {
                    Count = 1,
                    Luid = luid,
                    Attributes = SePrivilegeEnabled
                };

                AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero);
            }
            catch (Exception)
            {
                // 拿不到这个权限就算了，调用方还有第二种方式
            }
        }

        /// <summary>拼出完整的命令行：exe 带引号 + 原样保留本次启动的参数。</summary>
        private static string BuildCommandLine(string exePath)
        {
            var line = new StringBuilder();
            line.Append('"').Append(exePath).Append('"');

            string[] args = Environment.GetCommandLineArgs();
            for (int i = 1; i < args.Length; i++)
            {
                line.Append(' ');

                string arg = args[i] ?? string.Empty;
                // 已经是带引号的（比如网页传来的路径）就不再套一层
                if (arg.Contains(' ') && !arg.StartsWith("\"", StringComparison.Ordinal))
                {
                    line.Append('"').Append(arg.Replace("\"", "\\\"")).Append('"');
                }
                else
                {
                    line.Append(arg);
                }
            }

            return line.ToString();
        }

        private static string LastError()
        {
            // 必须用 Marshal.GetLastWin32Error()：P/Invoke 声明了 SetLastError=true，
            // 错误码由运行时缓存，再调一次 kernel32!GetLastError 未必还读得到。
            int code = Marshal.GetLastWin32Error();
            string message;
            try
            {
                message = new Win32Exception(code).Message;
            }
            catch (Exception)
            {
                message = "未知错误";
            }
            return message + "（Win32 " + code + "）";
        }
    }
}
