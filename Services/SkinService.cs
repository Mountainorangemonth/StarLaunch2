/*=====================================================================
   StarLaunch · 皮肤头像
   ---------------------------------------------------------------------
   界面上那个小方头是真实的皮肤文件，不是画出来的（画出来的只有末位兜底）。

   做法：把整张 64×64 皮肤 PNG 交给网页，用 CSS 裁出头像那一块
   （background-size: 800% + background-position 定位），既不用在 C# 里
   拼像素，也保住了像素风的锐利边缘。

   缓存：内存 → 磁盘（配置目录 SkinCache\<账号>.png，6 小时有效）→ 网络。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    internal static class SkinService
    {
        private static readonly TimeSpan MaxAge = TimeSpan.FromHours(6);
        private static readonly Dictionary<string, byte[]> Memory = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        private static readonly object Gate = new object();

        /// <summary>拿这个账号的皮肤 PNG；拿不到返回 null（网页退回默认皮肤）。</summary>
        public static async Task<byte[]?> GetSkinAsync(AccountRecord account, CancellationToken token)
        {
            string key = account.Id;

            lock (Gate)
            {
                if (Memory.TryGetValue(key, out var cached)) return cached;
            }

            string folder = Path.Combine(LauncherConfigStore.Folder, "SkinCache");
            string file = Path.Combine(folder, SafeName(key) + ".png");
            string stamp = Path.Combine(folder, SafeName(key) + ".txt");

            // 磁盘缓存：文件在、时间戳新鲜就直接用
            try
            {
                if (File.Exists(file) && File.Exists(stamp) &&
                    DateTime.UtcNow - File.GetLastWriteTimeUtc(file) < MaxAge)
                {
                    byte[] bytes = await File.ReadAllBytesAsync(file, token).ConfigureAwait(false);
                    Remember(key, bytes);
                    return bytes;
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                // 缓存读不了就重新下
            }

            string? url = account.SkinUrl;
            if (string.IsNullOrWhiteSpace(url) && account.Type == "authlib" && !string.IsNullOrWhiteSpace(account.Server))
            {
                var (resolved, model) = await AuthlibAuth
                    .FetchSkinAsync(account.Server!, account.Uuid, token).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(resolved))
                {
                    url = resolved;
                    account.SkinUrl = resolved;
                    account.SkinModel = string.IsNullOrWhiteSpace(model) ? account.SkinModel : model;
                    AccountStore.Flush();
                }
            }

            if (string.IsNullOrWhiteSpace(url)) return null;

            try
            {
                byte[] bytes = await LoadRemoteAsync(url!, token).ConfigureAwait(false);
                if (bytes.Length == 0) return null;

                try
                {
                    Directory.CreateDirectory(folder);
                    await File.WriteAllBytesAsync(file, bytes, token).ConfigureAwait(false);
                    await File.WriteAllTextAsync(stamp, url!, token).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    // 缓存写不进去不影响这次显示
                }

                Remember(key, bytes);
                return bytes;
            }
            catch (Exception ex) when (ex is HttpError || ex is IOException)
            {
                return null;
            }
        }

        /// <summary>强制丢弃缓存（界面上「刷新皮肤」用）。</summary>
        public static void Invalidate(string? accountId)
        {
            if (string.IsNullOrWhiteSpace(accountId)) return;
            lock (Gate)
            {
                Memory.Remove(accountId!);
            }
            try
            {
                string folder = Path.Combine(LauncherConfigStore.Folder, "SkinCache");
                string file = Path.Combine(folder, SafeName(accountId!) + ".png");
                string stamp = Path.Combine(folder, SafeName(accountId!) + ".txt");
                if (File.Exists(file)) File.Delete(file);
                if (File.Exists(stamp)) File.Delete(stamp);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                // 删不掉就等它自然过期
            }
        }

        private static async Task<byte[]> LoadRemoteAsync(string url, CancellationToken token)
        {
            using var response = await JsonHttp.Client
                .GetAsync(url, HttpCompletionOption.ResponseContentRead, token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return Array.Empty<byte>();
            return await response.Content.ReadAsByteArrayAsync(token).ConfigureAwait(false);
        }

        private static void Remember(string key, byte[] bytes)
        {
            lock (Gate)
            {
                // 只留最近几十个：账号不会很多，但也不能无限涨
                if (Memory.Count > 48) Memory.Clear();
                Memory[key] = bytes;
            }
        }

        /// <summary>账号 ID 里有 : @ 这样的字符，做文件名前换成下划线。</summary>
        private static string SafeName(string id)
        {
            var builder = new StringBuilder(id.Length);
            foreach (char ch in id)
            {
                bool ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                          (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.';
                builder.Append(ok ? ch : '_');
            }
            string name = builder.ToString();
            if (name.Length > 60) name = name.Substring(0, 60);
            return name.Length == 0 ? "account" : name;
        }
    }
}
