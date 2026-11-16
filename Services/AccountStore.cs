/*=====================================================================
   StarLaunch · 账户档案
   ---------------------------------------------------------------------
   三种登录方式共用一份档案（PCL 的 ModProfile 也是这么存的）：
     · ms      微软账户      —— accessToken 是 Minecraft 的令牌，refreshToken 是 OAuth 的
     · authlib 外置登录      —— server 是 authlib-injector 的 API 根地址
     · offline 离线登录      —— 只有名字和一个按规则算出来的 UUID

   存放位置：配置目录里的 accounts.json（和 StarLaunch.config.json 同目录）。
   令牌是明文存的，和 PCL / HMCL 一样 —— 文件权限靠系统账户隔离，别把它分享出去。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StarLaunch.Services
{
    /// <summary>一个账号。字段名直接就是 accounts.json 里的键，同时也是网页读到的名字。</summary>
    internal sealed class AccountRecord
    {
        /// <summary>稳定 ID：ms/offline 用 uuid，authlib 再加上服务器主机名（同一个 UUID 可能来自不同服）。</summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>ms / authlib / offline。</summary>
        public string Type { get; set; } = "offline";

        /// <summary>角色名（游戏里显示的那个）。</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>角色 UUID（32 位无横线小写）。</summary>
        public string Uuid { get; set; } = string.Empty;

        /// <summary>进游戏用的令牌（离线登录是 "-"）。</summary>
        public string AccessToken { get; set; } = string.Empty;

        /// <summary>微软 OAuth refresh_token / authlib 的 refreshToken。</summary>
        public string? RefreshToken { get; set; }

        /// <summary>authlib 的 clientToken（外置登录自己生成，刷新时要原样带回去）。</summary>
        public string? ClientToken { get; set; }

        /// <summary>authlib-injector 的 API 根地址，例如 https://littleskin.cn/api/yggdrasil。</summary>
        public string? Server { get; set; }

        /// <summary>验证服务器显示名（meta.serverName）。</summary>
        public string? ServerName { get; set; }

        /// <summary>authlib 的 userId（一般用不上，留着方便排查）。</summary>
        public string? UserId { get; set; }

        /// <summary>登录这个微软账户时用的 client_id：换过应用 ID 后旧令牌才刷不动。</summary>
        public string? ClientId { get; set; }

        /// <summary>给人看的登录方式说明：微软账户 / LittleSkin / 离线登录…</summary>
        public string? Description { get; set; }

        /// <summary>令牌过期时间（epoch 毫秒，0 = 不知道 / 不会过期）。</summary>
        public long ExpiresAt { get; set; }

        /// <summary>classic / slim，目前只用于展示。</summary>
        public string? SkinModel { get; set; }

        /// <summary>皮肤直链（Mojang 或验证服的 textures 地址）。</summary>
        public string? SkinUrl { get; set; }

        public long CreatedAt { get; set; }

        /// <summary>上次登录时间（epoch 毫秒）。</summary>
        public long LastLogin { get; set; }

        /// <summary>令牌是不是快过期了（提前 2 分钟算过期，够刷新一次）。</summary>
        public bool IsExpired => ExpiresAt > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > ExpiresAt - 120000;

        /// <summary>给网页看的版本：不带任何令牌。</summary>
        public Dictionary<string, object?> ToView()
        {
            return new Dictionary<string, object?>
            {
                ["id"] = Id,
                ["type"] = Type,
                ["name"] = Name,
                ["uuid"] = Uuid,
                ["uuidDashed"] = Uuids.WithDashes(Uuid),
                ["server"] = Server,
                ["serverName"] = ServerName,
                ["description"] = Description,
                ["expiresAt"] = ExpiresAt,
                ["expired"] = IsExpired,
                ["skinModel"] = SkinModel,
                ["hasSkin"] = !string.IsNullOrWhiteSpace(SkinUrl),
                ["createdAt"] = CreatedAt,
                ["lastLogin"] = LastLogin,
                ["skin"] = "/api/skin?account=" + Uri.EscapeDataString(Id)
            };
        }

        public AccountRecord Clone()
        {
            return new AccountRecord
            {
                Id = Id,
                Type = Type,
                Name = Name,
                Uuid = Uuid,
                AccessToken = AccessToken,
                RefreshToken = RefreshToken,
                ClientToken = ClientToken,
                Server = Server,
                ServerName = ServerName,
                UserId = UserId,
                ClientId = ClientId,
                Description = Description,
                ExpiresAt = ExpiresAt,
                SkinModel = SkinModel,
                SkinUrl = SkinUrl,
                CreatedAt = CreatedAt,
                LastLogin = LastLogin
            };
        }
    }

    /// <summary>UUID 的小工具：游戏只认 32 位无横线，界面上习惯带横线。</summary>
    internal static class Uuids
    {
        private const string DashedFormat = "8-4-4-4-12";

        /// <summary>去掉横线、转小写、只留十六进制；不是 32 位就返回空串。</summary>
        public static string Normalize(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            var builder = new StringBuilder(32);
            foreach (char ch in value!.Trim().ToLowerInvariant())
            {
                if (ch == '-') continue;
                bool hex = (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
                if (!hex) return string.Empty;
                builder.Append(ch);
            }
            return builder.Length == 32 ? builder.ToString() : string.Empty;
        }

        public static string WithDashes(string? uuid)
        {
            string plain = Normalize(uuid);
            if (plain.Length != 32) return uuid ?? string.Empty;
            var parts = new List<string>(5)
            {
                plain.Substring(0, 8),
                plain.Substring(8, 4),
                plain.Substring(12, 4),
                plain.Substring(16, 4),
                plain.Substring(20, 12)
            };
            return string.Join("-", parts);
        }

        /// <summary>
        /// 离线登录的 UUID：Java 的 UUID.nameUUIDFromBytes("OfflinePlayer:" + 名字)，
        /// 也就是 version 3（MD5）UUID。PCL、原版服务端离线模式都按这个算，
        /// 所以同一个名字在任何启动器里都会落到同一个玩家数据上。
        /// </summary>
        public static string Offline(string name)
        {
            byte[] hash;
            using (var md5 = MD5.Create())
            {
                hash = md5.ComputeHash(Encoding.UTF8.GetBytes("OfflinePlayer:" + name));
            }

            hash[6] = (byte)((hash[6] & 0x0F) | 0x30);
            hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
            return JsonHttp.ToHex(hash);
        }

        public static bool IsDashed(string value) => value.Length == 36 && value.Contains('-');
    }

    /// <summary>accounts.json 的内容。</summary>
    internal sealed class AccountFile
    {
        public int Version { get; set; } = 1;

        /// <summary>当前选中的账号 ID。</summary>
        public string? Selected { get; set; }

        public List<AccountRecord> Accounts { get; set; } = new List<AccountRecord>();
    }

    /// <summary>accounts.json 的读写。写不进去不抛异常（和 LauncherConfigStore 一致的容忍度）。</summary>
    internal static class AccountStore
    {
        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private static AccountFile? _file;
        private static readonly object Gate = new object();

        public static string FilePath => Path.Combine(LauncherConfigStore.Folder, "accounts.json");

        public static AccountFile Current
        {
            get
            {
                lock (Gate)
                {
                    return _file ??= Load();
                }
            }
        }

        public static List<AccountRecord> All => Current.Accounts;

        /// <summary>当前账号；没有任何账号时为 null。</summary>
        public static AccountRecord? Selected
        {
            get
            {
                var file = Current;
                var match = file.Accounts.FirstOrDefault(item =>
                    string.Equals(item.Id, file.Selected, StringComparison.Ordinal));
                return match ?? file.Accounts.FirstOrDefault();
            }
        }

        public static AccountRecord? Find(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            return All.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
        }

        /// <summary>同一个 ID 的档案整体替换，没有就追加；顺带记下登录时间。</summary>
        public static AccountRecord Save(AccountRecord account)
        {
            lock (Gate)
            {
                var file = Current;
                account.LastLogin = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (account.CreatedAt == 0) account.CreatedAt = account.LastLogin;

                int index = file.Accounts.FindIndex(item => string.Equals(item.Id, account.Id, StringComparison.Ordinal));
                if (index >= 0) file.Accounts[index] = account;
                else file.Accounts.Add(account);

                if (string.IsNullOrWhiteSpace(file.Selected)) file.Selected = account.Id;
                Write();
                return account;
            }
        }

        public static bool Select(string? id)
        {
            lock (Gate)
            {
                var file = Current;
                if (file.Accounts.All(item => !string.Equals(item.Id, id, StringComparison.Ordinal))) return false;
                file.Selected = id;
                Write();
                return true;
            }
        }

        public static bool Remove(string? id)
        {
            lock (Gate)
            {
                var file = Current;
                int removed = file.Accounts.RemoveAll(item => string.Equals(item.Id, id, StringComparison.Ordinal));
                if (removed == 0) return false;

                if (string.Equals(file.Selected, id, StringComparison.Ordinal))
                {
                    file.Selected = file.Accounts.FirstOrDefault()?.Id;
                }
                Write();
                return true;
            }
        }

        /// <summary>把当前档案按现有顺序重新写一遍（比如只更新了皮肤链接）。</summary>
        public static void Flush()
        {
            lock (Gate)
            {
                Write();
            }
        }

        private static void Write()
        {
            try
            {
                string folder = Path.GetDirectoryName(FilePath) ?? AppContext.BaseDirectory;
                Directory.CreateDirectory(folder);
                System.IO.File.WriteAllText(FilePath, JsonSerializer.Serialize(_file, SerializerOptions));
            }
            catch (Exception)
            {
                // 写不进去不影响本次使用，下次启动回落到上一次的档案
            }
        }

        private static AccountFile Load()
        {
            try
            {
                if (!System.IO.File.Exists(FilePath)) return new AccountFile();

                var file = JsonSerializer.Deserialize<AccountFile>(
                    System.IO.File.ReadAllText(FilePath), SerializerOptions) ?? new AccountFile();
                return Normalize(file);
            }
            catch (Exception)
            {
                // 文件坏了：不要覆盖它，先在内存里从空开始
                return new AccountFile();
            }
        }

        /// <summary>收敛档案：丢掉没名字 / ID 重复的条目，补全 ID 与 UUID 格式。</summary>
        private static AccountFile Normalize(AccountFile file)
        {
            if (file.Accounts == null) file.Accounts = new List<AccountRecord>();

            var entries = new List<AccountRecord>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var account in file.Accounts)
            {
                if (account == null) continue;
                account.Type = NormalizeType(account.Type);
                account.Name = (account.Name ?? string.Empty).Trim();
                account.Uuid = Uuids.Normalize(account.Uuid);
                if (account.Name.Length == 0) continue;

                if (account.Uuid.Length == 0 && account.Type == "offline")
                {
                    account.Uuid = Uuids.Offline(account.Name);
                }

                if (string.IsNullOrWhiteSpace(account.Id)) account.Id = MakeId(account);
                if (!seen.Add(account.Id)) continue;
                entries.Add(account);
            }

            file.Accounts = entries;
            if (entries.All(item => !string.Equals(item.Id, file.Selected, StringComparison.Ordinal)))
            {
                file.Selected = entries.FirstOrDefault()?.Id;
            }
            return file;
        }

        public static string NormalizeType(string? type)
        {
            switch ((type ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "ms":
                case "microsoft":
                    return "ms";
                case "authlib":
                case "auth":
                case "yggdrasil":
                    return "authlib";
                default:
                    return "offline";
            }
        }

        /// <summary>由类型 + UUID（外置登录再加服务器主机名）拼出稳定 ID。</summary>
        public static string MakeId(AccountRecord account)
        {
            string type = NormalizeType(account.Type);
            string uuid = Uuids.Normalize(account.Uuid);
            if (type == "authlib")
            {
                return "authlib:" + uuid + "@" + HostOf(account.Server);
            }
            return type + ":" + uuid;
        }

        public static string HostOf(string? server)
        {
            if (string.IsNullOrWhiteSpace(server)) return string.Empty;
            try
            {
                return new Uri(server!.Trim()).Host.ToLowerInvariant();
            }
            catch (UriFormatException)
            {
                return server!.Trim().ToLowerInvariant();
            }
        }
    }
}
