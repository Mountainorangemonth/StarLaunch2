using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;

namespace StarLaunch.Services
{
    /// <summary>导入结果：成功时给网页一句能直接 toast 的话，失败时给原因。</summary>
    internal sealed class ModpackImportResult
    {
        public bool Ok { get; set; }
        public string? Error { get; set; }
        public string? Name { get; set; }
        public string? Message { get; set; }
    }

    /// <summary>
    /// 整合包导入（PCL 式）。
    ///
    /// 目标目录 = 当前文件夹（默认就是启动器同级的 .minecraft）。按压缩包里的结构分三种：
    ///   · 带 versions/ 的整包（PCL 导出的 .minecraft 打包）→ 合并进游戏目录，已存在的版本目录不动；
    ///   · CurseForge 的 manifest.json + overrides/ → 落成 versions/&lt;整合包名&gt;/ 独立实例；
    ///   · Modrinth 的 modrinth.index.json + overrides/ → 同上。
    ///
    /// 开了版本隔离时，后两种正是想要的效果：模组和配置都在版本目录里，不污染别的实例。
    /// mrpack 里靠 URL 下载的模组文件不会联网抓取（宿主没有下载器），会如实写进提示里。
    /// </summary>
    internal static class ModpackImporter
    {
        public static ModpackImportResult Import(string archivePath, string gameDir)
        {
            var result = new ModpackImportResult();
            string temp = Path.Combine(Path.GetTempPath(), "StarLaunch-import-" + Guid.NewGuid().ToString("n"));

            try
            {
                if (!File.Exists(archivePath))
                {
                    result.Error = "找不到这个文件";
                    return result;
                }

                string extension = Path.GetExtension(archivePath).ToLowerInvariant();
                if (extension != ".zip" && extension != ".mrpack")
                {
                    result.Error = "只支持 .zip / .mrpack 两种整合包格式";
                    return result;
                }

                Directory.CreateDirectory(temp);
                try
                {
                    ZipFile.ExtractToDirectory(archivePath, temp);
                }
                catch (Exception)
                {
                    result.Error = "压缩包解不开，可能不是有效的 zip / mrpack";
                    return result;
                }

                string root = FindArchiveRoot(temp);
                string folderName = Path.GetFileNameWithoutExtension(archivePath);

                /* 1. 带 versions/ 的整包：直接合并进游戏目录 */
                if (Directory.Exists(Path.Combine(root, "versions")))
                {
                    var counts = CopyTree(root, gameDir, overwrite: false);
                    result.Ok = true;
                    result.Name = folderName;
                    result.Message = BuildMessage("已合并整合包「" + folderName + "」到", gameDir, counts);
                    return result;
                }

                /* 2. Modrinth .mrpack */
                string modrinth = Path.Combine(root, "modrinth.index.json");
                if (File.Exists(modrinth))
                {
                    return ImportManifest(root, modrinth, gameDir, result, true);
                }

                /* 3. CurseForge 整合包 */
                string curse = Path.Combine(root, "manifest.json");
                if (File.Exists(curse))
                {
                    return ImportManifest(root, curse, gameDir, result, false);
                }

                /* 4. 看起来就是一个 .minecraft 的内容（mods / config / options.txt） */
                if (LooksLikeGameContent(root))
                {
                    var counts = CopyTree(root, gameDir, overwrite: false);
                    result.Ok = true;
                    result.Name = folderName;
                    result.Message = BuildMessage("已导入「" + folderName + "」到", gameDir, counts);
                    return result;
                }

                result.Error = "压缩包里既没有 versions/，也没有整合包清单（manifest.json / modrinth.index.json）";
                return result;
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
                return result;
            }
            finally
            {
                TryDeleteDirectory(temp);
            }
        }

        /* ---------------- 清单式整合包 ---------------- */

