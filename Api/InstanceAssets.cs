/*=====================================================================
   StarLaunch · 版本资源管理：Mod / 材质包 / 光影
   ---------------------------------------------------------------------
   网页只负责画列表，真正的读写在宿主这边：

     · instance-asset  { dir, kind, action: toggle|delete, names[], enabled }
         → 改后缀启用/禁用，或者移到回收站（一次可以给一批文件名）；
         → 回包带上这个目录重新列出来的清单，网页不用整盘重扫。

     · open-asset-dir  { dir, kind }
         → 打开 mods / resourcepacks / shaderpacks，目录还不存在就先建出来
           （新版本第一次点「打开文件夹」不该弹「文件夹不存在」）。

   网页发来的路径一律不当真：目录名必须正好是这三类之一，而且必须落在
   某个已登记的游戏文件夹里面；文件名只允许最后一段，不能带路径分隔符。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>网页能操作的三种资源目录（目录名就是网页传来的 kind）。</summary>
        private static bool IsAssetKind(string kind)
        {
            return kind == "mods" || kind == "resourcepacks" || kind == "shaderpacks";
        }

        /* -----------------------------------------------------------------
           启用 / 禁用 / 删除
           ----------------------------------------------------------------- */

        private void InstanceAsset(JsonElement root)
        {
            string id = ReadString(root, "id") ?? string.Empty;
            string kind = (ReadString(root, "kind") ?? string.Empty).Trim().ToLowerInvariant();
            string action = (ReadString(root, "action") ?? string.Empty).Trim().ToLowerInvariant();
            string? dir = ReadString(root, "dir");
            List<string> names = ReadNames(root);

            if (!TryResolveAssetDir(dir, kind, out string fullDir, out string dirError))
            {
                PostAssetMessage(false, id, kind, action, dir, names, false, null, dirError);
                return;
            }

            if (action != "toggle" && action != "delete")
            {
                PostAssetMessage(false, id, kind, action, fullDir, names, false, null, "不认识的操作：" + action);
                return;
            }

            if (names.Count == 0)
            {
                PostAssetMessage(false, id, kind, action, fullDir, names, false, null, "没有选中的文件");
                return;
            }

            // 操作栏一次可以选很多行：逐个做，失败的攒起来一起报，成功的照样生效
            bool enabled = action == "toggle" && (ReadBool(root, "enabled") ?? true);
            var problems = new List<string>();

            foreach (string name in names)
            {
                if (name.Length == 0 || !string.Equals(Path.GetFileName(name), name, StringComparison.Ordinal))
                {
                    problems.Add(name + "：文件名不合法");
                    continue;
                }

                string target = Path.Combine(fullDir, name);
                FileOpResult result = action == "delete"
                    ? FileOps.DeleteToRecycleBin(target)
                    : SetAssetEnabled(target, name, kind, enabled);

                if (!result.Ok) problems.Add(name + "：" + (result.Error ?? "未知错误"));
            }

            bool ok = problems.Count == 0;
            PostAssetMessage(ok, id, kind, action, fullDir, names, enabled,
                MinecraftScanner.ListAssetFiles(fullDir, kind),
                ok ? null : string.Join("\n", problems));
        }

        /// <summary>
        /// 单个文件的启用 / 禁用。只认这一类的后缀（.jar / .zip），
        /// 别让一个手滑的请求把目录里别的文件改成 .disabled。
        /// </summary>
        private static FileOpResult SetAssetEnabled(string target, string name, string kind, bool enabled)
        {
            string extension = MinecraftScanner.AssetExtension(kind);
            bool matches = name.EndsWith(extension, StringComparison.OrdinalIgnoreCase) ||
                name.EndsWith(extension + ".disabled", StringComparison.OrdinalIgnoreCase);
            if (!matches)
            {
                return FileOpResult.Failure("不是启动器能启用 / 禁用的类型（只认 " + extension + "）");
            }

            if (Directory.Exists(target))
            {
                return FileOpResult.Failure("文件夹不能禁用，只能删除（改名后游戏照样会读到里面的内容）");
            }

            return FileOps.SetEnabled(target, enabled);
        }

        /// <summary>打开资源目录；目录不存在就先建出来。</summary>
        private ShellLaunchResult OpenAssetDir(string? dir, string? kind)
        {
            string folderKind = (kind ?? string.Empty).Trim().ToLowerInvariant();
            if (!IsAssetKind(folderKind))
            {
                return ShellLaunchResult.Failure(dir, "不认识的资源类型：" + kind);
            }

            if (string.IsNullOrWhiteSpace(dir))
            {
                return ShellLaunchResult.Failure(dir, "没有给出要打开的文件夹");
            }

            string full;
            try
            {
                full = Path.GetFullPath(dir!);
            }
            catch (Exception ex)
            {
                return ShellLaunchResult.Failure(dir, "路径无效：" + ex.Message);
            }

            if (!IsInsideAnyGameDir(full))
            {
                return ShellLaunchResult.Failure(full, "这个目录不在登记的游戏文件夹里");
            }

            string leaf = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (!string.Equals(leaf, folderKind, StringComparison.OrdinalIgnoreCase))
            {
                return ShellLaunchResult.Failure(full, "路径和资源类型对不上");
            }

            if (!Directory.Exists(full))
            {
                try
                {
                    Directory.CreateDirectory(full);
                }
                catch (Exception ex)
                {
                    return ShellLaunchResult.Failure(full, "文件夹还不存在，也没能建出来：" + ex.Message);
                }
            }

            return ShellLaunch.OpenFolder(full);
        }

        /* -----------------------------------------------------------------
           校验 / 回包
           ----------------------------------------------------------------- */

        /// <summary>
        /// 网页传来的资源目录 → 校验过的绝对路径。
        /// 目录必须真的存在、最后一级目录名和 kind 对得上、并且落在登记的游戏文件夹里。
        /// </summary>
        private static bool TryResolveAssetDir(string? dir, string kind, out string full, out string error)
        {
            full = string.Empty;
            error = string.Empty;

            if (!IsAssetKind(kind))
            {
                error = "不认识的资源类型：" + kind;
                return false;
            }

            if (string.IsNullOrWhiteSpace(dir))
            {
                error = "没有给出文件夹";
                return false;
            }

            try
            {
                full = Path.GetFullPath(dir!);
            }
            catch (Exception ex)
            {
                error = "路径无效：" + ex.Message;
                return false;
            }

            if (!Directory.Exists(full))
            {
                error = "这个文件夹还不存在：" + full;
                return false;
            }

            string leaf = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (!string.Equals(leaf, kind, StringComparison.OrdinalIgnoreCase))
            {
                error = "路径和资源类型对不上";
                return false;
            }

            if (!IsInsideAnyGameDir(full))
            {
                error = "这个目录不在登记的游戏文件夹里";
                return false;
            }

            return true;
        }

        /// <summary>路径是不是在某个已登记的游戏文件夹里面（不要求它自己存在）。</summary>
        private static bool IsInsideAnyGameDir(string full)
        {
            try
            {
                return GameDirs.ResolveAll().Any(entry => IsInside(full, entry.Path));
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>取消息里的布尔字段，不存在或类型不对返回 null。</summary>
        private static bool? ReadBool(JsonElement root, string name)
        {
            if (!root.TryGetProperty(name, out var value)) return null;
            if (value.ValueKind == JsonValueKind.True) return true;
            if (value.ValueKind == JsonValueKind.False) return false;
            return null;
        }

        /// <summary>
        /// 要操作的文件名。新协议是 names 数组（操作栏可以多选），
        /// 老协议是单个 name；顺手去重，并且不信任超过 1000 条的请求。
        /// </summary>
        private static List<string> ReadNames(JsonElement root)
        {
            var names = new List<string>();

            if (root.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in array.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String) continue;
                    string value = (item.GetString() ?? string.Empty).Trim();
                    if (value.Length > 0) names.Add(value);
                }
            }

            if (names.Count == 0)
            {
                string single = (ReadString(root, "name") ?? string.Empty).Trim();
                if (single.Length > 0) names.Add(single);
            }

            return names
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(1000)
                .ToList();
        }

        private void PostAssetMessage(
            bool ok,
            string id,
            string kind,
            string action,
            string? dir,
            List<string> names,
            bool enabled,
            List<ModFileEntry>? files,
            string? error)
        {
            // 这里走的是 postMessage + 默认序列化选项（PascalCase），
            // 所以清单手动转成网页用的小驼峰，别指望命名策略帮忙
            List<object>? payload = files?.Select(file => (object)new
            {
                name = file.Name,
                enabled = file.Enabled,
                size = file.Size,
                isFolder = file.IsFolder
            }).ToList();

            PostPageMessage("instance-asset", new Dictionary<string, object?>
            {
                ["ok"] = ok,
                ["id"] = id,
                ["kind"] = kind,
                ["action"] = action,
                ["dir"] = dir,
                ["names"] = names,
                ["enabled"] = enabled,
                ["files"] = payload,
                ["error"] = error
            });
        }
    }
}
