/*=====================================================================
   StarLaunch · 资源文件的启用 / 禁用 / 删除
   ---------------------------------------------------------------------
   Mod 管理、材质包管理、光影管理共用这一套动作：

     · 启用 / 禁用 = 改文件名：foo.jar ⇄ foo.jar.disabled
       （材质包和光影是 foo.zip ⇄ foo.zip.disabled，和 PCL / HMCL 一致，
        游戏只会读原后缀，加 .disabled 就等于停用，随时能改回来）

     · 删除 = 丢进回收站，不走 File.Delete。
       模组动辄几百 MB，误删了还想去网上重新下是很难受的事；回收站里
       躺一会儿的成本远低于重新下载。SHFileOperation 带 FOF_ALLOWUNDO
       就是「资源管理器里按 Delete」的那条路，同样不新建进程。
   =====================================================================*/
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

namespace StarLaunch.Services
{
    /// <summary>一次文件操作的结果：成功与否 + 失败原因（成功时为 null）。</summary>
    internal readonly struct FileOpResult
    {
        public bool Ok { get; init; }

        /// <summary>失败原因，可以直接显示给用户。</summary>
        public string? Error { get; init; }

        public static FileOpResult Success()
        {
            return new FileOpResult { Ok = true };
        }

        public static FileOpResult Failure(string error)
        {
            return new FileOpResult { Ok = false, Error = error };
        }
    }

    internal static class FileOps
    {
        /// <summary>禁用后缀。和 PCL / HMCL 用的是同一个约定，用户手动改也一致。</summary>
        private const string DisabledSuffix = ".disabled";

        /* ── Win32：丢回收站 ───────────────────────────────────────── */

        private const uint FoDelete = 0x0003;

        private const ushort FofSilent = 0x0004;
        private const ushort FofNoConfirmation = 0x0010;
        private const ushort FofAllowUndo = 0x0040;
        private const ushort FofNoErrorUi = 0x0400;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct ShFileOpStruct
        {
            public IntPtr hwnd;
            public uint wFunc;

            /// <summary>以 \0 分隔的一组路径，最后一个后面还要再跟一个 \0（双 \0 结尾）。</summary>
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pFrom;

            [MarshalAs(UnmanagedType.LPWStr)]
            public string? pTo;

            public ushort fFlags;

            [MarshalAs(UnmanagedType.Bool)]
            public bool fAnyOperationsAborted;

            public IntPtr hNameMappings;

            [MarshalAs(UnmanagedType.LPWStr)]
            public string? lpszProgressTitle;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHFileOperationW")]
        private static extern int SHFileOperation(ref ShFileOpStruct fileOp);

        /* ── 动作 ──────────────────────────────────────────────────── */

        /// <summary>文件名是不是「已禁用」状态（以 .disabled 结尾）。</summary>
        public static bool IsDisabled(string name)
        {
            return (name ?? string.Empty).EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// 把文件改成启用或禁用。已经是目标状态时什么都不做（幂等）。
        /// 只接受文件；文件夹改名禁不掉，调用方应该只给删除。
        /// </summary>
        public static FileOpResult SetEnabled(string path, bool enabled)
        {
            try
            {
                if (!File.Exists(path))
                {
                    return FileOpResult.Failure("这个文件已经不在了，点「重新扫描」刷新一下列表");
                }

                string name = Path.GetFileName(path);
                bool disabled = IsDisabled(name);
                if (enabled == !disabled) return FileOpResult.Success();

                string target = enabled
                    ? path.Substring(0, path.Length - DisabledSuffix.Length)
                    : path + DisabledSuffix;

                if (File.Exists(target) || Directory.Exists(target))
                {
                    return FileOpResult.Failure("已经有同名文件了：" + Path.GetFileName(target) +
                        "\n\n先把其中一个改名或删掉，再试一次。");
                }

                File.Move(path, target);
                return FileOpResult.Success();
            }
            catch (Exception ex)
            {
                return FileOpResult.Failure(Describe(ex));
            }
        }

        /// <summary>把文件或文件夹移到回收站（可以还原）。</summary>
        public static FileOpResult DeleteToRecycleBin(string path)
        {
            try
            {
                if (!File.Exists(path) && !Directory.Exists(path))
                {
                    return FileOpResult.Failure("这个文件已经不在了，点「重新扫描」刷新一下列表");
                }

                var op = new ShFileOpStruct
                {
                    hwnd = IntPtr.Zero,
                    wFunc = FoDelete,
                    // 结尾的 \0 交给 marshaller 再补一个，正好凑成 shell 要求的双 \0
                    pFrom = path + "\0",
                    pTo = null,
                    fFlags = (ushort)(FofAllowUndo | FofNoConfirmation | FofSilent | FofNoErrorUi),
                    lpszProgressTitle = null
                };

                int code = SHFileOperation(ref op);
                if (op.fAnyOperationsAborted)
                {
                    return FileOpResult.Failure("操作被取消了，文件还在原处");
                }
                if (code != 0)
                {
                    return FileOpResult.Failure("没能移到回收站（Shell 返回 0x" + code.ToString("X4") +
                        "），文件没有删掉。\n\n可以试着自己删，或者确认这个位置所在的磁盘有回收站。");
                }
                return FileOpResult.Success();
            }
            catch (Exception ex)
            {
                return FileOpResult.Failure(Describe(ex));
            }
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
