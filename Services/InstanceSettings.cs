/*=====================================================================
   StarLaunch · 单个版本的设置（PCL 的「版本设置」）
   ---------------------------------------------------------------------
   每个版本可以单独配置启动方式、Java、内存和界面上的显示名，
   文件就落在版本目录里：

       .minecraft\versions\<版本名>\StarLaunch.instance.json

   约定（和用户在设置页里的说法一致）：
     · 没有改过的字段不写进文件 —— 文件里没有 = 跟随全局设置；
     · 文件里出现的字段就是这个版本的覆盖值；
     · 整个对象都为空时直接把文件删掉，回到「完全跟随全局」。

   这些都是宿主侧的读写：网页只把 JSON 发过来，路径必须先过
   GameDirs 校验（见 Api/VersionsApi.cs 的 TryResolveVersionDir）。
   =====================================================================*/
using System;
using System.Globalization;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StarLaunch.Services
{
    /// <summary>
    /// 一个版本的独立设置。
    ///
    /// 所有属性都是可空 / 有默认值：null 表示「跟随全局设置」，
    /// 序列化时 null 会被省略（见 InstanceSettingsStore 的选项）。
    /// </summary>
    internal sealed class InstanceSettings
    {
        /// <summary>配置文件格式版本，留给以后改结构时迁移用。</summary>
        public int Version { get; set; } = 1;

        /// <summary>最后写入时间（ISO 8601），只给人看。</summary>
        public string? UpdatedAt { get; set; }

        /* ---- 显示（版本列表 / 概览页） ---- */

        /// <summary>显示名（PCL 的「修改版本名」）；为空时用目录名。</summary>
        public string? Alias { get; set; }

        /// <summary>一句话描述，只在这套界面里显示。</summary>
        public string? Description { get; set; }

        /// <summary>图标配色：winter / sky / violet / deep / sunset / ember / plain。</summary>
        public string? Tone { get; set; }

        /// <summary>收藏：列表里排前面并带一颗星。</summary>
        public bool? Favorite { get; set; }

        /* ---- 启动选项 ---- */

        /// <summary>版本隔离：on = 隔离，off = 不隔离；null = 按文件夹策略。</summary>
        public string? Isolation { get; set; }

        /// <summary>游戏窗口标题；null = 跟随全局，空串也按 null 处理。</summary>
        public string? WindowTitle { get; set; }

        /// <summary>自定义信息（PCL 的「自定义信息」，会替换窗口标题里的 {custominfo}）。</summary>
        public string? CustomInfo { get; set; }

        /// <summary>Java：auto = 自动选择，其它值当作 java.exe / JDK 目录；null = 跟随全局。</summary>
        public string? Java { get; set; }

        /* ---- 内存 ---- */

        /// <summary>auto = 自动配置，custom = 自定义；null = 跟随全局。</summary>
        public string? MemoryMode { get; set; }

        /// <summary>自定义时的堆内存（MB）。</summary>
        public int? MemoryMb { get; set; }

        /// <summary>启动前内存优化：on / off；null = 跟随全局。</summary>
        public string? MemoryOptimize { get; set; }

        /* ---- 高级 ---- */

        public string? JvmArgs { get; set; }
        public string? GameArgs { get; set; }
        public string? PreCommand { get; set; }

        /// <summary>禁用 Launch Wrapper；null = 跟随全局。</summary>
        public bool? DisableWrapper { get; set; }

        /// <summary>使用高性能显卡；null = 跟随全局。</summary>
        public bool? HighPerfGpu { get; set; }

        /// <summary>归一化之后是不是一个「什么都没改」的对象。</summary>
        [JsonIgnore]
        public bool IsEmpty =>
            Alias == null && Description == null && Tone == null && Favorite == null &&
            Isolation == null && WindowTitle == null && CustomInfo == null && Java == null &&
            MemoryMode == null && MemoryMb == null && MemoryOptimize == null &&
            JvmArgs == null && GameArgs == null && PreCommand == null &&
            DisableWrapper == null && HighPerfGpu == null;
    }

    /// <summary>
    /// 版本设置文件的读写。只碰版本目录里的那一个 json，不动别的文件。
    /// </summary>
    internal static class InstanceSettingsStore
    {
        /// <summary>配置文件名，和 PCL 的 PCL\Setup.ini 一样固定放在版本目录里。</summary>
        public const string FileName = "StarLaunch.instance.json";

        /// <summary>写盘用：缩进、camelCase、null 省略、中文不转义（文件要能直接看懂）。</summary>
        public static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        /// <summary>某个版本目录对应的配置文件路径。</summary>
        public static string PathFor(string versionDir) => Path.Combine(versionDir, FileName);

        /// <summary>
        /// 读一个版本的设置。文件不存在、读不了、内容坏了都返回 null
        /// （= 完全跟随全局），界面上不会因为一个坏文件打不开。
        /// </summary>
        public static InstanceSettings? Load(string versionDir)
        {
            if (string.IsNullOrWhiteSpace(versionDir)) return null;
            try
            {
                string path = PathFor(versionDir);
                if (!File.Exists(path)) return null;
                var settings = JsonSerializer.Deserialize<InstanceSettings>(
                    File.ReadAllText(path), SerializerOptions);
                if (settings == null) return null;
                var normalized = Normalize(settings);
                return normalized.IsEmpty ? null : normalized;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// 写一个版本的设置。空对象 = 删除文件（回到跟随全局）。
        /// 失败时返回 false 并把原因写进 error，由网页用自己的浮层显示。
        /// </summary>
        public static bool Save(string versionDir, InstanceSettings? settings, out string? error)
        {
            error = null;
            try
            {
                string path = PathFor(versionDir);
                var normalized = Normalize(settings);

                if (normalized.IsEmpty)
                {
                    if (File.Exists(path)) File.Delete(path);
                    return true;
                }

                normalized.Version = 1;
                normalized.UpdatedAt = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture);
                File.WriteAllText(path, JsonSerializer.Serialize(normalized, SerializerOptions));
                return true;
            }
            catch (Exception ex)
            {
                error = "写不进版本设置文件：" + ex.Message;
                return false;
            }
        }

        /// <summary>删掉版本设置文件（「恢复默认」）。</summary>
        public static bool Reset(string versionDir, out string? error)
        {
            error = null;
            try
            {
                string path = PathFor(versionDir);
                if (File.Exists(path)) File.Delete(path);
                return true;
            }
            catch (Exception ex)
            {
                error = "删不掉版本设置文件：" + ex.Message;
                return false;
            }
        }

        /// <summary>
        /// 收敛外部输入：去空白、长度截断、枚举值只认白名单、内存钳到合理区间。
        /// 网页和手改的文件都会过这一层，所以界面拿到的永远是干净值。
        /// </summary>
        public static InstanceSettings Normalize(InstanceSettings? settings)
        {
            var result = new InstanceSettings();
            if (settings == null) return result;

            result.Alias = Text(settings.Alias, 64);
            result.Description = Text(settings.Description, 200);
            result.Tone = Choice(settings.Tone, "winter", "sky", "violet", "deep", "sunset", "ember", "plain");
            result.Favorite = settings.Favorite;

            result.Isolation = Choice(settings.Isolation, "on", "off");
            result.WindowTitle = Text(settings.WindowTitle, 120);
            result.CustomInfo = Text(settings.CustomInfo, 120);
            result.Java = Text(settings.Java, 400);

            result.MemoryMode = Choice(settings.MemoryMode, "auto", "custom");
            result.MemoryOptimize = Choice(settings.MemoryOptimize, "on", "off");

            // 256 MB ~ 128 GB：再小启动不了，再大一定是填错了
            if (settings.MemoryMb.HasValue)
            {
                int mb = settings.MemoryMb.Value;
                if (mb > 0) result.MemoryMb = Math.Max(256, Math.Min(131072, mb));
            }

            result.JvmArgs = Text(settings.JvmArgs, 8000);
            result.GameArgs = Text(settings.GameArgs, 4000);
            result.PreCommand = Text(settings.PreCommand, 2000);
            result.DisableWrapper = settings.DisableWrapper;
            result.HighPerfGpu = settings.HighPerfGpu;

            // 自定义内存没有数值时，这个模式本身没有意义，退成跟随全局
            if (result.MemoryMode == "custom" && result.MemoryMb == null) result.MemoryMode = null;
            if (result.MemoryMode != "custom") result.MemoryMb = null;

            return result;
        }

        private static string? Text(string? value, int maxLength)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string text = value!.Trim();
            return text.Length > maxLength ? text.Substring(0, maxLength) : text;
        }

        private static string? Choice(string? value, params string[] allowed)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string text = value!.Trim().ToLowerInvariant();
            foreach (string item in allowed)
            {
                if (text == item) return text;
            }
            return null;
        }
    }
}
