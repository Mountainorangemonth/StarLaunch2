/*=====================================================================
   StarLaunch · 外置登录（authlib-injector）
   ---------------------------------------------------------------------
   「外置登录」= 一套自己的 Yggdrasil 验证服务器（LittleSkin、Blessing Skin、
   各种自建服），登录接口和 Mojang 的老 API 一样。启动时还要靠
   authlib-injector.jar 把游戏的验证地址改成这台服务器。

   这里做四件事：
     · 地址发现：HEAD 目标地址，读 X-Authlib-Injector-Api-Location 头，
       顺便把 meta 里的服务器名和注册链接读出来；
     · 登录 / 刷新 / 验证 / 注销：/authserver/*；
     · 皮肤：/sessionserver/session/minecraft/profile/<uuid> 的 textures；
     · 准备 authlib-injector.jar（失败不影响登录，只是启动参数里缺一段）。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>一台验证服务器被发现出来的信息。</summary>
    internal sealed class AuthServerInfo
    {
        /// <summary>真正的 API 根地址（可能和用户输入的地址不同）。</summary>
        public string ApiRoot { get; set; } = string.Empty;
        public string ServerName { get; set; } = string.Empty;
        public string? RegisterUrl { get; set; }
        public string? HomepageUrl { get; set; }
    }

    /// <summary>一个角色（Yggdrasil 的 profile）。</summary>
    internal sealed class AuthProfile
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    /// <summary>一次登录 / 刷新拿到的会话。</summary>
    internal sealed class AuthSession
    {
        public string AccessToken { get; set; } = string.Empty;
        public string ClientToken { get; set; } = string.Empty;
        public string? UserId { get; set; }
        public List<AuthProfile> Profiles { get; set; } = new List<AuthProfile>();
        public AuthProfile? Selected { get; set; }
    }

    internal static class AuthlibAuth
    {
        /// <summary>authlib-injector 本体（官方源 + BMCLAPI 镜像）。</summary>
        private const string InjectorSource = "https://authlib-injector.yushi.moe/artifact/latest.json";
        private const string InjectorMirror = "https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json";

        private static readonly object InjectorGate = new object();
        private static string? _injectorPath;
        private static Task<string?>? _injectorTask;

        /* -----------------------------------------------------------------
           地址
           ----------------------------------------------------------------- */

        /// <summary>补全协议、去掉结尾斜杠。用户可能只填了「littleskin.cn」。</summary>
        public static string NormalizeServer(string? input)
        {
            string text = (input ?? string.Empty).Trim();
            if (text.Length == 0) return string.Empty;

            if (!text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                text = "https://" + text;
            }
            return text.TrimEnd('/');
        }

        /// <summary>
        /// 找到真正的 API 根地址。
        /// authlib-injector 的约定是：任意地址都可以，服务器用 X-Authlib-Injector-Api-Location
        /// 响应头指向真正的 API；没有这个头就当输入的地址本身就是 API。
        /// </summary>
        public static async Task<AuthServerInfo> DiscoverAsync(string server, CancellationToken token)
        {
            string normalized = NormalizeServer(server);
            if (normalized.Length == 0) throw new HttpError("请先填写验证服务器地址");

            string apiRoot = normalized;
            try
            {
                var headers = await JsonHttp
                    .GetHeadersAsync(System.Net.Http.HttpMethod.Head, normalized, token)
                    .ConfigureAwait(false);
                if (headers.TryGetValue("X-Authlib-Injector-Api-Location", out var values) &&
                    values.Length > 0 && !string.IsNullOrWhiteSpace(values[0]))
                {
                    apiRoot = ResolveLocation(normalized, values[0]);
                }
            }
            catch (HttpError)
            {
                // 有些服务器不允许 HEAD：直接用输入的地址继续
            }

            var info = new AuthServerInfo { ApiRoot = apiRoot, ServerName = HostOf(apiRoot) };

            try
            {
                using var document = await JsonHttp.GetJsonAsync(apiRoot, token).ConfigureAwait(false);
                var root = document.RootElement;
                if (root.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Object)
                {
                    string name = ReadString(meta, "serverName");
                    if (name.Length > 0) info.ServerName = name;

                    if (meta.TryGetProperty("links", out var links) && links.ValueKind == JsonValueKind.Object)
                    {
                        string register = ReadString(links, "register");
                        if (register.Length > 0) info.RegisterUrl = register;
                        string homepage = ReadString(links, "homepage");
                        if (homepage.Length > 0) info.HomepageUrl = homepage;
                    }
                }
            }
            catch (HttpError)
            {
                // meta 读不到不算失败：登录接口照样能用，只是没有服务器名字
            }

            return info;
        }

        /// <summary>解析 API 地址：支持相对路径，禁止 https 降级成 http。</summary>
        private static string ResolveLocation(string baseUrl, string location)
        {
            string text = location.Trim();
            try
            {
                var baseUri = new Uri(baseUrl);
                if (text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                    text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    var target = new Uri(text);
                    if (baseUri.Scheme == Uri.UriSchemeHttps && target.Scheme == Uri.UriSchemeHttp)
                    {
                        return "https://" + target.Host + target.PathAndQuery.TrimEnd('/');
                    }
                    return target.ToString().TrimEnd('/');
                }
                return new Uri(baseUri, text).ToString().TrimEnd('/');
            }
            catch (UriFormatException)
            {
                return baseUrl;
            }
        }

        public static string HostOf(string url)
        {
            try
            {
                return new Uri(url).Host;
            }
            catch (UriFormatException)
            {
                return url;
            }
        }

        /* -----------------------------------------------------------------
           登录 / 刷新 / 验证 / 注销
           ----------------------------------------------------------------- */

        public static async Task<AuthSession> AuthenticateAsync(
            string apiRoot, string username, string password, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(username)) throw new HttpError("请填写用户名（邮箱）");
            if (string.IsNullOrWhiteSpace(password)) throw new HttpError("请填写密码");

            string clientToken = Guid.NewGuid().ToString("n");
            var payload = new Dictionary<string, object?>
            {
                ["agent"] = new Dictionary<string, object?>
                {
                    ["name"] = "Minecraft",
                    ["version"] = 1
                },
                ["username"] = username.Trim(),
                ["password"] = password,
                ["clientToken"] = clientToken,
                ["requestUser"] = true
            };

            try
            {
                using var document = await JsonHttp
                    .PostJsonAsync(apiRoot + "/authserver/authenticate", payload, token)
                    .ConfigureAwait(false);
                var session = ParseSession(document.RootElement);
                if (session.ClientToken.Length == 0) session.ClientToken = clientToken;
                return session;
            }
            catch (HttpError ex)
            {
                throw new HttpError(TranslateAuthError(ex.Message, apiRoot));
            }
        }

        /// <summary>把 accessToken 换成新的，并（可选）切换到指定角色。</summary>
        public static async Task<AuthSession> RefreshAsync(
            string apiRoot, string accessToken, string clientToken, AuthProfile? profile, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["accessToken"] = accessToken,
                ["clientToken"] = clientToken
            };
            if (profile != null)
            {
                payload["selectedProfile"] = new Dictionary<string, object?>
                {
                    ["id"] = profile.Id,
                    ["name"] = profile.Name
                };
            }

            try
            {
                using var document = await JsonHttp
                    .PostJsonAsync(apiRoot + "/authserver/refresh", payload, token)
                    .ConfigureAwait(false);
                var session = ParseSession(document.RootElement);
                if (session.ClientToken.Length == 0) session.ClientToken = clientToken;
                return session;
            }
            catch (HttpError ex)
            {
                throw new HttpError(TranslateAuthError(ex.Message, apiRoot));
            }
        }

        /// <summary>令牌还有效吗（validate 返回 204 才算有效）。</summary>
        public static async Task<bool> ValidateAsync(
            string apiRoot, string accessToken, string clientToken, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["accessToken"] = accessToken,
                ["clientToken"] = clientToken
            };
            int status = await JsonHttp
                .SendStatusAsync(System.Net.Http.HttpMethod.Post, apiRoot + "/authserver/validate", token, null, payload)
                .ConfigureAwait(false);
            return status == 204 || status == 200;
        }

        /// <summary>让服务器作废这个令牌（退出登录时尽力而为，失败也不影响本地删除）。</summary>
        public static async Task InvalidateAsync(
            string apiRoot, string accessToken, string clientToken, CancellationToken token)
        {
            var payload = new Dictionary<string, object?>
            {
                ["accessToken"] = accessToken,
                ["clientToken"] = clientToken
            };
            try
            {
                await JsonHttp.SendStatusAsync(
                    System.Net.Http.HttpMethod.Post, apiRoot + "/authserver/invalidate", token, null, payload)
                    .ConfigureAwait(false);
            }
            catch (HttpError)
            {
                // 服务器已经下线 / 令牌早就失效，都不该拦住「退出登录」
            }
        }

        /* -----------------------------------------------------------------
           皮肤
           ----------------------------------------------------------------- */

        /// <summary>从验证服读皮肤直链和模型（拿不到就返回 (null, null)）。</summary>
        public static async Task<(string? Url, string? Model)> FetchSkinAsync(
            string apiRoot, string uuid, CancellationToken token)
        {
            try
            {
                string url = apiRoot + "/sessionserver/session/minecraft/profile/" + uuid;
                string body = await JsonHttp.GetStringAsync(url, token).ConfigureAwait(false);
                return ParseTextures(body);
            }
            catch (Exception ex) when (ex is HttpError || ex is JsonException || ex is FormatException)
            {
                return (null, null);
            }
        }

        /// <summary>解析 profile 响应里 base64 的 textures 属性。</summary>
        private static (string? Url, string? Model) ParseTextures(string profileBody)
        {
            using var document = JsonDocument.Parse(profileBody);
            var root = document.RootElement;
            if (!root.TryGetProperty("properties", out var properties) ||
                properties.ValueKind != JsonValueKind.Array)
            {
                return (null, null);
            }

            foreach (var property in properties.EnumerateArray())
            {
                if (!ReadString(property, "name").Equals("textures", StringComparison.OrdinalIgnoreCase)) continue;

                string encoded = ReadString(property, "value");
                if (encoded.Length == 0) continue;

                string json = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
                using var textures = JsonDocument.Parse(json);
                if (!textures.RootElement.TryGetProperty("textures", out var map) ||
                    map.ValueKind != JsonValueKind.Object) return (null, null);

                if (!map.TryGetProperty("SKIN", out var skin) || skin.ValueKind != JsonValueKind.Object)
                    return (null, null);

                string? url = ReadString(skin, "url") is { Length: > 0 } value ? value : null;
                string? model = null;
                if (skin.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object)
                {
                    string variant = ReadString(meta, "model");
                    if (variant.Length > 0) model = variant;
                }
                return (url, model);
            }

            return (null, null);
        }

        /* -----------------------------------------------------------------
           authlib-injector.jar
           ----------------------------------------------------------------- */

        /// <summary>
        /// 确保 LauncherConfigStore.Folder\authlib-injector\authlib-injector.jar 存在。
        /// 只下载一次；失败返回 null（登录本身不受影响）。
        /// </summary>
        public static Task<string?> EnsureInjectorAsync(CancellationToken token)
        {
            lock (InjectorGate)
            {
                if (_injectorPath != null) return Task.FromResult<string?>(_injectorPath);
                if (_injectorTask != null) return _injectorTask;

                _injectorTask = Task.Run(async () =>
                {
                    try
                    {
                        string folder = Path.Combine(LauncherConfigStore.Folder, "authlib-injector");
                        Directory.CreateDirectory(folder);
                        string jar = Path.Combine(folder, "authlib-injector.jar");
                        string stamp = Path.Combine(folder, "version.txt");

                        string manifest = await ReadInjectorManifestAsync(token).ConfigureAwait(false);
                        if (manifest.Length == 0) return null;

                        using var document = JsonDocument.Parse(manifest);
                        var root = document.RootElement;
                        string version = ReadString(root, "version");
                        string download = ReadString(root, "download_url");
                        if (download.Length == 0) return null;

                        // 已经是这个版本就不重复下
                        if (File.Exists(jar) && File.Exists(stamp))
                        {
                            string existing = (await File.ReadAllTextAsync(stamp, token).ConfigureAwait(false)).Trim();
                            if (existing == version) return jar;
                        }

                        await JsonHttp.DownloadFileAsync(download, jar, null, null, token).ConfigureAwait(false);
                        await File.WriteAllTextAsync(stamp, version, token).ConfigureAwait(false);
                        _injectorPath = jar;
                        return jar;
                    }
                    catch (Exception)
                    {
                        // 镜像挂了 / 没网：下次再说，别让登录流程跟着失败
                        return null;
                    }
                }, token);

                return _injectorTask;
            }
        }

        /// <summary>已经准备好的 jar 路径（没准备就是 null）。</summary>
        public static string? InjectorPath => _injectorPath;

        /// <summary>给启动参数用的 JVM 参数片段：-javaagent:xxx.jar=https://服务器。</summary>
        public static string? BuildJvmArgument(string? server)
        {
            if (_injectorPath == null || string.IsNullOrWhiteSpace(server)) return null;
            return "-javaagent:\"" + _injectorPath + "\"=\"" + server!.TrimEnd('/') + "\"";
        }

        private static async Task<string> ReadInjectorManifestAsync(CancellationToken token)
        {
            try
            {
                return await JsonHttp.GetStringAsync(InjectorMirror, token).ConfigureAwait(false);
            }
            catch (HttpError)
            {
                return await JsonHttp.GetStringAsync(InjectorSource, token).ConfigureAwait(false);
            }
        }

        /* -----------------------------------------------------------------
           解析与文案
           ----------------------------------------------------------------- */

        private static AuthSession ParseSession(JsonElement root)
        {
            var session = new AuthSession
            {
                AccessToken = ReadString(root, "accessToken"),
                ClientToken = ReadString(root, "clientToken")
            };

            if (root.TryGetProperty("availableProfiles", out var profiles) &&
                profiles.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in profiles.EnumerateArray())
                {
                    string id = Uuids.Normalize(ReadString(item, "id"));
                    string name = ReadString(item, "name");
                    if (id.Length == 0 || name.Length == 0) continue;
                    session.Profiles.Add(new AuthProfile { Id = id, Name = name });
                }
            }

            if (root.TryGetProperty("selectedProfile", out var selected) &&
                selected.ValueKind == JsonValueKind.Object)
            {
                string id = Uuids.Normalize(ReadString(selected, "id"));
                string name = ReadString(selected, "name");
                if (id.Length > 0 && name.Length > 0)
                {
                    session.Selected = new AuthProfile { Id = id, Name = name };
                }
            }

            // 有的服务器不返回 selectedProfile，但只有一个角色：直接当选中
            if (session.Selected == null && session.Profiles.Count == 1)
            {
                session.Selected = session.Profiles[0];
            }

            if (root.TryGetProperty("user", out var user) && user.ValueKind == JsonValueKind.Object)
            {
                string userId = ReadString(user, "id");
                if (userId.Length > 0) session.UserId = userId;
            }

            if (session.AccessToken.Length == 0 && session.Selected == null && session.Profiles.Count == 0)
            {
                throw new HttpError("验证服务器没有返回登录信息");
            }
            return session;
        }

        /// <summary>
        /// Yggdrasil 的报错都是英文短句，翻成中文能让界面少一点猜谜。
        /// 认不出来的原样保留（后面跟着服务器地址，方便排查）。
        /// </summary>
        private static string TranslateAuthError(string message, string apiRoot)
        {
            string host = HostOf(apiRoot);
            if (message.IndexOf("Invalid credentials", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("ForbiddenOperationException", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "用户名或密码不对（" + host + "）";
            }
            if (message.IndexOf("Invalid token", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("Token expired", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "登录状态已过期，请重新登录（" + host + "）";
            }
            if (message.IndexOf("already signed in", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "这个账号已经在别处登录了，请先在那边退出（" + host + "）";
            }
            if (message.IndexOf("404", StringComparison.Ordinal) >= 0)
            {
                return "这个服务器没有 authlib-injector 接口，地址可能填错了（" + apiRoot + "）";
            }
            return message + "（" + host + "）";
        }

        private static string ReadString(JsonElement element, string name)
        {
            return element.ValueKind == JsonValueKind.Object &&
                   element.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? string.Empty
                : string.Empty;
        }
    }
}
