/*=====================================================================
   StarLaunch · 从官方启动器导入登录状态
   ---------------------------------------------------------------------
   微软已经不允许「没有目录（租户）」的个人账号注册 Azure 应用，而白嫖一个
   目录又要订阅 / 学生认证。绕开的办法是：官方启动器自己已经有一套有效的
   微软登录状态，它把 Minecraft 访问令牌明文写在 launcher_accounts.json 里
   —— 这里直接读出来、校验一次，存成启动器自己的账户档案。

   两份文件都要看：
     %APPDATA%\.minecraft\launcher_accounts.json          传统版启动器
     %APPDATA%\.minecraft\launcher_accounts_microsoft_store.json
     %LOCALAPPDATA%\Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe\
         LocalCache\Local\.minecraft\launcher_accounts.json  商店版启动器

   注意：官方启动器不会把 refresh_token 交出来，令牌大约 24 小时过期。
   过期之后只能回官方启动器重登一次再导入 —— 界面上写清楚了。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>官方启动器里的一份账号记录（只挑用得上的字段）。</summary>
    internal sealed class LauncherAccountCandidate
    {
        public string Name { get; set; } = string.Empty;
        public string Uuid { get; set; } = string.Empty;
        public string AccessToken { get; set; } = string.Empty;
        public string? RefreshToken { get; set; }
        /// <summary>令牌过期时间（epoch 毫秒，0 = 不知道）。</summary>
        public long ExpiresAt { get; set; }
        public string SourceFile { get; set; } = string.Empty;
    }

    internal sealed class OfficialProfile
    {
        public string Name { get; set; } = string.Empty;
        public string Uuid { get; set; } = string.Empty;
        public string? SkinUrl { get; set; }
        public string? SkinModel { get; set; }
    }

    internal static class OfficialLauncherImport
    {
        private const string ProfileUrl = "https://api.minecraftservices.com/minecraft/profile";
        private const string LiveTokenUrl = "https://login.live.com/oauth20_token.srf";

        /// <summary>官方启动器（以及 Minecraft 自带的那些工具）用的公开应用身份。</summary>
        private const string LiveClientId = "00000000402b5328";
        private const string LiveScope = "service::user.auth.xboxlive.com::MBI_SSL";

        public const string ImportDescription = "微软账户（官方启动器导入）";

        /// <summary>会不会去找这些文件（界面上「没找到」时照着它提示）。</summary>
        public static IReadOnlyList<string> CandidatePaths()
        {
            var list = new List<string>();

            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (!string.IsNullOrEmpty(roaming))
            {
                string mc = Path.Combine(roaming, ".minecraft");
                list.Add(Path.Combine(mc, "launcher_accounts.json"));
                list.Add(Path.Combine(mc, "launcher_accounts_microsoft_store.json"));
            }

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrEmpty(local))
            {
                string store = Path.Combine(local, "Packages",
                    "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Local", ".minecraft");
                list.Add(Path.Combine(store, "launcher_accounts.json"));
                list.Add(Path.Combine(store, "launcher_accounts_microsoft_store.json"));
            }

            return list;
        }

        public static IReadOnlyList<string> ExistingPaths()
        {
            var found = new List<string>();
            foreach (string path in CandidatePaths())
            {
                try
                {
                    if (File.Exists(path)) found.Add(path);
                }
                catch (Exception)
                {
                    // 路径本身有问题就跳过
                }
            }
            return found;
        }

        /// <summary>
        /// 读遍所有能找到的官方启动器档案，把其中还能用的账号存进 accounts.json。
        /// 返回成功导入的档案和一条条给人看的错误说明。
        /// </summary>
        public static Task<(List<AccountRecord> Imported, List<string> Errors)> ImportAsync(
            CancellationToken token)
        {
            return ImportPathsAsync(ExistingPaths(), token);
        }

        /// <summary>用户自己挑的那个文件（便携版 / 换过目录的官方启动器）。</summary>
        public static Task<(List<AccountRecord> Imported, List<string> Errors)> ImportFileAsync(
            string path, CancellationToken token)
        {
            var paths = new List<string>();
            if (!string.IsNullOrWhiteSpace(path)) paths.Add(path!);
            return ImportPathsAsync(paths, token);
        }

        private static async Task<(List<AccountRecord> Imported, List<string> Errors)> ImportPathsAsync(
            IReadOnlyList<string> paths, CancellationToken token)
        {
            var imported = new List<AccountRecord>();
            var errors = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (paths.Count == 0)
            {
                return (imported, errors);
            }

            foreach (string path in paths)
            {
                JsonDocument document;
                try
                {
                    document = JsonDocument.Parse(File.ReadAllText(path));
                }
                catch (Exception ex)
                {
                    errors.Add(Path.GetFileName(path) + " 读不出来：" + ex.Message);
                    continue;
                }

                using (document)
                {
                    if (!document.RootElement.TryGetProperty("accounts", out var accounts) ||
                        accounts.ValueKind != JsonValueKind.Object)
                    {
                        errors.Add(Path.GetFileName(path) + " 里没有 accounts 字段，可能不是官方启动器的文件");
                        continue;
                    }

                    foreach (var entry in accounts.EnumerateObject())
                    {
                        var candidate = ReadCandidate(entry.Value, path);
                        if (candidate == null) continue;
                        if (!seen.Add(candidate.Uuid + "|" + candidate.Name)) continue;

                        try
                        {
                            var record = await MaterializeAsync(candidate, token).ConfigureAwait(false);
                            if (record == null)
                            {
                                errors.Add(candidate.Name + "：官方启动器里的令牌已经失效，请在官方启动器里重新登录一次再导入");
                                continue;
                            }
                            imported.Add(AccountStore.Save(record));
                        }
                        catch (OperationCanceledException)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            errors.Add(candidate.Name + "：" + ex.Message);
                        }
                    }
                }
            }

            return (imported, errors);
        }

        /* -----------------------------------------------------------------
           解析
           ----------------------------------------------------------------- */

        private static LauncherAccountCandidate? ReadCandidate(JsonElement element, string path)
        {
            if (element.ValueKind != JsonValueKind.Object) return null;

            string accessToken = ReadString(element, "accessToken");
            if (accessToken.Length == 0) return null;

            string name = string.Empty;
            string uuid = string.Empty;
            if (element.TryGetProperty("minecraftProfile", out var profile) &&
                profile.ValueKind == JsonValueKind.Object)
            {
                name = ReadString(profile, "name");
                uuid = Uuids.Normalize(ReadString(profile, "id"));
            }

            // 档案里没有角色信息说明这个账号没进过游戏，导入也没用
            if (name.Length == 0 || uuid.Length == 0) return null;

            return new LauncherAccountCandidate
            {
                Name = name,
                Uuid = uuid,
                AccessToken = accessToken,
                RefreshToken = NullIfEmpty(ReadString(element, "refreshToken")),
                ExpiresAt = ReadExpiry(element),
                SourceFile = path
            };
        }

        private static long ReadExpiry(JsonElement element)
        {
            if (!element.TryGetProperty("expiresAt", out var value)) return 0;

            if (value.ValueKind == JsonValueKind.String)
            {
                return DateTimeOffset.TryParse(
                    value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal,
                    out var parsed)
                    ? parsed.ToUnixTimeMilliseconds()
                    : 0;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long raw))
            {
                // 有的版本写的是秒
                return raw > 100000000000L ? raw : raw * 1000L;
            }

            return 0;
        }

        /* -----------------------------------------------------------------
           校验 / 刷新 / 组装档案
           ----------------------------------------------------------------- */

        private static async Task<AccountRecord?> MaterializeAsync(
            LauncherAccountCandidate candidate, CancellationToken token)
        {
            try
            {
                var profile = await FetchProfileAsync(candidate.AccessToken, token).ConfigureAwait(false);
                return Build(candidate, profile, candidate.AccessToken, candidate.RefreshToken, candidate.ExpiresAt);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HttpError)
            {
                // 令牌大概率过期了；有 refresh_token 就试着换一张（官方启动器很少给）
            }
            catch (JsonException)
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(candidate.RefreshToken)) return null;

            var refreshed = await TryRefreshAsync(candidate.RefreshToken!, token).ConfigureAwait(false);
            if (refreshed == null) return null;

            try
            {
                var profile = await FetchProfileAsync(refreshed.Value.AccessToken, token).ConfigureAwait(false);
                return Build(candidate, profile, refreshed.Value.AccessToken, candidate.RefreshToken,
                    refreshed.Value.ExpiresAt);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static AccountRecord Build(
            LauncherAccountCandidate candidate, OfficialProfile profile, string accessToken,
            string? refreshToken, long expiresAt)
        {
            string uuid = Uuids.Normalize(profile.Uuid);
            if (uuid.Length == 0) uuid = candidate.Uuid;

            var account = new AccountRecord
            {
                Type = "ms",
                Name = profile.Name.Length > 0 ? profile.Name : candidate.Name,
                Uuid = uuid,
                AccessToken = accessToken,
                RefreshToken = NullIfEmpty(refreshToken),
                // 刷新令牌是官方应用签的，续期时也得用它
                ClientId = NullIfEmpty(refreshToken) == null ? null : LiveClientId,
                Description = ImportDescription,
                ExpiresAt = expiresAt,
                SkinUrl = profile.SkinUrl,
                SkinModel = string.IsNullOrWhiteSpace(profile.SkinModel) ? "classic" : profile.SkinModel
            };
            account.Id = AccountStore.MakeId(account);
            return account;
        }

        private static async Task<OfficialProfile> FetchProfileAsync(string accessToken, CancellationToken token)
        {
            var headers = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("Authorization", "Bearer " + accessToken)
            };

            string body = await JsonHttp.GetStringAsync(ProfileUrl, token, headers).ConfigureAwait(false);
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;

            var profile = new OfficialProfile
            {
                Uuid = Uuids.Normalize(ReadString(root, "id")),
                Name = ReadString(root, "name")
            };

            if (root.TryGetProperty("skins", out var skins) &&
                skins.ValueKind == JsonValueKind.Array && skins.GetArrayLength() > 0)
            {
                foreach (var skin in skins.EnumerateArray())
                {
                    string state = ReadString(skin, "state");
                    if (state.Length > 0 && !state.Equals("ACTIVE", StringComparison.OrdinalIgnoreCase)) continue;
                    profile.SkinUrl = ReadString(skin, "url");
                    profile.SkinModel = ReadString(skin, "variant");
                    if (!string.IsNullOrWhiteSpace(profile.SkinUrl)) break;
                }
            }

            if (profile.Name.Length == 0)
            {
                throw new HttpError("官方启动器里的令牌已经失效");
            }
            return profile;
        }

        private static async Task<(string AccessToken, long ExpiresAt)?> TryRefreshAsync(
            string refreshToken, CancellationToken token)
        {
            var form = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("client_id", LiveClientId),
                new KeyValuePair<string, string>("refresh_token", refreshToken),
                new KeyValuePair<string, string>("grant_type", "refresh_token"),
                new KeyValuePair<string, string>("scope", LiveScope)
            };

            try
            {
                using var document = await JsonHttp
                    .PostFormAsync(LiveTokenUrl, form, token).ConfigureAwait(false);

                var root = document.RootElement;
                string access = ReadString(root, "access_token");
                int expiresIn = ReadInt(root, "expires_in", 0);
                if (access.Length == 0) return null;

                long expiresAt = expiresIn > 0
                    ? DateTimeOffset.UtcNow.AddSeconds(expiresIn).ToUnixTimeMilliseconds()
                    : 0;
                return (access, expiresAt);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /* -----------------------------------------------------------------
           小工具
           ----------------------------------------------------------------- */

        private static string ReadString(JsonElement element, string name)
        {
            return element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? (value.GetString() ?? string.Empty)
                : string.Empty;
        }

        private static int ReadInt(JsonElement element, string name, int fallback)
        {
            if (!element.TryGetProperty(name, out var value)) return fallback;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int number)) return number;
            if (value.ValueKind == JsonValueKind.String &&
                int.TryParse(value.GetString(), out number)) return number;
            return fallback;
        }

        private static string? NullIfEmpty(string? value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value!.Trim();
        }
    }
}
