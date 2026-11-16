/*=====================================================================
   StarLaunch · 内存优化
   ---------------------------------------------------------------------
   清理动作移植自用户提供的 library.c（Idle-Aware Memory Optimization）：
   核心思路是「只压真正空闲的进程」，不去动正在跑的游戏 / 播放器 / 编译器。

     1. 打开 SeProfileSingleProcess / SeIncreaseQuota 特权；
     2. 把系统文件缓存钳到 64~256 MB（SetSystemFileCacheSize）；
     3. 清待机列表（NtSetSystemInformation + 0x50）：这些是缓存起来的
        干净页，收走不会影响任何进程的工作集；
     4. 采一轮所有进程的 CPU 时间 → 等 600ms → 再采一轮。只有这段时间
        CPU 时间「一点都没涨」的进程才算空闲，才 EmptyWorkingSet 压工作集。
        前台窗口进程和启动器自己永远跳过。

   和 C 版的差异（都是有意为之）：
     · 不自杀式提权重启 —— 启动器清单里已经是 requireAdministrator，
       普通权限下跑时哪一步失败就在明细里说明，不重开进程；
     · 读不到 CPU 时间的进程（受保护的系统进程）直接跳过，而不是当成空闲；
     · 前台进程在「等待 600ms」之后再判断一次，用户刚切过去的窗口不会被压。

   入口不变：主页「内存优化」→ `memory-optimize` → MainWindow.OptimizeMemory()
   → MemoryOptimizer.OptimizeAsync() → `memory-result`。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>一次内存优化的结果，字段名和网页端一一对应（ToView 转小驼峰）。</summary>
    internal sealed class MemoryOptimizeResult
    {
        public bool Ok { get; set; } = true;

        /// <summary>失败原因；Ok 为真时是 null。</summary>
        public string? Error { get; set; }

        /// <summary>清理还没实现（历史字段，Cleanup 已经填好，正常永远是 false）。</summary>
        public bool Pending { get; set; }

        /// <summary>物理内存总量 / 清理前后可用量，都是字节。</summary>
        public long TotalBytes { get; set; }
        public long BeforeAvailable { get; set; }
        public long AfterAvailable { get; set; }

        /// <summary>压了工作集的进程数。</summary>
        public int Processes { get; set; }

        /// <summary>一句话明细：清了几项、跳过多少、为什么。</summary>
        public string? Detail { get; set; }

        public long ElapsedMs { get; set; }
        public bool Elevated { get; set; }

        /// <summary>释放的物理内存（字节）；变少了也不算负数。</summary>
        public long Freed => Math.Max(0, AfterAvailable - BeforeAvailable);

        public Dictionary<string, object?> ToView()
        {
            return new Dictionary<string, object?>
            {
                ["ok"] = Ok,
                ["error"] = Error,
                ["pending"] = Pending,
                ["totalBytes"] = TotalBytes,
                ["beforeBytes"] = BeforeAvailable,
                ["afterBytes"] = AfterAvailable,
                ["freedBytes"] = Freed,
                ["processes"] = Processes,
                ["detail"] = Detail,
                ["elapsedMs"] = ElapsedMs,
                ["elevated"] = Elevated
            };
        }
    }

    /// <summary>Cleanup 的明细，用来拼「明细」那句话。</summary>
    internal sealed class MemoryCleanupReport
    {
        public int Trimmed { get; set; }
        public int Idle { get; set; }
        public int Active { get; set; }
        public bool FileCacheLimited { get; set; }
        public bool StandbyPurged { get; set; }
    }

    internal static class MemoryOptimizer
    {
        /// <summary>后台跑一次内存优化。不会抛出业务异常，失败原因放在结果里。</summary>
        public static Task<MemoryOptimizeResult> OptimizeAsync(CancellationToken token)
        {
            return Task.Run(() => Optimize(token), token);
        }

        /// <summary>当前物理内存总量 / 可用量（字节）。读不到时返回 false，界面退回保守值。</summary>
        public static bool TryReadMemory(out long total, out long available)
        {
            total = 0;
            available = 0;
            if (!MemoryStatus.TryRead(out var status)) return false;
            total = status.Total;
            available = status.Available;
            return true;
        }

        /// <summary>
        /// 还能提交多少内存（物理 + 页面文件）。JVM 申请堆内存时看的是这个额度，
        /// 不是「还剩多少物理内存」——页面文件被吃完时，物理内存再空也起不来 Java。
        /// </summary>
        public static bool TryReadCommit(out long availableCommit, out long commitLimit)
        {
            availableCommit = 0;
            commitLimit = 0;
            if (!MemoryStatus.TryRead(out var status)) return false;
            availableCommit = status.CommitAvailable;
            commitLimit = status.CommitLimit;
            return true;
        }

        private static MemoryOptimizeResult Optimize(CancellationToken token)
        {
            var watch = Stopwatch.StartNew();
            var result = new MemoryOptimizeResult { Elevated = Elevation.IsElevated() };

            if (!MemoryStatus.TryRead(out var before))
            {
                watch.Stop();
                result.Ok = false;
                result.Error = "读不到系统内存状态（GlobalMemoryStatusEx 失败）";
                result.ElapsedMs = watch.ElapsedMilliseconds;
                return result;
            }

            result.TotalBytes = before.Total;
            result.BeforeAvailable = before.Available;

            try
            {
                var report = Cleanup(token);
                result.Processes = report.Trimmed;
                result.Detail = Describe(report, result.Elevated);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                result.Ok = false;
                result.Error = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message;
            }

            token.ThrowIfCancellationRequested();

            // 系统统计有延迟，等一拍再读，不然「释放量」永远是 0
            Thread.Sleep(240);

            if (MemoryStatus.TryRead(out var after))
            {
                result.TotalBytes = after.Total;
                result.AfterAvailable = after.Available;
            }
            else
            {
                result.AfterAvailable = result.BeforeAvailable;
                result.Ok = false;
                if (string.IsNullOrEmpty(result.Error)) result.Error = "读不到清理后的内存状态";
            }

            watch.Stop();
            result.ElapsedMs = watch.ElapsedMilliseconds;
            return result;
        }

        private static string Describe(MemoryCleanupReport report, bool elevated)
        {
            var parts = new List<string>(4);

            if (report.FileCacheLimited) parts.Add("已限制系统文件缓存");
            if (report.StandbyPurged) parts.Add("已清空待机列表");

            if (report.Idle == 0)
            {
                parts.Add("没有发现空闲进程（都在用 CPU），没有压缩任何工作集");
            }
            else
            {
                parts.Add("压缩了 " + report.Trimmed + " / " + report.Idle + " 个空闲进程的工作集");
            }

            if (report.Active > 0) parts.Add("跳过 " + report.Active + " 个正在用 CPU 的进程");
            if (!elevated) parts.Add("当前不是管理员权限，清理待机列表和文件缓存可能没生效");

            return string.Join("；", parts);
        }

        /* -----------------------------------------------------------------
           真正干活的地方
           ----------------------------------------------------------------- */

        private static MemoryCleanupReport Cleanup(CancellationToken token)
        {
            var report = new MemoryCleanupReport();

            // 两项特权都是「有更好，没有也能跑一半」，失败不当作错误
            EnablePrivilege(SeProfileSingleProcess);
            EnablePrivilege(SeIncreaseQuota);

            token.ThrowIfCancellationRequested();
            report.FileCacheLimited = LimitFileCache();

            token.ThrowIfCancellationRequested();
            report.StandbyPurged = PurgeMemoryList(MemoryPurgeStandbyList);
            PurgeMemoryList(MemoryPurgeLowPriorityStandbyList);
            PurgeMemoryList(MemoryFlushModifiedList);

            token.ThrowIfCancellationRequested();
            TrimIdleProcesses(report, token);

            return report;
        }

        /// <summary>
        /// 空闲感知的工作集压缩：先记下每个进程的内核+用户 CPU 时间，
        /// 等 600ms 再读一次，只有完全没变的才处理。
        /// </summary>
        private static void TrimIdleProcesses(MemoryCleanupReport report, CancellationToken token)
        {
            int self = Environment.ProcessId;
            var samples = new List<(int Pid, IntPtr Handle, ulong Cpu)>(512);

            foreach (int pid in EnumerateProcessIds())
            {
                if (pid <= 0 || pid == self) continue;

                IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
                if (handle == IntPtr.Zero) continue;

                ulong cpu = ProcessCpuTime(handle);
                if (cpu == 0)
                {
                    // 读不到 CPU 时间就没法判断它闲不闲，宁可不碰
                    CloseHandle(handle);
                    continue;
                }
                samples.Add((pid, handle, cpu));
            }

            try
            {
                Thread.Sleep(IdleSampleMs);

                int foreground = ForegroundProcessId();
                foreach (var sample in samples)
                {
                    token.ThrowIfCancellationRequested();

                    // 前台窗口永远不碰（用户可能刚切过去）
                    if (sample.Pid == foreground)
                    {
                        report.Active += 1;
                        continue;
                    }

                    ulong now = ProcessCpuTime(sample.Handle);
                    if (now != sample.Cpu)
                    {
                        report.Active += 1;
                        continue;
                    }

                    report.Idle += 1;
                    if (TrimProcess(sample.Pid)) report.Trimmed += 1;
                }
            }
            finally
            {
                foreach (var sample in samples) CloseHandle(sample.Handle);
            }
        }

        private static List<int> EnumerateProcessIds()
        {
            var ids = new List<int>(512);
            try
            {
                foreach (var process in Process.GetProcesses())
                {
                    try
                    {
                        ids.Add(process.Id);
                    }
                    catch (Exception)
                    {
                        // 进程刚好退出
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            catch (Exception)
            {
                // 枚举失败：返回已经拿到的部分
            }
            return ids;
        }

        /// <summary>压一个进程的工作集：优先 EmptyWorkingSet，失败再退 SetProcessWorkingSetSize(-1,-1)。</summary>
        private static bool TrimProcess(int pid)
        {
            IntPtr handle = OpenProcess(ProcessQueryInformation | ProcessSetQuota, false, pid);
            if (handle == IntPtr.Zero)
            {
                handle = OpenProcess(ProcessQueryLimitedInformation | ProcessSetQuota, false, pid);
            }
            if (handle == IntPtr.Zero) return false;

            try
            {
                if (EmptyWorkingSet(handle)) return true;
                return SetProcessWorkingSetSize(handle, new IntPtr(-1), new IntPtr(-1));
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        private static ulong ProcessCpuTime(IntPtr handle)
        {
            if (!GetProcessTimes(handle, out var created, out var exited, out var kernel, out var user))
            {
                return 0;
            }
            return kernel.ToUInt64() + user.ToUInt64();
        }

        private static int ForegroundProcessId()
        {
            IntPtr window = GetForegroundWindow();
            if (window == IntPtr.Zero) return 0;
            GetWindowThreadProcessId(window, out uint pid);
            return (int)pid;
        }

        /// <summary>把系统文件缓存钳到 64~256 MB；失败就退回「系统自己管」。</summary>
        private static bool LimitFileCache()
        {
            if (!EnablePrivilege(SeIncreaseQuota)) return false;

            if (SetSystemFileCacheSize(new IntPtr(MinFileCache), new IntPtr(MaxFileCache), 0)) return true;
            return SetSystemFileCacheSize(new IntPtr(-1), new IntPtr(-1), 0);
        }

        /// <summary>直接问内核要一次内存列表操作（清待机列表 / 刷已修改页）。</summary>
        private static bool PurgeMemoryList(int command)
        {
            IntPtr buffer = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                Marshal.WriteInt32(buffer, command);
                return NtSetSystemInformation(SystemMemoryListInformation, buffer, sizeof(int)) == 0;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        /// <summary>
        /// 给当前进程打开一项特权。返回 false 只说明「没拿到」——
        /// 普通权限下这两项本来就拿不到，调用方据此在明细里提示一句。
        /// </summary>
        private static bool EnablePrivilege(string name)
        {
            IntPtr token = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(GetCurrentProcess(), TokenAdjustPrivileges | TokenQuery, out token))
                {
                    return false;
                }
                if (!LookupPrivilegeValue(null, name, out var luid)) return false;

                var state = new TokenPrivileges
                {
                    Count = 1,
                    Luid = luid,
                    Attributes = SePrivilegeEnabled
                };

                bool ok = AdjustTokenPrivileges(
                    token, false, ref state, Marshal.SizeOf<TokenPrivileges>(), IntPtr.Zero, IntPtr.Zero);
                // AdjustTokenPrivileges 成功但一项都没生效时会返回 true + ERROR_NOT_ALL_ASSIGNED
                return ok && Marshal.GetLastWin32Error() == 0;
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

        /* -----------------------------------------------------------------
           Win32
           ----------------------------------------------------------------- */

        private const uint TokenAdjustPrivileges = 0x0020;
        private const uint TokenQuery = 0x0008;
        private const uint SePrivilegeEnabled = 0x00000002;

        private const string SeProfileSingleProcess = "SeProfileSingleProcessPrivilege";
        private const string SeIncreaseQuota = "SeIncreaseQuotaPrivilege";

        private const uint ProcessQueryInformation = 0x0400;
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const uint ProcessSetQuota = 0x0100;

        private const int SystemMemoryListInformation = 0x50;
        private const int MemoryFlushModifiedList = 3;
        private const int MemoryPurgeStandbyList = 4;
        private const int MemoryPurgeLowPriorityStandbyList = 5;

        /// <summary>两次 CPU 采样的间隔：太短分不出空闲，太长用户等不及。</summary>
        private const int IdleSampleMs = 600;

        private const long MinFileCache = 64L * 1024 * 1024;
        private const long MaxFileCache = 256L * 1024 * 1024;

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

        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime
        {
            public uint Low;
            public uint High;

            public ulong ToUInt64() => ((ulong)High << 32) | Low;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr token, bool disableAll, ref TokenPrivileges newState, int bufferLength,
            IntPtr previousState, IntPtr returnLength);

        [DllImport("psapi.dll", SetLastError = true)]
        private static extern bool EmptyWorkingSet(IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr min, IntPtr max);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetProcessTimes(
            IntPtr hProcess, out FileTime created, out FileTime exited,
            out FileTime kernel, out FileTime user);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetSystemFileCacheSize(IntPtr minimum, IntPtr maximum, uint flags);

        [DllImport("ntdll.dll")]
        private static extern int NtSetSystemInformation(int infoClass, IntPtr info, int length);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        /// <summary>进程工作集 / 可用内存的读数（GlobalMemoryStatusEx 包一层）。</summary>
        private struct MemoryStatus
        {
            public long Total;
            public long Available;

            /// <summary>提交额度（物理 + 页面文件）。JVM 起不来的真正瓶颈通常在这里。</summary>
            public long CommitLimit;
            public long CommitAvailable;

            public static bool TryRead(out MemoryStatus status)
            {
                status = default;
                var native = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
                if (!GlobalMemoryStatusEx(ref native)) return false;

                status.Total = (long)native.TotalPhys;
                status.Available = (long)native.AvailPhys;
                status.CommitLimit = (long)native.TotalPageFile;
                status.CommitAvailable = (long)native.AvailPageFile;
                return true;
            }

            [StructLayout(LayoutKind.Sequential)]
            private struct MemoryStatusEx
            {
                public uint Length;
                public uint MemoryLoad;
                public ulong TotalPhys;
                public ulong AvailPhys;
                public ulong TotalPageFile;
                public ulong AvailPageFile;
                public ulong TotalVirtual;
                public ulong AvailVirtual;
                public ulong AvailExtendedVirtual;
            }

            [DllImport("kernel32.dll", SetLastError = true)]
            private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);
        }
    }
}