        private static ModpackImportResult ImportManifest(
            string root, string manifestPath, string gameDir, ModpackImportResult result, bool modrinth)
        {
            string? name = null;
            string? mcVersion = null;
            string? loaderCoordinate = null;
            int pendingDownloads = 0;

            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(manifestPath), new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                });
                var rootElement = document.RootElement;

                if (rootElement.ValueKind != JsonValueKind.Object)
                {
                    result.Error = "整合包清单格式不对";
                    return result;
                }

                name = ReadString(rootElement, "name");

                if (modrinth)
                {
                    if (rootElement.TryGetProperty("dependencies", out var deps) &&
                        deps.ValueKind == JsonValueKind.Object)
                    {
                        mcVersion = ReadString(deps, "minecraft");
                        loaderCoordinate = LoaderCoordinate(deps);
                    }

                    if (rootElement.TryGetProperty("files", out var files) &&
                        files.ValueKind == JsonValueKind.Array)
                    {
                        pendingDownloads = files.GetArrayLength();
                    }
                }
                else
                {
                    if (rootElement.TryGetProperty("minecraft", out var minecraft) &&
                        minecraft.ValueKind == JsonValueKind.Object)
                    {
                        mcVersion = ReadString(minecraft, "version");
                        if (minecraft.TryGetProperty("modLoaders", out var loaders) &&
                            loaders.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var loader in loaders.EnumerateArray())
                            {
                                string? id = ReadString(loader, "id");
                                if (string.IsNullOrWhiteSpace(id)) continue;
                                loaderCoordinate = CurseLoaderCoordinate(id!, mcVersion);
                                break;
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                result.Error = "整合包清单解析失败，可能文件已损坏";
                return result;
            }

            if (string.IsNullOrWhiteSpace(name))
            {
                name = "导入的整合包";
            }

            string versionName = UniqueVersionName(gameDir, SanitizeName(name!));
            string versionDir = Path.Combine(gameDir, "versions", versionName);

            try
            {
                GameDirs.Ensure(gameDir);
                Directory.CreateDirectory(versionDir);

                // overrides（CurseForge）或 overrides / client-overrides（Modrinth）里的文件属于这个实例
                int copied = 0;
                int skipped = 0;
                foreach (string overrideFolder in new[] { "overrides", "client-overrides", "server-overrides" })
                {
                    string source = Path.Combine(root, overrideFolder);
                    if (!Directory.Exists(source)) continue;
                    var counts = CopyTree(source, versionDir, overwrite: true);
                    copied += counts.Copied;
                    skipped += counts.Skipped;
                }

                // 没有 overrides 时，把压缩包根目录里的常见游戏内容也搬进去
                if (copied == 0 && LooksLikeGameContent(root))
                {
                    var counts = CopyTree(root, versionDir, overwrite: true, skipManifest: true);
                    copied += counts.Copied;
                    skipped += counts.Skipped;
                }

                WriteVersionJson(versionDir, versionName, mcVersion, loaderCoordinate);

                result.Ok = true;
                result.Name = versionName;

                var note = new List<string>();
                if (!string.IsNullOrWhiteSpace(mcVersion)) note.Add("Minecraft " + mcVersion);
                if (!string.IsNullOrWhiteSpace(loaderCoordinate)) note.Add(loaderCoordinate!);
                if (pendingDownloads > 0) note.Add(pendingDownloads.ToString(CultureInfo.InvariantCulture) + " 个文件需要联网补下载");

                result.Message = "已导入「" + versionName + "」到 " + versionDir +
                    (note.Count > 0 ? "（" + string.Join(" · ", note) + "）" : string.Empty) +
                    "，共 " + copied + " 个文件" +
                    (skipped > 0 ? "，跳过 " + skipped + " 个已存在的文件" : string.Empty);
                return result;
            }
            catch (Exception ex)
            {
                result.Error = "写入版本目录失败：" + ex.Message;
                return result;
            }
        }

        /// <summary>
        /// 生成一个最小可识别的版本 JSON：id + inheritsFrom + 加载器坐标。
        /// 扫描器靠 libraries 里的坐标认加载器，靠 inheritsFrom 回溯原版版本号。
        /// </summary>
        private static void WriteVersionJson(string versionDir, string versionName, string? mcVersion, string? loaderCoordinate)
        {
            var libraries = new List<object>();
            if (!string.IsNullOrWhiteSpace(loaderCoordinate))
            {
                libraries.Add(new Dictionary<string, object?> { ["name"] = loaderCoordinate });
            }

            var json = new Dictionary<string, object?>
            {
                ["id"] = versionName,
                ["type"] = "release",
                ["time"] = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                ["releaseTime"] = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                ["libraries"] = libraries
            };

            // 原版版本号缺失时不能写 inheritsFrom，否则继承链会指向一个不存在的版本
            if (!string.IsNullOrWhiteSpace(mcVersion)) json["inheritsFrom"] = mcVersion;

            string path = Path.Combine(versionDir, versionName + ".json");
            File.WriteAllText(path, JsonSerializer.Serialize(json, new JsonSerializerOptions { WriteIndented = true }));
        }

        /* ---------------- 加载器坐标 ---------------- */

        private static string? LoaderCoordinate(JsonElement dependencies)
        {
            string? forge = ReadString(dependencies, "forge");
            if (!string.IsNullOrWhiteSpace(forge)) return "net.minecraftforge:forge:" + forge;

            string? neoforge = ReadString(dependencies, "neoforge");
            if (!string.IsNullOrWhiteSpace(neoforge)) return "net.neoforged:neoforge:" + neoforge;

            string? fabric = ReadString(dependencies, "fabric-loader");
            if (!string.IsNullOrWhiteSpace(fabric)) return "net.fabricmc:fabric-loader:" + fabric;

            string? quilt = ReadString(dependencies, "quilt-loader");
            if (!string.IsNullOrWhiteSpace(quilt)) return "org.quiltmc:quilt-loader:" + quilt;

            return null;
        }

        /// <summary>CurseForge 的 id 形如 forge-47.2.0 / neoforge-21.1.233 / fabric-0.16.5。</summary>
        private static string? CurseLoaderCoordinate(string id, string? mcVersion)
        {
            int dash = id.IndexOf('-');
            if (dash <= 0 || dash >= id.Length - 1) return null;

            string loader = id.Substring(0, dash).ToLowerInvariant();
            string version = id.Substring(dash + 1);

            switch (loader)
            {
                case "forge":
                    // Forge 的坐标通常带原版号：1.20.1-47.2.0
                    return string.IsNullOrWhiteSpace(mcVersion)
                        ? "net.minecraftforge:forge:" + version
                        : "net.minecraftforge:forge:" + mcVersion + "-" + version;
                case "neoforge":
                    return "net.neoforged:neoforge:" + version;
                case "fabric":
                    return "net.fabricmc:fabric-loader:" + version;
                case "quilt":
                    return "org.quiltmc:quilt-loader:" + version;
                default:
                    return null;
            }
        }

        /* ---------------- 文件操作 ---------------- */

        private readonly struct CopyCounts
        {
            public CopyCounts(int copied, int skipped)
            {
                Copied = copied;
                Skipped = skipped;
            }
            public int Copied { get; }
            public int Skipped { get; }
        }

        /// <summary>
        /// 把 source 的内容平铺拷到 target。
        /// overwrite=false 时不动已存在的文件；versions 下已存在的版本目录整块跳过，
        /// 避免导入整包时把用户原来的实例覆盖掉。
        /// </summary>
        private static CopyCounts CopyTree(string source, string target, bool overwrite, bool skipManifest = false)
        {
            int copied = 0;
            int skipped = 0;

            var skipRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string sourceVersions = Path.Combine(source, "versions");
            string targetVersions = Path.Combine(target, "versions");
            if (Directory.Exists(sourceVersions))
            {
                foreach (string dir in Directory.EnumerateDirectories(sourceVersions))
                {
                    string name = Path.GetFileName(dir);
                    if (Directory.Exists(Path.Combine(targetVersions, name)))
                    {
                        skipRoots.Add("versions/" + name);
                    }
                }
            }

            foreach (string file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                string relative = Path.GetRelativePath(source, file).Replace('\\', '/');

                if (skipManifest && (relative.Equals("manifest.json", StringComparison.OrdinalIgnoreCase) ||
                                     relative.Equals("modrinth.index.json", StringComparison.OrdinalIgnoreCase)))
                {
                    skipped++;
                    continue;
                }

                if (skipRoots.Count > 0 && IsUnderAny(relative, skipRoots))
                {
                    skipped++;
                    continue;
                }

                string destination = Path.Combine(target, relative.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(destination) && !overwrite)
                {
                    skipped++;
                    continue;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Copy(file, destination, overwrite);
                copied++;
            }

            return new CopyCounts(copied, skipped);
        }

        private static bool IsUnderAny(string relative, HashSet<string> roots)
        {
            foreach (string root in roots)
            {
                if (relative.Equals(root, StringComparison.OrdinalIgnoreCase)) return true;
                if (relative.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        /// <summary>压缩包里只套了一层文件夹时往下走一层；有 .minecraft 就以它为根。</summary>
        private static string FindArchiveRoot(string temp)
        {
            string current = temp;
            for (int depth = 0; depth < 3; depth++)
            {
                string dotMinecraft = Path.Combine(current, ".minecraft");
                if (Directory.Exists(dotMinecraft)) return dotMinecraft;

                var directories = Directory.EnumerateDirectories(current).ToList();
                var files = Directory.EnumerateFiles(current).ToList();
                if (directories.Count == 1 && files.Count == 0)
                {
                    current = directories[0];
                    continue;
                }
                break;
            }
            return current;
        }

        /// <summary>判断这个目录看起来是不是游戏目录内容（mods / config / options.txt 之类）。</summary>
        private static bool LooksLikeGameContent(string folder)
        {
            foreach (string marker in new[] { "mods", "config", "saves", "resourcepacks", "shaderpacks", "options.txt", "versions" })
            {
                string path = Path.Combine(folder, marker);
                if (File.Exists(path) || Directory.Exists(path)) return true;
            }
            return false;
        }

        /// <summary>versions 下不能重名：重名就加序号。</summary>
        private static string UniqueVersionName(string gameDir, string name)
        {
            string candidate = name;
            int index = 2;
            while (Directory.Exists(Path.Combine(gameDir, "versions", candidate)))
            {
                candidate = name + " (" + index.ToString(CultureInfo.InvariantCulture) + ")";
                index++;
                if (index > 999) break;
            }
            return candidate;
        }

        private static string SanitizeName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var chars = name.Trim().Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray();
            string cleaned = new string(chars).Trim().TrimEnd('.');
            if (cleaned.Length > 60) cleaned = cleaned.Substring(0, 60).Trim();
            return cleaned.Length == 0 ? "导入的整合包" : cleaned;
        }

        private static string? ReadString(JsonElement element, string property)
        {
            if (element.ValueKind != JsonValueKind.Object) return null;
            if (!element.TryGetProperty(property, out var value)) return null;
            return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        }

        private static string BuildMessage(string prefix, string gameDir, CopyCounts counts)
        {
            return prefix + " " + gameDir + "，共 " + counts.Copied + " 个文件" +
                   (counts.Skipped > 0 ? "，跳过 " + counts.Skipped + " 个已存在的文件" : string.Empty);
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, true);
            }
            catch (Exception)
            {
                // 临时目录删不掉不影响导入结果，系统重启后会自己清
            }
        }
    }
}
