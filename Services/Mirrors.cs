/*=====================================================================
   StarLaunch · 下载源（官方 / BMCLAPI / MCIM 镜像）
   ---------------------------------------------------------------------
   两类文件分开管，因为能镜像它们的人不是同一拨：

     · 原版文件（版本 JSON、client.jar、assets、libraries、加载器元数据）
       只有 BMCLAPI 镜像。Mojang 的地址是「换主机名」就能用的，路径一个字
       都不改，所以 Rewrite / ToMirror 只做替换。
     · 社区资源（Mod / 整合包 / 资源包 / 光影）只有 MCIM 镜像。Modrinth 的
       api.modrinth.com → mod.mcimirror.top/modrinth，cdn.modrinth.com →
       mod.mcimirror.top，这是 PCL 用的同一套映射。

   社区资源还有个「自动」档（默认）：先走官方，失败一次之后本次运行里就
   优先走镜像 —— 官方被墙时不会每个文件都白等一遍超时。
   =====================================================================*/
using System;
using System.Collections.Generic;

namespace StarLaunch.Services
{
    internal static class Mirrors
    {
        public const string Official = "official";
        public const string Bmcl = "bmclapi";

        /// <summary>社区资源下载源：先官方、失败自动换镜像。</summary>
        public const string ModAuto = "auto";

        /// <summary>社区资源下载源：镜像优先。</summary>
        public const string ModMirror = "mcim";

        private const string MirrorHost = "https://bmclapi2.bangbang93.com";
        private const string McimHost = "https://mod.mcimirror.top";

        /// <summary>当前下载源（原版文件）。只有两个合法值，别的一律当镜像。</summary>
        public static string Current =>
            string.Equals(LauncherConfigStore.Current.DownloadMirror, Official, StringComparison.OrdinalIgnoreCase)
                ? Official
                : Bmcl;

        public static bool IsOfficial => Current == Official;

        public static void Set(string? value)
        {
            var config = LauncherConfigStore.Current;
            config.DownloadMirror = string.Equals(value, Official, StringComparison.OrdinalIgnoreCase)
                ? Official
                : Bmcl;
            LauncherConfigStore.Save();
        }

        /* -----------------------------------------------------------------
           社区资源（Modrinth）下载源
           ----------------------------------------------------------------- */

        /// <summary>社区资源下载源：auto / mcim / official。</summary>
        public static string ModrinthCurrent
        {
            get
            {
                string value = (LauncherConfigStore.Current.DownloadModrinth ?? string.Empty).Trim().ToLowerInvariant();
                if (value == ModMirror || value == Official) return value;
                return ModAuto;
            }
        }

        public static void SetModrinth(string? value)
        {
            string text = (value ?? string.Empty).Trim().ToLowerInvariant();
            var config = LauncherConfigStore.Current;
            config.DownloadModrinth = text == ModMirror ? ModMirror
                : (text == Official ? Official : ModAuto);
            LauncherConfigStore.Save();
        }

        /// <summary>
        /// 本次运行里官方地址失败过一次（或镜像成功过）。置位后「自动」档直接走镜像，
        /// 免得每个文件都先等一轮官方源超时。重启启动器会重新试官方。
        /// </summary>
        private static volatile bool _preferModrinthMirror;

        public static bool PreferModrinthMirror => _preferModrinthMirror;

        /// <summary>记一笔某个地址通不通。只关心 Modrinth / MCIM 的地址，别的直接忽略。</summary>
        public static void ReportSource(string? url, bool ok)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            if (!IsModrinthUrl(url) && !IsMirrorUrl(url)) return;

            if (ok && IsMirrorUrl(url)) _preferModrinthMirror = true;
            else if (!ok && !IsMirrorUrl(url)) _preferModrinthMirror = true;
        }

        public static bool IsMirrorUrl(string? url) =>
            !string.IsNullOrEmpty(url) && url!.IndexOf("mcimirror.top", StringComparison.OrdinalIgnoreCase) >= 0;

        private static bool IsModrinthUrl(string? url) =>
            !string.IsNullOrEmpty(url) && url!.IndexOf("modrinth", StringComparison.OrdinalIgnoreCase) >= 0;

        /// <summary>
        /// 一个 Modrinth 地址（接口或文件）该按什么顺序试。
        /// 「仅官方」只有一个候选；另外两档都会在最坏情况下退回对方。
        /// </summary>
        public static IReadOnlyList<string> ModrinthCandidates(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return Array.Empty<string>();

            string official = url!.Trim();
            string mirror = ToModrinthMirror(official);
            if (string.Equals(official, mirror, StringComparison.OrdinalIgnoreCase))
            {
                return new[] { official };
            }

            switch (ModrinthCurrent)
            {
                case Official:
                    return new[] { official };
                case ModMirror:
                    return new[] { mirror, official };
                default:
                    return _preferModrinthMirror
                        ? new[] { mirror, official }
                        : new[] { official, mirror };
            }
        }

