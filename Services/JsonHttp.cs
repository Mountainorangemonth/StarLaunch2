/*=====================================================================
   StarLaunch · 网络请求小工具
   ---------------------------------------------------------------------
   登录和下载都要发 HTTP：这里统一一个 HttpClient（连接复用、自动解压、
   连接超时），并把「失败了」翻译成能直接显示给用户的中文原因。

   约定：
     · 只会抛 HttpError（消息可读）或者 OperationCanceledException；
     · 返回 JsonDocument 的调用方负责 Dispose；
     · 所有方法都接受 CancellationToken，取消时立刻停手。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>请求失败：消息本身就是给用户看的说明。</summary>
    internal sealed class HttpError : Exception
    {
        public HttpError(string message) : this(message, null, false) { }

        public HttpError(string message, Exception? inner, bool transient) : base(message, inner)
        {
            Transient = transient;
        }

        /// <summary>
        /// 这次失败是不是「网络抖了一下」——换条连接重发多半就好。
        /// 为真时调用方可以重试；为假（404、文件不存在、JSON 坏了）重试没有意义。
        /// </summary>
        public bool Transient { get; }
    }

    internal static class JsonHttp
    {
        private static readonly HttpClient SharedClient = CreateClient();

        public static HttpClient Client => SharedClient;

        private static HttpClient CreateClient()
        {
            var handler = new SocketsHttpHandler
            {
                AutomaticDecompression = DecompressionMethods.All,
                // 12 秒够用了：再久基本就是「根本没这台机器」（被墙 / 宕机），
                // 与其死等不如早点报错换下一个源。重试 3 次才有上限。
                ConnectTimeout = TimeSpan.FromSeconds(12),

                /* 不让连接池主动换连接：换连接的那一瞬间正好有请求挂在这条连接上，
                   客户端看到的就是「The SSL connection could not be established」。
                   这个 HttpClient 是静态的、只活一个进程，不需要靠轮换刷新 DNS。 */
                PooledConnectionLifetime = Timeout.InfiniteTimeSpan,
                PooledConnectionIdleTimeout = TimeSpan.FromSeconds(90),

                /* 分段下载会同时开好几条连接（并发数 × 段数）。给一个上限让多出来的排队，
                   而不是继续朝同一个镜像握手 —— 握手被限流/重置就是那条 SSL 报错的来源之一。 */
                MaxConnectionsPerServer = 16
            };
            var client = new HttpClient(handler)
            {
                // 大文件下载（client.jar / 光影包）可能很慢，单请求超时交给调用方的 token 控制
                Timeout = Timeout.InfiniteTimeSpan
            };
            client.DefaultRequestHeaders.UserAgent.ParseAdd(
                "StarLaunch/1.0 (Minecraft launcher; +https://github.com/Mountainorangemonth/StarLaunch2)");
            client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            return client;
        }

        /* -----------------------------------------------------------------
           JSON
           ----------------------------------------------------------------- */

        public static async Task<JsonDocument> GetJsonAsync(string url, CancellationToken token)
        {
            using var response = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, url), token)
                .ConfigureAwait(false);
            await EnsureSuccessAsync(response, url).ConfigureAwait(false);
            return await ReadJsonAsync(response, url).ConfigureAwait(false);
        }

        /// <summary>
        /// 同一个接口的多个候选地址（官方 + 镜像）：按顺序试，第一个成功就返回。
        /// 成功 / 失败都会记到 Mirrors，下次「自动」档就知道该先走谁。
        /// </summary>
        public static async Task<JsonDocument> GetJsonCandidatesAsync(
            IReadOnlyList<string> urls, CancellationToken token)
        {
            if (urls == null || urls.Count == 0) throw new HttpError("没有可用的服务器地址");

            HttpError? last = null;
            for (int index = 0; index < urls.Count; index += 1)
            {
                string url = (urls[index] ?? string.Empty).Trim();
                if (url.Length == 0) continue;

                try
                {
                    var document = await GetJsonAsync(url, token).ConfigureAwait(false);
                    Mirrors.ReportSource(url, true);
                    return document;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (HttpError ex)
                {
                    Mirrors.ReportSource(url, false);
                    last = ex;
                }
            }

            throw last ?? new HttpError("没有可用的服务器地址");
        }

        public static async Task<JsonDocument> PostJsonAsync(
            string url, object payload, CancellationToken token, IEnumerable<KeyValuePair<string, string>>? headers = null)
        {
            string body = JsonSerializer.Serialize(payload);
            using var response = await SendAsync(() =>
            {
                var request = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json")
                };
                AddHeaders(request, headers);
                return request;
            }, token).ConfigureAwait(false);

            await EnsureSuccessAsync(response, url).ConfigureAwait(false);
            return await ReadJsonAsync(response, url).ConfigureAwait(false);
        }

        /// <summary>POST 表单（微软 OAuth 用）。失败时把 OAuth 的 error_description 原样带出来。</summary>
        public static async Task<JsonDocument> PostFormAsync(
            string url, IEnumerable<KeyValuePair<string, string>> form, CancellationToken token,
            IEnumerable<KeyValuePair<string, string>>? headers = null)
        {
            var content = new FormUrlEncodedContent(form);
            using var response = await SendAsync(() =>
            {
                var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
                AddHeaders(request, headers);
                return request;
            }, token).ConfigureAwait(false);

            await EnsureSuccessAsync(response, url).ConfigureAwait(false);
            return await ReadJsonAsync(response, url).ConfigureAwait(false);
        }

        /// <summary>发一个请求但不关心返回体（HEAD / validate 这类只认状态码的接口）。</summary>
        public static async Task<int> SendStatusAsync(
            HttpMethod method, string url, CancellationToken token,
            IEnumerable<KeyValuePair<string, string>>? headers = null,
            object? payload = null)
        {
            using var response = await SendAsync(() =>
            {
                var request = new HttpRequestMessage(method, url);
                if (payload != null)
                {
                    request.Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                }
                AddHeaders(request, headers);
                return request;
            }, token).ConfigureAwait(false);
            return (int)response.StatusCode;
        }

        /// <summary>取纯文本（版本清单、meta 之类）。</summary>
        public static async Task<string> GetStringAsync(
            string url, CancellationToken token, IEnumerable<KeyValuePair<string, string>>? headers = null)
        {
            using var response = await SendAsync(() =>
            {
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                AddHeaders(request, headers);
                return request;
            }, token).ConfigureAwait(false);

            await EnsureSuccessAsync(response, url).ConfigureAwait(false);
            return await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
        }

        /// <summary>取纯文本，多个候选地址按顺序试（和 GetJsonCandidatesAsync 一个思路）。</summary>
        public static async Task<string> GetStringCandidatesAsync(
            IReadOnlyList<string> urls, CancellationToken token)
        {
            if (urls == null || urls.Count == 0) throw new HttpError("没有可用的服务器地址");

            HttpError? last = null;
            foreach (string candidate in urls)
            {
                string url = (candidate ?? string.Empty).Trim();
                if (url.Length == 0) continue;

                try
                {
                    return await GetStringAsync(url, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (HttpError ex)
                {
                    last = ex;
                }
            }

            throw last ?? new HttpError("没有可用的服务器地址");
        }

        /// <summary>只取响应头（authlib-injector 的 API 地址发现用）。响应不存在时返回空字典。</summary>
        public static async Task<Dictionary<string, string[]>> GetHeadersAsync(
            HttpMethod method, string url, CancellationToken token)
        {
            using var response = await SendAsync(() => new HttpRequestMessage(method, url), token)
                .ConfigureAwait(false);

            var headers = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in response.Headers) headers[pair.Key] = new List<string>(pair.Value).ToArray();
            foreach (var pair in response.Content.Headers) headers[pair.Key] = new List<string>(pair.Value).ToArray();
            return headers;
        }

        private static void AddHeaders(
            HttpRequestMessage request, IEnumerable<KeyValuePair<string, string>>? headers)
        {
            if (headers == null) return;
            foreach (var pair in headers)
            {
                if (string.Equals(pair.Key, "Authorization", StringComparison.OrdinalIgnoreCase))
                {
                    request.Headers.TryAddWithoutValidation("Authorization", pair.Value);
                    continue;
                }
                request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
            }
        }

        /* -----------------------------------------------------------------
           发送（含传输层重试）
           -----------------------------------------------------------------
           家庭网络 + 公共镜像最典型的失败方式是「偶尔一次握手被重置」：报错是
           The SSL connection could not be established（或连接被强制关闭）。
           这种错误重发一次基本就好，但当成致命错误的话，5000 个资源文件里
           随便哪个抖一下，整个安装就前功尽弃 —— 所以这里统一重试。
           只重试 GET / HEAD：POST 的请求体已经被消费过，重发会拿到空 body。
           ----------------------------------------------------------------- */

        /* -----------------------------------------------------------------
           网络失败的记录
           -----------------------------------------------------------------
           有些请求是「静默失败」的（启动时的账户体检、检查更新、恢复下载队列），
           失败只在调试器里留下 first-chance 异常，界面和我们这边都看不出是
           哪台服务器挂了。这里把最终失败写进配置目录的 network.log。
           ----------------------------------------------------------------- */
        private static readonly object LogGate = new object();

        private static void RecordFailure(string url, string message)
        {
            try
            {
                lock (LogGate)
                {
                    string file = Path.Combine(LauncherConfigStore.Folder, "network.log");
                    var info = new FileInfo(file);
                    if (info.Exists && info.Length > 128 * 1024)
                    {
                        File.Delete(file);
                    }

                    var text = new StringBuilder();
                    text.Append(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss")).Append("  ").AppendLine(url);
                    foreach (string line in message.Split('\n'))
                    {
                        text.Append("    ").AppendLine(line.TrimEnd('\r'));
                    }
                    File.AppendAllText(file, text.ToString());
                }
            }
            catch (Exception)
            {
                // 写日志本身失败就算了，不能影响请求
            }
        }

        /// <summary>一次请求最多试几次（含第一次）。</summary>
        private const int TransportAttempts = 3;

        private static async Task<HttpResponseMessage> SendAsync(
            Func<HttpRequestMessage> factory, CancellationToken token)
        {
            string url = string.Empty;

            for (int attempt = 1; ; attempt += 1)
            {
                var request = factory();
                url = request.RequestUri?.ToString() ?? string.Empty;

                bool idempotent = request.Method == HttpMethod.Get || request.Method == HttpMethod.Head;
                bool retryable = idempotent && attempt < TransportAttempts;

                try
                {
                    return await SharedClient
                        .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token)
                        .ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;   // 用户取消 / 暂停
                }
                catch (OperationCanceledException ex)
                {
                    /* ConnectTimeout 到点也抛这个，但根本没有谁取消过。
                       原来这里直接 throw，任务会被记成「已取消」而不是「失败」。 */
                    if (!retryable)
                    {
                        string message = "连接 " + HostOf(url) + " 超时（服务器没有响应）";
                        RecordFailure(url, message);
                        throw new HttpError(message, ex, true);
                    }
                }
                catch (HttpRequestException ex)
                {
                    bool transient = IsTransient(ex);
                    if (!transient || !retryable)
                    {
                        string message = Describe(ex, url);
                        RecordFailure(url, message);
                        throw new HttpError(message, ex, transient);
                    }
                }
                catch (Exception ex)
                {
                    RecordFailure(url, ex.Message);
                    throw new HttpError("请求失败：" + ex.Message, ex, false);
                }

                await DelayAsync(attempt, token).ConfigureAwait(false);
            }
        }

        /// <summary>退避一下再试：400ms、1000ms，带点抖动，免得几个线程同时撞回去。</summary>
        private static Task DelayAsync(int attempt, CancellationToken token)
        {
            int delay = (attempt <= 1 ? 400 : 1000) + Random.Shared.Next(0, 220);
            return Task.Delay(delay, token);
        }

        /// <summary>
        /// 这次失败是不是网络抖动。HttpRequestError 是 .NET 8 才有的枚举，
        /// 这里按枚举名比较，将来 Runtime 加成员也不会编译不过。
        /// </summary>
        private static bool IsTransient(HttpRequestException ex)
        {
            switch (ex.HttpRequestError.ToString())
            {
                case "SecureConnectionError":      // ← The SSL connection could not be established
                case "ConnectionError":
                case "NameResolutionError":
                case "ProxyTunnelError":
                case "HttpProtocolError":
                case "VersionNegotiationError":
                case "InvalidResponse":
                case "ResponseEnded":
                    return true;
            }

            for (Exception? inner = ex.InnerException; inner != null; inner = inner.InnerException)
            {
                if (inner is IOException) return true;
                if (inner is System.Net.Sockets.SocketException) return true;
                if (inner is System.Security.Authentication.AuthenticationException) return true;
            }

            return false;
        }

        /// <summary>底层异常 → 能直接显示给用户的中文（保留原始信息，方便用户回报）。</summary>
        private static string Describe(HttpRequestException ex, string url)
        {
            string host = HostOf(url);
            string detail = ex.Message;

            bool tls = ex.HttpRequestError.ToString() == "SecureConnectionError"
                || detail.IndexOf("SSL", StringComparison.OrdinalIgnoreCase) >= 0
                || detail.IndexOf("TLS", StringComparison.OrdinalIgnoreCase) >= 0;

            for (Exception? inner = ex.InnerException; !tls && inner != null; inner = inner.InnerException)
            {
                tls = inner is System.Security.Authentication.AuthenticationException;
            }

            if (tls)
            {
                return "和 " + host + " 建立安全连接失败（TLS 握手被中断）。常见原因是网络或代理拦截、" +
                    "杀毒软件的 HTTPS 扫描、或者镜像临时抽风；重试一下多半就好，一直失败就在设置里换一个下载源。" +
                    "（" + detail + "）";
            }

            return "连不上 " + host + "：" + detail;
        }

        private static string HostOf(string url)
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

        /// <summary>读响应体 / 写文件时炸掉也算抖动：连接在传数据的过程中被掐断就是这样。</summary>
        private static bool IsTransientFailure(Exception ex)
        {
            switch (ex)
            {
                case HttpError error:
                    return error.Transient;
                case HttpRequestException request:
                    return IsTransient(request);
                case IOException:
                    return true;
                case ObjectDisposedException:
                    return true;
                default:
                    return false;
            }
        }

        private static async Task EnsureSuccessAsync(HttpResponseMessage response, string url)
        {
            if (response.IsSuccessStatusCode) return;

            string body = string.Empty;
            try
            {
                body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch (Exception)
            {
                // 读不到响应体就只报状态码
            }

            int status = (int)response.StatusCode;
            // 408 / 429 / 5xx 是服务器「现在别来」，过一会儿重试有意义
            bool transient = status == 408 || status == 429 || status >= 500;

            string detail = Summarize(body);
            throw new HttpError(
                "服务器返回 " + status + " " + response.ReasonPhrase +
                (detail.Length > 0 ? "：" + detail : string.Empty) +
                "（" + ShortUrl(url) + "）", null, transient);
        }

        /// <summary>从错误响应里抠出最有用的那句（OAuth 的 error_description、authlib 的 errorMessage…）。</summary>
        private static string Summarize(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return string.Empty;

            try
            {
                using var document = JsonDocument.Parse(body);
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    foreach (string key in new[] { "error_description", "errorMessage", "message", "error" })
                    {
                        if (!root.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String)
                        {
                            continue;
                        }
                        string text = value.GetString() ?? string.Empty;
                        if (text.Trim().Length > 0)
                        {
                            return text.Length > 300 ? text.Substring(0, 300) : text;
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // 不是 JSON：下面按纯文本截断
            }

            string trimmed = body.Trim();
            return trimmed.Length > 200 ? trimmed.Substring(0, 200) : trimmed;
        }

        private static string ShortUrl(string url)
        {
            try
            {
                var uri = new Uri(url);
                string text = uri.Host + uri.AbsolutePath;
                return text.Length > 60 ? text.Substring(0, 60) + "…" : text;
            }
            catch (UriFormatException)
            {
                return url;
            }
        }

        private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response, string url)
        {
            string text;
            try
            {
                text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                throw new HttpError("读取响应失败：" + ex.Message);
            }

            if (string.IsNullOrWhiteSpace(text))
            {
                throw new HttpError("服务器返回了空内容（" + ShortUrl(url) + "）");
            }

            try
            {
                return JsonDocument.Parse(text, new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip
                });
            }
            catch (JsonException)
            {
                throw new HttpError("服务器返回的不是有效 JSON（" + ShortUrl(url) + "）");
            }
        }

        /* -----------------------------------------------------------------
           文件下载
           -----------------------------------------------------------------
           两条路：
             · 小于 1MB 的文件照旧一条连接拉到底；
             · 大文件先发一个 `Range: bytes=0-`，服务器支持分段（206）就
               按「并发下载数」切成几段同时拉，最后合并成一个文件。
           切分参考 PCL 的 NetFile：都是 Range 分段 + 临时分片 + 合并。
           这样同一个文件的带宽不再被单个 TCP 连接的上限卡住。
           ----------------------------------------------------------------- */

        /// <summary>低于这个大小就不值得分段（握手开销比省下的时间还多）。</summary>
        private const long PartThreshold = 1024L * 1024;

        /// <summary>每段至少这么大，避免切出一堆几百 KB 的碎片。</summary>
        private const long MinPartSize = 512L * 1024;

        /// <summary>
        /// 下到 path（先写 .part 再改名，中途失败不会留下半个文件）。
        /// sha1 给了就校验；返回实际写入的字节数。
        /// </summary>
        public static Task<long> DownloadFileAsync(
            string url, string path, string? sha1, Action<long>? onChunk, CancellationToken token)
        {
            return DownloadFileAsync(new[] { url }, path, sha1, onChunk, token);
        }

        /// <summary>
        /// 同一份文件的多个候选地址：按顺序试，前一个失败自动换下一个。
        /// 回来的 `成功` / `失败` 会记到 Mirrors 里，下次同类地址优先用能通的源。
        /// 每个地址最多试 FileAttempts 次 —— 一次 TLS 抖动不该让整个安装失败。
        /// </summary>
        public static async Task<long> DownloadFileAsync(
            IReadOnlyList<string> urls, string path, string? sha1, Action<long>? onChunk, CancellationToken token)
        {
            if (urls == null || urls.Count == 0) throw new HttpError("没有可用的下载地址");

            /* 换源 / 重试都会让进度从 0 再来一遍，直接回调过去进度条会倒着走；
               分段下载的几条线程也会同时回调，所以只放行更大的那个值。
               守卫放在这一层，单个文件重试几次进度都只增不减。 */
            long reported = 0;
            Action<long>? report = onChunk == null
                ? null
                : value =>
                {
                    long last = Interlocked.Read(ref reported);
                    if (value <= last) return;
                    if (Interlocked.CompareExchange(ref reported, value, last) != last) return;
                    onChunk(value);
                };

            HttpError? last = null;
            for (int index = 0; index < urls.Count; index += 1)
            {
                string url = (urls[index] ?? string.Empty).Trim();
                if (url.Length == 0) continue;

                for (int attempt = 1; ; attempt += 1)
                {
                    try
                    {
                        long written = await DownloadOneAsync(url, path, sha1, report, token)
                            .ConfigureAwait(false);
                        Mirrors.ReportSource(url, true);
                        return written;
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (HttpError ex) when (ex.Transient && attempt < FileAttempts)
                    {
                        // 抖动：.part 留着手上下，重试就是续传，不用从头再来
                        await DelayAsync(attempt, token).ConfigureAwait(false);
                    }
                    catch (HttpError ex)
                    {
                        Mirrors.ReportSource(url, false);
                        last = ex;
                        break;
                    }
                }
            }

            throw last ?? new HttpError("下载失败：候选地址都不可用");
        }

        /// <summary>一个文件最多试几次（含第一次）。</summary>
        private const int FileAttempts = 3;

        private static async Task<long> DownloadOneAsync(
            string url, string path, string? sha1, Action<long>? onChunk, CancellationToken token,
            bool allowRetry = true)
        {
            string? folder = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);

            string temp = path + ".part";
            bool hadPartial = ExistingLength(temp) > 0 || HasAnyPart(temp);

            try
            {
                long written = await DownloadBodyAsync(url, temp, onChunk, token).ConfigureAwait(false);

                if (!string.IsNullOrWhiteSpace(sha1))
                {
                    string actual = Sha1OfFile(temp);
                    if (!string.Equals(actual, sha1!.Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        // 是接着旧 .part 拼出来的 → 多半上次换了源 / 文件版本变了，删掉重下一次
                        if (hadPartial && allowRetry)
                        {
                            DeleteTempFamily(temp);
                            return await DownloadOneAsync(url, path, sha1, onChunk, token, false)
                                .ConfigureAwait(false);
                        }

                        throw new HttpError("文件校验不通过（SHA-1 不匹配），可能下载到了错误的内容");
                    }
                }

                File.Move(temp, path, overwrite: true);
                return written;
            }
            catch (OperationCanceledException)
            {
                // 暂停或关软件：把 .part / .part.N 留着，下次从断点接着下
                throw;
            }
            catch (Exception ex)
            {
                /* 抖动（握手失败、连接被掐断、读到一半断流）时把 .part 留着：
                   下一次重试走断点续传，而不是从 0 再来一遍。
                   真错误（404、校验不过）才清掉临时文件。 */
                bool transient = IsTransientFailure(ex);
                if (!transient) DeleteTempFamily(temp);

                if (ex is HttpError) throw;
                throw new HttpError("下载中断（" + ShortUrl(url) + "）：" + ex.Message, ex, transient);
            }
        }

        /// <summary>有没有留下分段分片（temp.0、temp.1…）。</summary>
        private static bool HasAnyPart(string temp)
        {
            for (int index = 0; index < 16; index += 1)
            {
                if (ExistingLength(PartPath(temp, index)) > 0) return true;
            }
            return false;
        }

        /// <summary>
        /// 下载到 temp。三种情况：
        ///   · 上次留下的 .part 还在 → 按 Range 断点续传（关掉启动器再打开也能接上）；
        ///   · 服务器支持分段且文件够大 → 切段并发，第一段直接用手上这个响应；
        ///   · 其余 → 单连接拉到底。
        /// </summary>
        private static async Task<long> DownloadBodyAsync(
            string url, string temp, Action<long>? onChunk, CancellationToken token)
        {
            long resumed = ExistingLength(temp);
            if (resumed > 0)
            {
                using var resumeResponse = await SendAsync(() => RangeRequest(url, resumed, null), token)
                    .ConfigureAwait(false);

                if (resumeResponse.StatusCode == HttpStatusCode.PartialContent)
                {
                    long totalSize = resumeResponse.Content.Headers.ContentRange?.Length ?? -1;
                    onChunk?.Invoke(resumed);

                    await using var input = await resumeResponse.Content.ReadAsStreamAsync(token)
                        .ConfigureAwait(false);
                    await CopyAsync(input, temp, long.MaxValue, append: true, (read) =>
                    {
                        resumed += read;
                        onChunk?.Invoke(resumed);
                    }, token).ConfigureAwait(false);

                    return totalSize > 0 ? totalSize : resumed;
                }

                // 服务器不支持续传：只能删掉重下
                TryDelete(temp);
            }

            using var response = await SendAsync(() => RangeRequest(url, 0, null), token)
                .ConfigureAwait(false);
            await EnsureSuccessAsync(response, url).ConfigureAwait(false);

            long size = -1;
            bool ranged = response.StatusCode == HttpStatusCode.PartialContent;
            if (ranged)
            {
                var contentRange = response.Content.Headers.ContentRange;
                if (contentRange != null && contentRange.HasLength) size = contentRange.Length!.Value;
                else ranged = false;
            }
            else if (response.Content.Headers.ContentLength.HasValue)
            {
                // 服务器忽略了 Range：响应体就是整个文件，直接一口气拉完
                size = response.Content.Headers.ContentLength.Value;
            }

            int parts = PartsFor(size, ranged);
            if (parts <= 1)
            {
                long total = 0;
                await using var input = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
                return await CopyAsync(input, temp, long.MaxValue, append: false, (read) =>
                {
                    total += read;
                    onChunk?.Invoke(total);
                }, token).ConfigureAwait(false);
            }

            var slices = Slices(size, parts);

            /* 某一段上次留了半成品时，不能再用这条「从 0 开始」的响应，所有段都单独发 Range */
            bool hasPartial = false;
            foreach (var slice in slices)
            {
                if (ExistingLength(PartPath(temp, slice.Index)) > 0) { hasPartial = true; break; }
            }

            if (hasPartial)
            {
                response.Dispose();
                return await DownloadPartsAsync(url, temp, slices, null, onChunk, token)
                    .ConfigureAwait(false);
            }

            return await DownloadPartsAsync(url, temp, slices, response, onChunk, token)
                .ConfigureAwait(false);
        }

        private static HttpRequestMessage RangeRequest(string url, long from, long? to)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Range = new RangeHeaderValue(from, to);

            // 默认头是给 API 用的 `Accept: application/json`，拿它下 jar 有的镜像会挑刺
            request.Headers.Accept.Clear();
            request.Headers.Accept.ParseAdd("*/*");
            return request;
        }

        private static string PartPath(string temp, int index) => temp + "." + index;

        /// <summary>分几段下：受「并发下载数」限制，小文件段数更少，每段不小于 512KB。</summary>
        private static int PartsFor(long size, bool ranged)
        {
            if (!ranged || size < PartThreshold) return 1;

            int wanted = DownloadManager.Parallelism;
            wanted = size < 8L * 1024 * 1024 ? Math.Min(wanted, 3) : Math.Min(wanted, 8);

            long maxBySize = (size + MinPartSize - 1) / MinPartSize;
            return (int)Math.Max(1, Math.Min(wanted, maxBySize));
        }

        private static List<(int Index, long From, long To)> Slices(long size, int parts)
        {
            long chunk = (size + parts - 1) / parts;
            var slices = new List<(int Index, long From, long To)>();
            for (int index = 0; index < parts; index += 1)
            {
                long from = index * chunk;
                if (from >= size) break;
                slices.Add((index, from, Math.Min(size - 1, from + chunk - 1)));
            }
            return slices;
        }

        /// <summary>
        /// 分段下载。已经下满的段直接跳过，下了一半的段按 Range 接着下 ——
        /// 暂停、崩溃、关软件之后重开都走这条路。
        /// </summary>
        private static async Task<long> DownloadPartsAsync(
            string url, string temp, List<(int Index, long From, long To)> slices,
            HttpResponseMessage? firstResponse, Action<long>? onChunk, CancellationToken token)
        {
            long downloaded = 0;
            foreach (var slice in slices)
            {
                downloaded += ExistingLength(PartPath(temp, slice.Index));
            }
            if (downloaded > 0) onChunk?.Invoke(downloaded);

            // 几段同时在读，进度是「所有段加起来」；这里把每段读到的字节累加后再回调
            Action<long>? progress = onChunk == null
                ? null
                : read => onChunk(Interlocked.Add(ref downloaded, read));

            var running = new List<Task>(slices.Count);
            foreach (var slice in slices)
            {
                var current = slice;
                long expected = current.To - current.From + 1;
                string partPath = PartPath(temp, current.Index);
                long have = ExistingLength(partPath);

                if (have > expected)
                {
                    TryDelete(partPath);
                    have = 0;
                }
                if (have == expected && expected > 0) continue;   // 这一段上次已经下完

                running.Add(Task.Run(async () =>
                {
                    using var response = current.Index == 0 && firstResponse != null && have == 0
                        ? firstResponse
                        : await SendAsync(
                            () => RangeRequest(url, current.From + have, current.To), token).ConfigureAwait(false);

                    if (response.StatusCode != HttpStatusCode.PartialContent)
                    {
                        throw new HttpError("服务器没有按分段返回内容（HTTP " + (int)response.StatusCode + "）");
                    }
                    await EnsureSuccessAsync(response, url).ConfigureAwait(false);

                    await using var input = await response.Content.ReadAsStreamAsync(token)
                        .ConfigureAwait(false);
                    await CopyAsync(input, partPath, expected - have, append: have > 0, progress, token)
                        .ConfigureAwait(false);

                    ExpectLength(partPath, expected);
                }, token));
            }

            await Task.WhenAll(running).ConfigureAwait(false);

            try
            {
                await using (var output = new FileStream(
                    temp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
                {
                    foreach (var slice in slices)
                    {
                        await using var stream = new FileStream(
                            PartPath(temp, slice.Index),
                            FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
                        await stream.CopyToAsync(output, 81920, token).ConfigureAwait(false);
                    }
                }
            }
            finally
            {
                foreach (var slice in slices) TryDelete(PartPath(temp, slice.Index));
            }

            return slices.Count > 0 ? slices[slices.Count - 1].To + 1 : 0;
        }

        /// <summary>分片大小必须和计划一致，短了说明这条连接被掐了（算抖动，留着分片下次接着下）。</summary>
        private static void ExpectLength(string partPath, long expected)
        {
            long actual = ExistingLength(partPath);
            if (actual != expected)
            {
                throw new HttpError(
                    "分段下载不完整（" + actual + " / " + expected + " 字节），连接被中断", null, true);
            }
        }

        private static long ExistingLength(string path)
        {
            try
            {
                var info = new FileInfo(path);
                return info.Exists ? info.Length : 0;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        /// <summary>
        /// 把流写进 path，limit 限制最多写多少字节；onDelta 收到每次读到的字节数，
        /// 分段下载就是靠它把几段的进度加在一起。append 为真时接着已有内容往后写（续传）。
        /// </summary>
        private static async Task<long> CopyAsync(
            Stream input, string path, long limit, bool append, Action<long>? onDelta, CancellationToken token)
        {
            await using var output = new FileStream(
                path,
                append ? FileMode.Append : FileMode.Create,
                FileAccess.Write, FileShare.None, 81920, useAsync: true);

            byte[] buffer = new byte[81920];
            long written = 0;
            while (written < limit)
            {
                int want = (int)Math.Min(buffer.Length, limit - written);
                int read = await input.ReadAsync(buffer.AsMemory(0, want), token).ConfigureAwait(false);
                if (read <= 0) break;

                await output.WriteAsync(buffer.AsMemory(0, read), token).ConfigureAwait(false);
                written += read;

                onDelta?.Invoke(read);
            }

            return written;
        }

        /// <summary>失败时把 temp 和所有分片一起删掉；取消（暂停 / 关软件）时不调它。</summary>
        private static void DeleteTempFamily(string temp)
        {
            TryDelete(temp);
            for (int index = 0; index < 16; index += 1) TryDelete(PartPath(temp, index));
        }

        public static string ToHex(byte[] data)
        {
            var builder = new StringBuilder(data.Length * 2);
            foreach (byte b in data) builder.Append(b.ToString("x2"));
            return builder.ToString();
        }

        public static string Sha1OfFile(string path)
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA1.Create();
            return ToHex(sha.ComputeHash(stream));
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (IOException)
            {
                // 删不掉就留着，下次下载会覆盖
            }
            catch (UnauthorizedAccessException)
            {
                // 同上
            }
        }
    }
}
