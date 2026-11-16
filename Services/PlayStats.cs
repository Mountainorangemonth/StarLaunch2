/*=====================================================================
   StarLaunch · 游戏时长统计（主页「本周游戏」）
   ---------------------------------------------------------------------
   以前主页那张柱状图是写死在 index.html 里的假数据（12.6 小时 / +18%）。
   现在真记：每次启动游戏写一条会话，退出时补上时长，按「本周（周一起）」
   聚合成 7 根柱子。

   文件：配置目录里的 playtime.json（和 StarLaunch.config.json 同目录）
     { version: 1, sessions: [ { dir, version, name, start, seconds } ] }
   start 是 Unix 毫秒，seconds 为 0 表示「还在跑」——启动器被关掉也丢不了
   这次记录，下次启动时会丢掉这条（0 秒本来也不该算进统计）。

   只保留最近 400 条，文件不会无限长。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StarLaunch.Services
{
    /// <summary>一次游戏会话。</summary>
    internal sealed class PlaySession
    {
        /// <summary>游戏目录（.minecraft 根）。</summary>
        public string Dir { get; set; } = string.Empty;

        /// <summary>版本目录名（versions 下的一级子目录）。</summary>
        public string Version { get; set; } = string.Empty;

        /// <summary>启动时显示的名字，只给人看。</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>开始时间（Unix 毫秒）。</summary>
        public long Start { get; set; }

        /// <summary>时长（秒）；0 表示还在跑或没记到。</summary>
        public long Seconds { get; set; }

        [JsonIgnore]
        public DateTimeOffset StartedAt => DateTimeOffset.FromUnixTimeMilliseconds(Start);
    }

    internal sealed class PlayStatsFile
    {
        public int Version { get; set; } = 1;
        public List<PlaySession> Sessions { get; set; } = new List<PlaySession>();
    }

    /// <summary>一周的汇总（周一到周日）。</summary>
    internal sealed class PlayWeek
    {
        /// <summary>7 天的秒数，下标 0 = 周一。</summary>
        public long[] Days { get; } = new long[7];

        public long TotalSeconds { get; set; }

        /// <summary>本周启动次数。</summary>
        public int Sessions { get; set; }

        /// <summary>
        /// 上周同一口径的总时长，用来算涨跌。
        /// 注意：这是「整周 7 天」的总量，而本周才过了几天，直接相除会永远得到
        /// 一个巨大的负数（周一时本周 0 小时、上周 10 小时 → -100%）。
        /// 所以比对走下面按「同期」算的 <see cref="ComparedSeconds"/>。
        /// </summary>
        public long LastWeekSeconds { get; set; }

        /// <summary>
        /// 上周「和本周同一段」的时长：本周只过到周四，就只取上周一到周四。
        /// 算得太少的对比没有意义，由前端决定要不要显示。
        /// </summary>
        public long ComparedSeconds { get; set; }

        /// <summary>本次对比覆盖的天数（1 = 只有周一，7 = 整周都过完了）。</summary>
        public int ComparedDays { get; set; }

        /// <summary>
        /// 相对上周同期涨跌的百分比；上周同期为 0 时返回 null（不编造涨幅）。
        /// 四舍五入到整数，但绝不把「-0.4%」显示成「-0%」那种东西。
        /// </summary>
        public double? DeltaPercent
        {
            get
            {
                if (ComparedSeconds <= 0) return null;
                double value = (TotalSeconds - ComparedSeconds) * 100.0 / ComparedSeconds;
                double rounded = Math.Round(value, 0);
                return rounded == 0 ? 0 : rounded;
            }
        }

        public Dictionary<string, object?> ToView()
        {
            return new Dictionary<string, object?>
            {
                ["days"] = Days,
                ["totalSeconds"] = TotalSeconds,
                ["sessions"] = Sessions,
                ["lastWeekSeconds"] = LastWeekSeconds,
                ["comparedSeconds"] = ComparedSeconds,
                ["comparedDays"] = ComparedDays,
                ["deltaPercent"] = DeltaPercent
            };
        }
    }

    internal static class PlayStats
    {
        /// <summary>太短的会话不算（点了启动又立刻关掉，不该出现在柱状图里）。</summary>
        private const long MinSeconds = 30;

        /// <summary>保留的会话条数上限。</summary>
        private const int MaxSessions = 400;

        private static readonly object Gate = new object();
        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        public static string FilePath => Path.Combine(LauncherConfigStore.Folder, "playtime.json");

        /// <summary>
        /// 游戏进程起来了：先落一条 0 秒的记录。
        /// 万一启动器先被关掉，这条记录还在（下次统计时 0 秒会被忽略）。
        /// </summary>
        public static void BeginSession(string dir, string versionId, string name, DateTimeOffset startedAt)
        {
            lock (Gate)
            {
                var file = Load();
                file.Sessions.Add(new PlaySession
                {
                    Dir = GameDirs.NormalizePath(dir),
                    Version = versionId ?? string.Empty,
                    Name = name ?? string.Empty,
                    Start = startedAt.ToUnixTimeMilliseconds(),
                    Seconds = 0
                });
                Save(file);
            }
        }

        /// <summary>游戏退出了：把这条记录补上真实时长。</summary>
        public static void EndSession(string dir, string versionId, DateTimeOffset startedAt, TimeSpan duration)
        {
            long start = startedAt.ToUnixTimeMilliseconds();
            long seconds = (long)Math.Round(duration.TotalSeconds);
            if (seconds < 0) seconds = 0;

            lock (Gate)
            {
                var file = Load();
                PlaySession? target = null;
                for (int index = file.Sessions.Count - 1; index >= 0; index -= 1)
                {
                    var item = file.Sessions[index];
                    if (item.Start != start) continue;
                    if (!string.Equals(item.Version, versionId, StringComparison.OrdinalIgnoreCase)) continue;
                    target = item;
                    break;
                }

                if (target == null)
                {
                    if (seconds < MinSeconds) return;
                    file.Sessions.Add(new PlaySession
                    {
                        Dir = GameDirs.NormalizePath(dir),
                        Version = versionId ?? string.Empty,
                        Name = versionId ?? string.Empty,
                        Start = start,
                        Seconds = seconds
                    });
                }
                else
                {
                    target.Seconds = seconds;
                }

                Save(file);
            }
        }

        /// <summary>本周（周一起）每天的时长。</summary>
        public static PlayWeek Week()
        {
            var summary = new PlayWeek();

            DateTimeOffset now = DateTimeOffset.Now;
            DateTime today = now.Date;
            // DayOfWeek 里周日是 0，这里换算成「周一 = 0」
            int offset = ((int)today.DayOfWeek + 6) % 7;
            DateTime monday = today.AddDays(-offset);
            DateTime nextMonday = monday.AddDays(7);
            DateTime lastMonday = monday.AddDays(-7);
            // 「上周同期」的截止点：本周已经过去了多久，上周就只比到同一时刻。
            // 注意用 now.DateTime（本地时钟）减 monday，别用 monday.ToLocalTime()——
            // DateTimeKind.Unspecified 会被当成 UTC 再加一次时区偏移。
            DateTime comparedUntil = lastMonday.Add(now.DateTime - monday);

            // 对比覆盖的天数：周一当天算 1 天，整周过完是 7 天
            summary.ComparedDays = Math.Min(7, offset + 1);

            lock (Gate)
            {
                foreach (var session in Load().Sessions)
                {
                    if (session.Seconds <= 0) continue;

                    DateTime local;
                    try
                    {
                        local = session.StartedAt.ToLocalTime().DateTime;
                    }
                    catch (ArgumentOutOfRangeException)
                    {
                        continue;
                    }

                    if (local >= monday && local < nextMonday)
                    {
                        int day = (local.Date - monday).Days;
                        if (day >= 0 && day < 7) summary.Days[day] += session.Seconds;
                        summary.TotalSeconds += session.Seconds;
                        summary.Sessions += 1;
                    }
                    else if (local >= lastMonday && local < monday)
                    {
                        summary.LastWeekSeconds += session.Seconds;

                        // 只累计到「本周已经过到的那个时刻」，跟本周是同口径
                        if (local <= comparedUntil) summary.ComparedSeconds += session.Seconds;
                    }
                }
            }

            return summary;
        }

        /// <summary>某个版本最后一次启动的时间（没有记录时返回 null）。</summary>
        public static DateTimeOffset? LastPlayed(string dir, string versionId)
        {
            string folder = GameDirs.NormalizePath(dir);
            DateTimeOffset? newest = null;

            lock (Gate)
            {
                foreach (var session in Load().Sessions)
                {
                    if (!string.Equals(session.Version, versionId, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!string.Equals(GameDirs.NormalizePath(session.Dir), folder, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    if (newest == null || session.StartedAt > newest) newest = session.StartedAt;
                }
            }

            return newest;
        }

        /// <summary>
        /// 把我们的记录并进 launcher_profiles 的「上次启动」表：
        /// 官方启动器不一定会更新它，自己记的才是准的。
        /// </summary>
        public static void MergeLastPlayed(string gameDir, IDictionary<string, DateTimeOffset> map)
        {
            if (map == null) return;
            string folder = GameDirs.NormalizePath(gameDir);

            lock (Gate)
            {
                foreach (var session in Load().Sessions)
                {
                    if (!string.Equals(GameDirs.NormalizePath(session.Dir), folder, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var when = session.StartedAt;
                    if (map.TryGetValue(session.Version, out var known) && known >= when) continue;
                    map[session.Version] = when;
                }
            }
        }

        /* -----------------------------------------------------------------
           读写
           ----------------------------------------------------------------- */

        private static PlayStatsFile Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return new PlayStatsFile();
                var file = JsonSerializer.Deserialize<PlayStatsFile>(
                    File.ReadAllText(FilePath), SerializerOptions);
                if (file == null) return new PlayStatsFile();
                if (file.Sessions == null) file.Sessions = new List<PlaySession>();
                return file;
            }
            catch (Exception)
            {
                // 文件坏了就当没有：统计丢了不影响玩游戏
                return new PlayStatsFile();
            }
        }

        private static void Save(PlayStatsFile file)
        {
            try
            {
                if (file.Sessions.Count > MaxSessions)
                {
                    file.Sessions.RemoveRange(0, file.Sessions.Count - MaxSessions);
                }

                string folder = Path.GetDirectoryName(FilePath) ?? LauncherConfigStore.Folder;
                Directory.CreateDirectory(folder);
                File.WriteAllText(FilePath, JsonSerializer.Serialize(file, SerializerOptions));
            }
            catch (Exception)
            {
                // 写不进去就算了，统计不是关键路径
            }
        }

        /// <summary>把秒数写成「3.2 小时 / 12 分钟」这种给人看的串。</summary>
        public static string FormatDuration(long seconds)
        {
            if (seconds <= 0) return "0 秒";
            if (seconds < 60) return seconds + " 秒";
            if (seconds >= 3600)
            {
                return (seconds / 3600.0).ToString("0.0", CultureInfo.InvariantCulture) + " 小时";
            }
            return Math.Max(1, seconds / 60) + " 分钟";
        }
    }
}
