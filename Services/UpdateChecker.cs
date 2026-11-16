/*=====================================================================
   StarLaunch · 检查启动器更新
   ---------------------------------------------------------------------
   设置里「检查启动器更新」这个开关以前只弹个 toast，状态既没存也没人用。
   现在它真的能查：问一次 GitHub Releases 的最新 release，和程序集版本比。

   为什么单独一个 HttpClient：
     · JsonHttp 那套是给下载用的（3 次重试、12 秒连接超时），拿它查更新
       会让启动多等半分钟；
     · 这里 8 秒没回音就当「查不到」，静默失败 —— 离线也要能正常启动。

   仓库没有发过 release 时 GitHub 返回 404，按「没有新版本」处理。
   =====================================================================*/
using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    internal sealed class UpdateInfo
    {
        public bool Available { get; set; }
        public string Latest { get; set; } = string.Empty;
        public string Current { get; set; } = string.Empty;
        public string Url { get; set; } = string.Empty;
    }

    internal static class UpdateChecker
    {
        /// <summary>启动器项目的 releases 接口（和「关于」页的项目主页是同一个仓库）。</summary>
        private const string Endpoint =
            "https://api.github.com/repos/Mountainorangemonth/StarLaunch2/releases/latest";

        private static readonly HttpClient Client = Create();

        private static HttpClient Create()
        {
            var client = new HttpClient(new SocketsHttpHandler
            {
                ConnectTimeout = TimeSpan.FromSeconds(6),
                PooledConnectionLifetime = TimeSpan.FromMinutes(5)
            })
            {
                Timeout = TimeSpan.FromSeconds(8)
            };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("StarLaunch/" + GameLauncher.LauncherVersion);
            client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            return client;
        }

        /// <summary>查一次。查不到就抛 HttpError（调用方决定是静默还是提示）。</summary>
        public static async Task<UpdateInfo> CheckAsync(CancellationToken token)
        {
            var info = new UpdateInfo { Current = GameLauncher.LauncherVersion };

            using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint);
            using var response = await Client.SendAsync(request, token).ConfigureAwait(false);

            // 404 = 这个仓库还没有 release，不算错误
            if (response.StatusCode == HttpStatusCode.NotFound) return info;
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpError("更新服务器返回 " + (int)response.StatusCode);
            }

            string text = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(text)) return info;

            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;

            info.Latest = ReadString(root, "tag_name");
            info.Url = ReadString(root, "html_url");
            info.Available = IsNewer(info.Latest, info.Current);
            return info;
        }

        private static string ReadString(JsonElement root, string name)
        {
            return root.ValueKind == JsonValueKind.Object &&
                   root.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.String
                ? (value.GetString() ?? string.Empty)
                : string.Empty;
        }

        /// <summary>
        /// tag 比当前版本新吗？tag 可能是 v1.2.3 / 1.2.3 / v1.2 这种，
        /// 解析不了就按字符串不等处理（宁可提示一次，也不要漏掉更新）。
        /// </summary>
        internal static bool IsNewer(string? tag, string? current)
        {
            string left = Normalize(tag);
            string right = Normalize(current);
            if (left.Length == 0) return false;
            if (right.Length == 0) return true;

            if (Version.TryParse(Pad(left), out var latest) && Version.TryParse(Pad(right), out var now))
            {
                return latest > now;
            }

            return !string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
        }

        private static string Normalize(string? value)
        {
            string text = (value ?? string.Empty).Trim();
            if (text.StartsWith("v", StringComparison.OrdinalIgnoreCase)) text = text.Substring(1);
            // 去掉 -beta / +build 这类后缀，只留数字和点
            int cut = text.IndexOfAny(new[] { '-', '+' });
            if (cut > 0) text = text.Substring(0, cut);
            return text.Trim();
        }

        /// <summary>补齐成 4 段，Version.TryParse 才认 1.2 / 1.2.3。</summary>
        private static string Pad(string value)
        {
            string[] parts = value.Split('.');
            for (int index = parts.Length; index < 4; index += 1) value += ".0";
            return value;
        }
    }
}
