/*=====================================================================
   StarLaunch · 微软账户登录
   ---------------------------------------------------------------------
   流程和 PCL / 官方启动器一致，六步：

     ① 设备代码流拿 OAuth 令牌（登录页显示一串代码，用户在浏览器里输入）
     ② OAuth accessToken → Xbox Live 令牌（XBL）
     ③ XBL → XSTS 令牌 + UHS
     ④ XSTS → Minecraft accessToken
     ⑤ 查 entitlements，确认这个账号买过游戏
     ⑥ 查 profile，拿到角色名 / UUID / 皮肤

   刷新登录只要 ①（refresh_token 换新令牌）之后重新走 ②~⑥。

   需要先在 Azure 注册一个「允许公共客户端流」的应用，把它的 client_id
   填进设置（或者环境变量 MS_CLIENT_ID）。微软不允许启动器共用别人的应用身份。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>设备代码流的第一步结果：要显示给用户的那段信息。</summary>
    internal sealed class DeviceCodeInfo
    {
        public string DeviceCode { get; set; } = string.Empty;
        public string UserCode { get; set; } = string.Empty;
        public string VerificationUri { get; set; } = string.Empty;
        /// <summary>微软给的人话提示（一般是「在浏览器里打开 xxx 并输入代码」）。</summary>
        public string Message { get; set; } = string.Empty;
        public int ExpiresIn { get; set; } = 900;
        /// <summary>建议的轮询间隔（秒），服务端偶尔会要求放慢。</summary>
        public int Interval { get; set; } = 5;
    }

    /// <summary>OAuth 令牌对。</summary>
    internal sealed class OAuthTokens
    {
        public string AccessToken { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
        public int ExpiresIn { get; set; }
    }

    /// <summary>走完 Xbox 链路之后拿到的 Minecraft 身份。</summary>
    internal sealed class MinecraftIdentity
    {
        public string AccessToken { get; set; } = string.Empty;
        public long ExpiresAt { get; set; }
        public string Uuid { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? SkinUrl { get; set; }
        public string? SkinModel { get; set; }
    }

    internal static class MicrosoftAuth
    {
        public const string Scope = "XboxLive.signin offline_access";

        /// <summary>
        /// OAuth 的 authority（租户）。应用注册时选「任何组织目录中的帐户和个人」用
        /// consumers 就够了；如果注册时只勾了「仅此组织目录」，就必须换成租户域
        /// （contoso.onmicrosoft.com 或租户 ID），否则设备码请求会报 AADSTS700016。
        /// </summary>
        public const string DefaultAuthority = "consumers";

        private const string AuthorityBase = "https://login.microsoftonline.com/";

        private const string RefreshUrl = "https://login.live.com/oauth20_token.srf";
        private const string XblUrl = "https://user.auth.xboxlive.com/user/authenticate";
        private const string XstsUrl = "https://xsts.auth.xboxlive.com/xsts/authorize";
        private const string XboxLoginUrl = "https://api.minecraftservices.com/authentication/login_with_xbox";
        private const string EntitlementsUrl = "https://api.minecraftservices.com/entitlements/mcstore";
        private const string ProfileUrl = "https://api.minecraftservices.com/minecraft/profile";

        /* -----------------------------------------------------------------
           ① 设备代码流
           ----------------------------------------------------------------- */

        public static async Task<DeviceCodeInfo> RequestDeviceCodeAsync(
            string clientId, string? authority, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(clientId))
            {
                throw new HttpError("还没有填写微软应用 ID（client_id）");
            }

            var form = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("client_id", clientId.Trim()),
                new KeyValuePair<string, string>("scope", Scope)
            };

            using var document = await JsonHttp
                .PostFormAsync(DeviceCodeUrl(authority), form, token).ConfigureAwait(false);
            var root = document.RootElement;

            var info = new DeviceCodeInfo
            {
                DeviceCode = ReadString(root, "device_code"),
                UserCode = ReadString(root, "user_code"),
                VerificationUri = ReadString(root, "verification_uri"),
                Message = ReadString(root, "message"),
                ExpiresIn = ReadInt(root, "expires_in", 900),
                Interval = ReadInt(root, "interval", 5)
            };

            if (info.DeviceCode.Length == 0 || info.UserCode.Length == 0)
            {
                throw new HttpError("微软没有返回设备代码，可能这个应用没有开启「允许公共客户端流」");
            }
            if (info.VerificationUri.Length == 0) info.VerificationUri = "https://microsoft.com/link";
            if (info.Interval <= 0) info.Interval = 5;
            return info;
        }

        /// <summary>
        /// 轮询直到用户完成授权 / 超时 / 取消。
        /// onStatus 会收到「等待中…」之类的阶段提示，用来更新界面。
        /// </summary>
        public static async Task<OAuthTokens> PollDeviceCodeAsync(
            string clientId, DeviceCodeInfo info, string? authority,
            Action<string>? onStatus, CancellationToken token)
        {
            int interval = Math.Max(2, info.Interval);
            DateTimeOffset deadline = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, info.ExpiresIn));
            onStatus?.Invoke("等待浏览器授权…");

            while (DateTimeOffset.UtcNow < deadline)
            {
                token.ThrowIfCancellationRequested();
                await Task.Delay(TimeSpan.FromSeconds(interval), token).ConfigureAwait(false);

                var form = new List<KeyValuePair<string, string>>
                {
                    new KeyValuePair<string, string>("client_id", clientId.Trim()),
                    new KeyValuePair<string, string>(
                        "grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    new KeyValuePair<string, string>("device_code", info.DeviceCode)
                };

                using var response = await PostFormRawAsync(TokenUrl(authority), form, token).ConfigureAwait(false);
                string body = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);

                if (response.IsSuccessStatusCode)
                {
                    var tokens = ParseTokens(body);
                    onStatus?.Invoke("授权成功，正在获取游戏档案…");
                    return tokens;
                }

                string error = ReadErrorCode(body);
                switch (error)
                {
                    case "authorization_pending":
                        onStatus?.Invoke("等待浏览器授权…");
                        continue;
                    case "slow_down":
                        interval += 5;
                        onStatus?.Invoke("服务器要求放慢轮询，继续等待…");
                        continue;
                    case "authorization_declined":
                        throw new HttpError("你在浏览器里拒绝了这次授权");
                    case "expired_token":
                        throw new HttpError("授权代码已过期，请重新开始登录");
                    case "bad_verification_code":
                        throw new HttpError("授权代码无效，请重新开始登录");
                    default:
                        throw new HttpError("授权失败：" + DescribeOAuthError(body, error));
                }
            }

            throw new HttpError("等待授权超时了，请重新开始登录");
        }

        /// <summary>用 refresh_token 换新的 OAuth 令牌（启动器重启后靠它免登录）。</summary>
        public static async Task<OAuthTokens> RefreshOAuthAsync(
            string clientId, string refreshToken, string? authority, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(refreshToken))
            {
                throw new HttpError("这个账户没有可用的刷新令牌，需要重新登录");
            }

            var form = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("client_id", clientId.Trim()),
                new KeyValuePair<string, string>("refresh_token", refreshToken),
                new KeyValuePair<string, string>("grant_type", "refresh_token"),
                new KeyValuePair<string, string>("scope", Scope)
            };

            // consumers / common 走 v1 的 login.live.com；指定租户时改走 v2 token 端点，
            // 因为只有 v2 端点认识租户限定的应用
            string url = NeedsV2Token(authority) ? TokenUrl(authority) : RefreshUrl;
            using var response = await PostFormRawAsync(url, form, token).ConfigureAwait(false);
            string body = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                string error = ReadErrorCode(body);
                // invalid_grant 一般是密码改了 / 账号被要求重新登录，只能重新走设备代码流
                if (error.IndexOf("invalid_grant", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    body.IndexOf("must sign in", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    body.IndexOf("password", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    throw new HttpError("登录状态已失效，需要重新登录这个微软账户");
                }
                throw new HttpError("刷新微软令牌失败：" + DescribeOAuthError(body, error));
            }

            // login.live.com 有时会把 refresh_token 原样返回，有时不发新的：旧的照样能用
            var tokens = ParseTokens(body);
            if (tokens.RefreshToken.Length == 0) tokens.RefreshToken = refreshToken;
            return tokens;
        }

        /* -----------------------------------------------------------------
           ②~⑥ Xbox 链路
           ----------------------------------------------------------------- */

        public static async Task<MinecraftIdentity> LoginWithXboxAsync(
            string oauthAccessToken, Action<string>? onStatus, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(oauthAccessToken))
            {
                throw new HttpError("OAuth 令牌是空的");
            }

            onStatus?.Invoke("正在验证 Xbox Live…");
            string xblToken = await RequestXblTokenAsync(oauthAccessToken, token).ConfigureAwait(false);

            onStatus?.Invoke("正在验证 XSTS…");
            var xsts = await RequestXstsAsync(xblToken, token).ConfigureAwait(false);

            onStatus?.Invoke("正在登录 Minecraft 服务…");
            var identity = await LoginToMinecraftAsync(xsts.Token, xsts.Uhs, token).ConfigureAwait(false);

            onStatus?.Invoke("正在读取游戏档案…");
            await FillProfileAsync(identity, token).ConfigureAwait(false);
            return identity;
        }

        private static async Task<string> RequestXblTokenAsync(string oauthAccessToken, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["Properties"] = new Dictionary<string, object?>
                {
                    ["AuthMethod"] = "RPS",
                    ["SiteName"] = "user.auth.xboxlive.com",
                    ["RpsTicket"] = "d=" + oauthAccessToken
                },
                ["RelyingParty"] = "http://auth.xboxlive.com",
                ["TokenType"] = "JWT"
            };

            var (status, body) = await PostJsonRawAsync(XblUrl, payload, token).ConfigureAwait(false);
            if (status < 200 || status >= 300)
            {
                throw new HttpError("Xbox Live 验证失败（HTTP " + status + "）：" + ShortBody(body));
            }

            using var document = JsonDocument.Parse(body);
            string xbl = ReadString(document.RootElement, "Token");
            if (xbl.Length == 0) throw new HttpError("Xbox Live 没有返回令牌");
            return xbl;
        }

        private static async Task<(string Token, string Uhs)> RequestXstsAsync(
            string xblToken, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["Properties"] = new Dictionary<string, object?>
                {
                    ["SandboxId"] = "RETAIL",
                    ["UserTokens"] = new[] { xblToken }
                },
                ["RelyingParty"] = "rp://api.minecraftservices.com/",
                ["TokenType"] = "JWT"
            };

            var (status, body) = await PostJsonRawAsync(XstsUrl, payload, token).ConfigureAwait(false);
            if (status < 200 || status >= 300)
            {
                throw new HttpError(DescribeXstsError(body, status));
            }

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            string xsts = ReadString(root, "Token");
            string uhs = string.Empty;

            if (root.TryGetProperty("DisplayClaims", out var claims) &&
                claims.ValueKind == JsonValueKind.Object &&
                claims.TryGetProperty("xui", out var xui) &&
                xui.ValueKind == JsonValueKind.Array && xui.GetArrayLength() > 0)
            {
                uhs = ReadString(xui[0], "uhs");
            }

            if (xsts.Length == 0 || uhs.Length == 0)
            {
                throw new HttpError("XSTS 没有返回完整的令牌");
            }
            return (xsts, uhs);
        }

        private static async Task<MinecraftIdentity> LoginToMinecraftAsync(
            string xstsToken, string uhs, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["identityToken"] = "XBL3.0 x=" + uhs + ";" + xstsToken
            };

            var (status, body) = await PostJsonRawAsync(XboxLoginUrl, payload, token).ConfigureAwait(false);
            if (status < 200 || status >= 300)
            {
                // 401/403 基本上就是没买游戏或者账号不在 Xbox 网络里
                throw new HttpError("登录 Minecraft 服务失败（HTTP " + status + "）：" + ShortBody(body));
            }

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            var identity = new MinecraftIdentity
            {
                AccessToken = ReadString(root, "access_token"),
                ExpiresAt = 0
            };

            int expiresIn = ReadInt(root, "expires_in", 0);
            if (expiresIn > 0)
            {
                identity.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresIn).ToUnixTimeMilliseconds();
            }

            if (identity.AccessToken.Length == 0)
            {
                throw new HttpError("Minecraft 服务没有返回访问令牌");
            }
            return identity;
        }

        /// <summary>确认这个账号真的拥有游戏，并读出角色名 / UUID / 皮肤。</summary>
        private static async Task FillProfileAsync(MinecraftIdentity identity, CancellationToken token)
        {
            var authHeaders = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("Authorization", "Bearer " + identity.AccessToken)
            };

            // entitlements：没有 items 说明账号没买游戏（XGP 也算持有）
            string entitlementsBody = await JsonHttp
                .GetStringAsync(EntitlementsUrl, token, authHeaders).ConfigureAwait(false);
            using (var entitlements = JsonDocument.Parse(entitlementsBody))
            {
                bool owns = entitlements.RootElement.TryGetProperty("items", out var items) &&
                    items.ValueKind == JsonValueKind.Array && items.GetArrayLength() > 0;
                if (!owns)
                {
                    throw new HttpError("这个微软账户没有 Minecraft: Java Edition 的拥有记录");
                }
            }

            string profile;
            try
            {
                profile = await JsonHttp.GetStringAsync(ProfileUrl, token, authHeaders).ConfigureAwait(false);
            }
            catch (HttpError ex)
            {
                // 404 = 账号买了游戏但还没创建过角色名（需要去官网起个名字）
                if (ex.Message.IndexOf("404", StringComparison.Ordinal) >= 0)
                {
                    throw new HttpError("这个账号还没有 Minecraft 角色名，请先在 minecraft.net 创建角色再登录");
                }
                throw;
            }

            using var document = JsonDocument.Parse(profile);
            var root = document.RootElement;
            identity.Uuid = Uuids.Normalize(ReadString(root, "id"));
            identity.Name = ReadString(root, "name");

            if (root.TryGetProperty("skins", out var skins) &&
                skins.ValueKind == JsonValueKind.Array && skins.GetArrayLength() > 0)
            {
                foreach (var skin in skins.EnumerateArray())
                {
                    string state = ReadString(skin, "state");
                    if (state.Length > 0 && !state.Equals("ACTIVE", StringComparison.OrdinalIgnoreCase)) continue;
                    identity.SkinUrl = ReadString(skin, "url");
                    identity.SkinModel = ReadString(skin, "variant");
                    if (!string.IsNullOrWhiteSpace(identity.SkinUrl)) break;
                }
            }

            if (identity.Uuid.Length == 0 || identity.Name.Length == 0)
            {
                throw new HttpError("游戏档案里没有角色信息");
            }
        }

        /* -----------------------------------------------------------------
           小工具
           ----------------------------------------------------------------- */

        private static async Task<HttpResponseMessage> PostFormRawAsync(
            string url, IEnumerable<KeyValuePair<string, string>> form, CancellationToken token)
        {
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new FormUrlEncodedContent(form)
                };
                return await JsonHttp.Client.SendAsync(request, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HttpRequestException ex)
            {
                throw new HttpError("连不上微软登录服务器：" + ex.Message);
            }
        }

        private static async Task<(int Status, string Body)> PostJsonRawAsync(
            string url, object payload, CancellationToken token)
        {
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
                };
                using var response = await JsonHttp.Client.SendAsync(request, token).ConfigureAwait(false);
                string body = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
                return ((int)response.StatusCode, body);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HttpRequestException ex)
            {
                throw new HttpError("连不上 Xbox 验证服务器：" + ex.Message);
            }
        }

        private static OAuthTokens ParseTokens(string body)
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            return new OAuthTokens
            {
                AccessToken = ReadString(root, "access_token"),
                RefreshToken = ReadString(root, "refresh_token"),
                ExpiresIn = ReadInt(root, "expires_in", 0)
            };
        }

        /// <summary>把 authority 收敛成一段安全的路径（只留字母数字、点、横线）。</summary>
        public static string NormalizeAuthority(string? authority)
        {
            string raw = (authority ?? string.Empty).Trim().Trim('/');
            if (raw.Length == 0) return DefaultAuthority;

            var builder = new System.Text.StringBuilder(raw.Length);
            foreach (char ch in raw.ToLowerInvariant())
            {
                bool ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '.' || ch == '-';
                if (ok) builder.Append(ch);
            }
            string cleaned = builder.ToString();
            return cleaned.Length == 0 ? DefaultAuthority : cleaned;
        }

        /// <summary>consumers / common / organizations 是「无租户」的那三个。</summary>
        private static bool NeedsV2Token(string? authority)
        {
            string value = NormalizeAuthority(authority);
            return value != DefaultAuthority && value != "common" && value != "organizations";
        }

        private static string DeviceCodeUrl(string? authority) =>
            AuthorityBase + NormalizeAuthority(authority) + "/oauth2/v2.0/devicecode";

        private static string TokenUrl(string? authority) =>
            AuthorityBase + NormalizeAuthority(authority) + "/oauth2/v2.0/token";

        private static string ReadErrorCode(string body)
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                return ReadString(document.RootElement, "error").ToLowerInvariant();
            }
            catch (JsonException)
            {
                return string.Empty;
            }
        }

        private static string DescribeOAuthError(string body, string error)
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                string description = ReadString(document.RootElement, "error_description");
                if (description.Length > 0) return description;
            }
            catch (JsonException)
            {
                // 落到下面的兜底
            }
            return error.Length > 0 ? error : ShortBody(body);
        }

        /// <summary>把 XSTS 的 XErr 码翻译成用户能理解的原因（和 PCL 用的是同一批码）。</summary>
        private static string DescribeXstsError(string body, int status)
        {
            if (body.IndexOf("2148916227", StringComparison.Ordinal) >= 0)
                return "这个 Xbox 账号已被封禁";
            if (body.IndexOf("2148916233", StringComparison.Ordinal) >= 0)
                return "这个微软账户还没有 Xbox Live 档案，请先在 xbox.com 登录并创建一个";
            if (body.IndexOf("2148916235", StringComparison.Ordinal) >= 0)
                return "Xbox Live 在你所在的国家 / 地区不可用";
            if (body.IndexOf("2148916236", StringComparison.Ordinal) >= 0 ||
                body.IndexOf("2148916237", StringComparison.Ordinal) >= 0)
                return "这个账号需要先在 xbox.com 完成成人验证";
            if (body.IndexOf("2148916238", StringComparison.Ordinal) >= 0)
                return "这是未成年账户，需要由家庭组里的成年人添加到家庭后才能登录";
            return "XSTS 验证失败（HTTP " + status + "）：" + ShortBody(body);
        }

        private static string ShortBody(string body)
        {
            string text = (body ?? string.Empty).Trim().Replace("\r", " ").Replace("\n", " ");
            return text.Length > 200 ? text.Substring(0, 200) + "…" : text;
        }

        private static string ReadString(JsonElement element, string name)
        {
            return element.ValueKind == JsonValueKind.Object &&
                   element.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? string.Empty
                : string.Empty;
        }

        private static int ReadInt(JsonElement element, string name, int fallback)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            {
                return fallback;
            }
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int number)) return number;
            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out int parsed)) return parsed;
            return fallback;
        }
    }
}