        /// <summary>把 Modrinth 的地址换到 MCIM 镜像上（映射和 PCL 一致）。</summary>
        public static string ToModrinthMirror(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return string.Empty;
            string text = url!.Trim();
            if (IsMirrorUrl(text)) return text;

            text = Replace(text, "https://api.modrinth.com", McimHost + "/modrinth");
            text = Replace(text, "https://staging-api.modrinth.com", McimHost + "/modrinth");
            text = Replace(text, "https://cdn.modrinth.com", McimHost);
            return text;
        }

        /// <summary>社区资源源的界面文案。</summary>
        public static string ModrinthLabel(string? value)
        {
            switch ((value ?? ModrinthCurrent).Trim().ToLowerInvariant())
            {
                case ModMirror:
                    return "MCIM 镜像";
                case Official:
                    return "Modrinth 官方";
                default:
                    return "自动（官方优先，失败走镜像）";
            }
        }

        /* -----------------------------------------------------------------
           原版文件
           ----------------------------------------------------------------- */

        private const string OfficialManifestUrl =
            "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

        /// <summary>版本清单地址（BMCLAPI 上就是同一个路径）。</summary>
        public static string VersionManifestUrl => Rewrite(OfficialManifestUrl);

        /// <summary>版本清单的候选地址：当前源优先，另一种兜底。</summary>
        public static IReadOnlyList<string> VersionManifestCandidates =>
            VanillaCandidates(OfficialManifestUrl);

        /// <summary>按当前下载源改写一个 Mojang 地址；已经是镜像地址或不是 Mojang 的地址原样返回。</summary>
        public static string Rewrite(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return string.Empty;
            string text = url!.Trim();
            if (!IsOfficial) return ToMirror(text);
            return text;
        }

        /// <summary>强制转成镜像地址（用户选官方源、但官方源连不上时用）。</summary>
        public static string ToMirror(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return string.Empty;
            string text = url.Trim();

            // 已经是镜像了就别再套一层
            if (text.StartsWith(MirrorHost, StringComparison.OrdinalIgnoreCase)) return text;

            // 顺序有讲究：先匹配更长更具体的域名
            text = Replace(text, "https://resources.download.minecraft.net", MirrorHost + "/assets");
            text = Replace(text, "http://resources.download.minecraft.net", MirrorHost + "/assets");
            text = Replace(text, "https://libraries.minecraft.net", MirrorHost + "/maven");
            text = Replace(text, "http://libraries.minecraft.net", MirrorHost + "/maven");
            text = Replace(text, "https://files.minecraftforge.net/maven", MirrorHost + "/maven");
            text = Replace(text, "https://maven.minecraftforge.net", MirrorHost + "/maven");
            text = Replace(text, "https://launchermeta.mojang.com", MirrorHost);
            text = Replace(text, "https://piston-meta.mojang.com", MirrorHost);
            text = Replace(text, "https://piston-data.mojang.com", MirrorHost);
            text = Replace(text, "https://launcher.mojang.com", MirrorHost);
            text = Replace(text, "https://meta.fabricmc.net", MirrorHost + "/fabric-meta");
            // Fabric / Quilt 自己的 maven：加载器的运行库都在这里（BMCLAPI 的 /maven 是通用代理）
            text = Replace(text, "https://maven.fabricmc.net", MirrorHost + "/maven");
            text = Replace(text, "https://maven.quiltmc.org", MirrorHost + "/maven");
            // Quilt 没有镜像，别把 meta.quiltmc.org 改写过去（/quilt-meta 是 404）
            // Modrinth 也不归这里管，见 ModrinthCandidates
            return text;
        }

        /// <summary>
        /// 一个原版文件的候选地址：当前下载源优先，另一种兜底。
        /// 镜像抽风时能退回官方，选了官方源被墙时也能退回镜像 —— 只靠一个地址的话，
        /// 一次 TLS 抖动就让整个安装失败了。
        /// </summary>
        public static IReadOnlyList<string> VanillaCandidates(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return Array.Empty<string>();

            string text = url!.Trim();
            var list = new List<string>(3);
            Add(Rewrite(text));
            Add(ToMirror(text));
            Add(text);   // 传进来的是官方地址时，这就是最后一道兜底
            return list;

            void Add(string? candidate)
            {
                if (string.IsNullOrWhiteSpace(candidate)) return;
                string value = candidate!.Trim();
                if (value.Length == 0) return;

                foreach (string existing in list)
                {
                    if (string.Equals(existing, value, StringComparison.OrdinalIgnoreCase)) return;
                }
                list.Add(value);
            }
        }

        private static string Replace(string text, string from, string to)
        {
            return text.StartsWith(from, StringComparison.OrdinalIgnoreCase)
                ? to + text.Substring(from.Length)
                : text;
        }
    }
}
