/*=====================================================================
   StarLaunch · 加载器清单（Fabric / Quilt / Forge / NeoForge / OptiFine）
   ---------------------------------------------------------------------
   安装页要像 PCL 那样，选完原版版本之后再挑一个加载器，所以这里负责
   把「这个 Minecraft 版本能用哪些加载器、各自有哪些版本」问出来：

     · Fabric   meta.fabricmc.net（BMCLAPI 镜像 /fabric-meta 可用）
     · Quilt    meta.quiltmc.org（镜像没有，走官方源）
     · Forge    maven-metadata.xml，挑 `{mc}-{build}` 里的 build
     · NeoForge maven-metadata.xml，MC 1.20.4 → 20.4.x；1.21.1 → 21.1.x
     · OptiFine  没有公开接口，只能给手动下载入口（和 PCL 一样）

   每个加载器最多回 40 个版本，第一条标成推荐。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    internal sealed class LoaderVersionInfo
    {
        public string Version { get; set; } = string.Empty;
        public bool Recommended { get; set; }
    }

    internal sealed class LoaderChoice
    {
        /// <summary>vanilla / fabric / quilt / forge / neoforge / optifine</summary>
        public string Key { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;

        /// <summary>没有可用版本 / 需要手动时的说明。</summary>
        public string? Note { get; set; }

        /// <summary>需要用户自己去官网下载（OptiFine）。</summary>
        public bool Manual { get; set; }
        public string? ManualUrl { get; set; }

        public List<LoaderVersionInfo> Versions { get; set; } = new List<LoaderVersionInfo>();
    }

    internal static class LoaderCatalog
    {
        public const string Vanilla = "vanilla";
        public const string Fabric = "fabric";
        public const string Quilt = "quilt";
        public const string Forge = "forge";
        public const string NeoForge = "neoforge";
        public const string OptiFine = "optifine";

        private const int MaxVersions = 40;
        private const string FabricMetaMirror = "https://bmclapi2.bangbang93.com/fabric-meta";
        private const string FabricMetaOfficial = "https://meta.fabricmc.net";
        private const string QuiltMeta = "https://meta.quiltmc.org";
        private const string ForgeMetadata = "https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/maven-metadata.xml";
        private const string NeoForgeMetadata = "https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/maven-metadata.xml";

        public static string NormalizeLoader(string? key)
        {
            switch ((key ?? string.Empty).Trim().ToLowerInvariant())
            {
                case Fabric:
                    return Fabric;
                case Quilt:
                    return Quilt;
                case Forge:
                    return Forge;
                case NeoForge:
                case "neo-forge":
                    return NeoForge;
                case OptiFine:
                    return OptiFine;
                default:
                    return Vanilla;
            }
        }

        public static string DisplayName(string key)
        {
            switch (NormalizeLoader(key))
            {
                case Fabric:
                    return "Fabric";
                case Quilt:
                    return "Quilt";
                case Forge:
                    return "Forge";
                case NeoForge:
                    return "NeoForge";
                case OptiFine:
                    return "OptiFine";
                default:
                    return "原版";
            }
        }

        /// <summary>这个游戏版本能用的加载器清单（顺序和 PCL 一样：Forge / NeoForge / Fabric / Quilt / OptiFine）。</summary>
        public static async Task<List<LoaderChoice>> ListAsync(string mcVersion, CancellationToken token)
        {
            var forge = new LoaderChoice { Key = Forge, Name = "Forge" };
            var neoforge = new LoaderChoice { Key = NeoForge, Name = "NeoForge" };
            var fabric = new LoaderChoice { Key = Fabric, Name = "Fabric" };
            var quilt = new LoaderChoice { Key = Quilt, Name = "Quilt" };
            var optifine = new LoaderChoice
            {
                Key = OptiFine,
                Name = "OptiFine",
                Manual = true,
                ManualUrl = "https://optifine.net/downloads",
                Note = "需要到 optifine.net 手动下载"
            };

            var tasks = new List<Task>
            {
                FillForgeAsync(forge, mcVersion, token),
                FillNeoForgeAsync(neoforge, mcVersion, token),
                FillFabricAsync(fabric, mcVersion, token),
                FillQuiltAsync(quilt, mcVersion, token)
            };
            await Task.WhenAll(tasks).ConfigureAwait(false);

            return new List<LoaderChoice> { forge, neoforge, fabric, quilt, optifine };
        }

        /* -----------------------------------------------------------------
           各家
           ----------------------------------------------------------------- */

        private static async Task FillFabricAsync(LoaderChoice choice, string mc, CancellationToken token)
        {
            string official = FabricMetaOfficial + "/v2/versions/loader/" + Uri.EscapeDataString(mc);
            string mirror = FabricMetaMirror + "/v2/versions/loader/" + Uri.EscapeDataString(mc);

            string? body = await TryGetAsync(mirror, token).ConfigureAwait(false)
                           ?? await TryGetAsync(official, token).ConfigureAwait(false);
            if (body == null)
            {
                choice.Note = "读不到 Fabric 的版本列表";
                return;
            }

            try
            {
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.ValueKind != JsonValueKind.Array) return;

                var versions = new List<LoaderVersionInfo>();
                bool recommendedSet = false;
                foreach (var item in document.RootElement.EnumerateArray())
                {
                    var loader = JsonRead.Object(item, "loader");
                    string version = JsonRead.String(loader, "version");
                    if (version.Length == 0) continue;

                    bool stable = JsonRead.Bool(loader, "stable");
                    bool recommended = !recommendedSet && stable;
                    if (recommended) recommendedSet = true;

                    versions.Add(new LoaderVersionInfo { Version = version, Recommended = recommended });
                    if (versions.Count >= MaxVersions) break;
                }

                if (versions.Count > 0 && !versions.Any(item => item.Recommended))
                {
                    versions[0].Recommended = true;
                }
                choice.Versions = versions;
                if (versions.Count == 0) choice.Note = "这个版本没有 Fabric 加载器";
            }
            catch (JsonException)
            {
                choice.Note = "Fabric 返回的数据看不懂";
            }
        }

        private static async Task FillQuiltAsync(LoaderChoice choice, string mc, CancellationToken token)
        {
            string url = QuiltMeta + "/v3/versions/loader/" + Uri.EscapeDataString(mc);
            string? body = await TryGetAsync(url, token).ConfigureAwait(false);
            if (body == null)
            {
                choice.Note = "读不到 Quilt 的版本列表";
                return;
            }

            try
            {
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.ValueKind != JsonValueKind.Array) return;

                var versions = new List<LoaderVersionInfo>();
                foreach (var item in document.RootElement.EnumerateArray())
                {
                    var loader = JsonRead.Object(item, "loader");
                    string version = JsonRead.String(loader, "version");
                    if (version.Length == 0) continue;

                    versions.Add(new LoaderVersionInfo
                    {
                        Version = version,
                        Recommended = versions.Count == 0
                    });
                    if (versions.Count >= MaxVersions) break;
                }
                choice.Versions = versions;
                if (versions.Count == 0) choice.Note = "这个版本没有 Quilt 加载器";
            }
            catch (JsonException)
            {
                choice.Note = "Quilt 返回的数据看不懂";
            }
        }

        private static async Task FillForgeAsync(LoaderChoice choice, string mc, CancellationToken token)
        {
            var all = await MavenVersionsAsync(ForgeMetadata, token).ConfigureAwait(false);
            if (all == null)
            {
                choice.Note = "读不到 Forge 的版本列表";
                return;
            }

            string prefix = mc + "-";
            var matched = all.Where(item => item.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(item => item.Substring(prefix.Length))
                .Where(item => item.Length > 0)
                .ToList();

            if (matched.Count == 0)
            {
                choice.Note = "这个版本没有 Forge";
                return;
            }

            // maven-metadata 是旧到新排的，倒过来让最新的在最上面
            matched.Reverse();
            choice.Versions = matched.Take(MaxVersions)
                .Select((version, index) => new LoaderVersionInfo { Version = version, Recommended = index == 0 })
                .ToList();
        }

        private static async Task FillNeoForgeAsync(LoaderChoice choice, string mc, CancellationToken token)
        {
            var all = await MavenVersionsAsync(NeoForgeMetadata, token).ConfigureAwait(false);
            if (all == null)
            {
                choice.Note = "读不到 NeoForge 的版本列表";
                return;
            }

            // NeoForge 的版本号规则：MC 1.20.4 → 20.4.x，1.21.1 → 21.1.x
            string prefix = NeoForgePrefix(mc);
            if (prefix.Length == 0)
            {
                choice.Note = "这个版本没有 NeoForge";
                return;
            }

            var matched = all.Where(item => item.StartsWith(prefix, StringComparison.Ordinal))
                .ToList();
            if (matched.Count == 0)
            {
                choice.Note = "这个版本没有 NeoForge";
                return;
            }

            matched.Reverse();
            choice.Versions = matched.Take(MaxVersions)
                .Select((version, index) => new LoaderVersionInfo { Version = version, Recommended = index == 0 })
                .ToList();
        }

        /// <summary>把 1.20.4 换算成 NeoForge 用的 20.4. 前缀。</summary>
        internal static string NeoForgePrefix(string mc)
        {
            string text = (mc ?? string.Empty).Trim();
            if (text.Length == 0) return string.Empty;
            if (text.StartsWith("1.", StringComparison.Ordinal)) text = text.Substring(2);
            return text + ".";
        }

        /* -----------------------------------------------------------------
           工具
           ----------------------------------------------------------------- */

        private static async Task<List<string>?> MavenVersionsAsync(string url, CancellationToken token)
        {
            string? xml = await TryGetAsync(url, token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(xml)) return null;

            var versions = new List<string>();
            int index = 0;
            while (true)
            {
                int start = xml!.IndexOf("<version>", index, StringComparison.Ordinal);
                if (start < 0) break;
                start += "<version>".Length;
                int end = xml.IndexOf("</version>", start, StringComparison.Ordinal);
                if (end < 0) break;

                string value = xml.Substring(start, end - start).Trim();
                if (value.Length > 0) versions.Add(value);
                index = end;
            }
            return versions;
        }

        /// <summary>
        /// 取文本，失败返回 null（加载器清单拉不到不该让整页报错）。
        /// 这里**不要**再过 Mirrors.Rewrite：上面的地址已经是选出该走的源了，
        /// 而 BMCLAPI 没有 Quilt 镜像（/quilt-meta 是 404），再改写反而会挂。
        /// </summary>
        private static async Task<string?> TryGetAsync(string url, CancellationToken token)
        {
            try
            {
                return await JsonHttp.GetStringAsync(url, token).ConfigureAwait(false);
            }
            catch (HttpError)
            {
                return null;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
        }
    }
}
