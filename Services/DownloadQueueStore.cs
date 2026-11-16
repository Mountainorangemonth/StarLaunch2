/*=====================================================================
   StarLaunch · 未完成下载的落盘记录
   ---------------------------------------------------------------------
   关掉启动器时，正在下载 / 排队中的任务会被记在这里
   （配置目录下的 downloads.json，和 StarLaunch.config.json 放一起）。

   下次启动把记录读出来，按原来那条 postMessage 重新入队：
     · 已经下完的文件按大小比对直接跳过；
     · 下到一半的 .part 按 Range 续传（见 JsonHttp.DownloadBodyAsync）。
   所以「提前关软件 → 再打开」不会从零开始。

   任务真正结束（成功 / 失败 / 取消）就从文件里划掉；
   暂停的任务会留着，下次启动照样接着下。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace StarLaunch.Services
{
    internal static class DownloadQueueStore
    {
        private const string FileName = "downloads.json";

        private sealed class Entry
        {
            public string Id { get; set; } = string.Empty;
            public string Raw { get; set; } = string.Empty;
            public string? Name { get; set; }
            public string? Kind { get; set; }
        }

        private static readonly object Gate = new object();
        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        private static List<Entry>? _entries;

        private static string FilePath =>
            Path.Combine(LauncherConfigStore.Folder, FileName);

        private static List<Entry> Entries
        {
            get
            {
                if (_entries != null) return _entries;

                try
                {
                    string path = FilePath;
                    _entries = File.Exists(path)
                        ? JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(path), SerializerOptions)
                            ?? new List<Entry>()
                        : new List<Entry>();
                }
                catch (Exception)
                {
                    // 文件坏了就当没有，别让启动器起不来
                    _entries = new List<Entry>();
                }
                return _entries!;
            }
        }

        /// <summary>记住一条还没结束的任务。同 id 会覆盖。</summary>
        public static void Remember(string? id, string? raw, string? name, string? kind)
        {
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(raw)) return;

            lock (Gate)
            {
                var list = Entries;
                list.RemoveAll(item => string.Equals(item.Id, id, StringComparison.Ordinal));
                list.Add(new Entry { Id = id!, Raw = raw!, Name = name, Kind = kind });
                SaveLocked();
            }
        }

        /// <summary>任务真的结束了（成功 / 失败 / 取消），从记录里划掉。</summary>
        public static void Forget(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return;

            lock (Gate)
            {
                var list = Entries;
                if (list.RemoveAll(item => string.Equals(item.Id, id, StringComparison.Ordinal)) > 0)
                {
                    SaveLocked();
                }
            }
        }

        /// <summary>取出所有未完成的任务并清空记录（启动时调一次）。</summary>
        public static List<(string Id, string Raw)> Take()
        {
            lock (Gate)
            {
                var list = Entries;
                var result = new List<(string Id, string Raw)>(list.Count);
                foreach (var entry in list)
                {
                    if (string.IsNullOrWhiteSpace(entry.Raw)) continue;
                    result.Add((entry.Id, entry.Raw));
                }

                list.Clear();
                SaveLocked();
                return result;
            }
        }

        private static void SaveLocked()
        {
            try
            {
                string path = FilePath;
                string? folder = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);

                if (Entries.Count == 0)
                {
                    if (File.Exists(path)) File.Delete(path);
                    return;
                }

                File.WriteAllText(path, JsonSerializer.Serialize(Entries, SerializerOptions));
            }
            catch (Exception)
            {
                // 写不进去不影响这次运行，丢的只是「下次继续」
            }
        }
    }
}
