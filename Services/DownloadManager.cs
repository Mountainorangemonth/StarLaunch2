/*=====================================================================
   StarLaunch · 下载队列
   ---------------------------------------------------------------------
   一个启动器只需要一条下载线（和 PCL 一样）：任务排队，一个一个跑，
   进度实时回给网页。这样并发不会把家庭带宽撕成碎片，取消也简单。

   任务本体不在这里写，Enqueue 时传一个 `Func<DownloadJob, Task>`：
     · 原版安装见 Services\MinecraftInstaller.cs
     · Mod / 光影 / 材质 / 整合包见 Services\Modrinth.cs

   进度通知是节流的（180ms 一次），网页不会因为每秒几百个文件而卡死。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace StarLaunch.Services
{
    /// <summary>一条下载任务。计数器会被多个下载线程同时更新，所以全部用 Interlocked。</summary>
    internal sealed class DownloadJob
    {
        private int _done;
        private int _total;
        private long _bytes;
        private long _totalBytes;
        private long _speed;
        private long _lastSampleBytes;
        private long _lastSampleTick;
        private CancellationTokenSource _cts = new CancellationTokenSource();

        public DownloadJob(string kind, string name, string? target, Func<DownloadJob, Task> run)
        {
            Id = "dl" + Guid.NewGuid().ToString("n").Substring(0, 10);
            Kind = kind;
            Name = name;
            Target = target;
            RunAsync = run;
            _lastSampleTick = Environment.TickCount64;
        }

        public string Id { get; }
        public string Kind { get; }

        /// <summary>对着界面显示的名字（版本号 / Mod 名 / 文件全名）。</summary>
        public string Name { get; }

        /// <summary>装到哪儿（版本目录 / mods 目录），界面上鼠标悬停能看到。</summary>
        public string? Target { get; }

        public string Status { get; internal set; } = "queued";
        public string Phase { get; internal set; } = "排队中";
        public string? Error { get; internal set; }

        /// <summary>用户按了暂停。收尾时据此把状态记成 paused，而不是 canceled。</summary>
        public bool PauseRequested { get; private set; }

        public bool IsPaused => Status == "paused";

        /// <summary>成功后的补充说明（例如「已安装 12 个文件」）。</summary>
        public string? Detail { get; internal set; }

        public int Done => Volatile.Read(ref _done);
        public int Total => Volatile.Read(ref _total);
        public long Bytes => Interlocked.Read(ref _bytes);
        public long TotalBytes => Interlocked.Read(ref _totalBytes);

        /// <summary>瞬时速度（字节/秒），每半秒采样一次。</summary>
        public long Speed => Interlocked.Read(ref _speed);

        public bool IsFinished => Status == "done" || Status == "failed" || Status == "canceled";

        internal Func<DownloadJob, Task> RunAsync { get; }

        public CancellationToken Token => _cts.Token;

        public double Progress
        {
            get
            {
                long totalBytes = TotalBytes;
                if (totalBytes > 0)
                {
                    return Math.Min(100, Math.Round(Bytes * 100.0 / totalBytes, 1));
                }
                int total = Total;
                if (total > 0)
                {
                    return Math.Min(100, Math.Round(Done * 100.0 / total, 1));
                }
                return Status == "done" ? 100 : 0;
            }
        }

        /* ---- 进度上报（下载线程调用） ---- */

        public void SetPhase(string text)
        {
            Phase = text;
            DownloadManager.Notify();
        }

        public void SetCount(int done, int total)
        {
            Interlocked.Exchange(ref _done, done);
            Interlocked.Exchange(ref _total, total);
            DownloadManager.Notify();
        }

        public void SetTotalBytes(long total)
        {
            Interlocked.Exchange(ref _totalBytes, total);
            DownloadManager.Notify();
        }

        public void SetBytes(long done)
        {
            Interlocked.Exchange(ref _bytes, done);
            SampleSpeed();
            DownloadManager.Notify();
        }

        public void AddBytes(long delta)
        {
            long now = Interlocked.Add(ref _bytes, delta);
            SampleSpeedAt(now);
            DownloadManager.Notify();
        }

        /// <summary>一个文件下完了：计数 +1，并把进度通知放行。</summary>
        public void Step(int total)
        {
            Interlocked.Increment(ref _done);
            Interlocked.Exchange(ref _total, total);
            DownloadManager.Notify();
        }

        private void SampleSpeed()
        {
            SampleSpeedAt(Interlocked.Read(ref _bytes));
        }

        private void SampleSpeedAt(long bytes)
        {
            long now = Environment.TickCount64;
            long last = Interlocked.Read(ref _lastSampleTick);
            if (now - last < 500) return;

            long lastBytes = Interlocked.Exchange(ref _lastSampleBytes, bytes);
            if (Interlocked.CompareExchange(ref _lastSampleTick, now, last) != last) return;

            double seconds = (now - last) / 1000.0;
            if (seconds <= 0) return;
            long speed = (long)((bytes - lastBytes) / seconds);
            Interlocked.Exchange(ref _speed, Math.Max(0, speed));
        }

        internal void Cancel()
        {
            try
            {
                if (!_cts.IsCancellationRequested) _cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // 任务已经结束了
            }
        }

        /// <summary>
        /// 暂停：打断下载线程，但保留 .part / 已经下完的文件，状态记成 paused。
        /// 关掉启动器再打开也走「重新入队 → 跳过已有文件 → 续传 .part」这条路。
        /// </summary>
        internal void RequestPause()
        {
            PauseRequested = true;
            Cancel();
        }

        /// <summary>排队中的任务还没开跑，直接把暂停标记打上就行。</summary>
        internal void MarkPaused() => PauseRequested = true;

        /// <summary>
        /// 继续：换一个新的取消源（旧的那个已经被取消了），计数器归零后重新排队。
        /// 进度归零是为了不和上一次的字节数重复累加 —— 重新跑起来的第一步就会把
        /// 已经下好的部分按断点续传补回进度里。
        /// </summary>
        internal void PrepareResume()
        {
            PauseRequested = false;
            try { _cts.Dispose(); } catch (Exception) { /* 已经释放过 */ }
            _cts = new CancellationTokenSource();

            Status = "queued";
            Phase = "排队中";
            Error = null;

            Interlocked.Exchange(ref _bytes, 0);
            Interlocked.Exchange(ref _totalBytes, 0);
            Interlocked.Exchange(ref _done, 0);
            Interlocked.Exchange(ref _total, 0);
            Interlocked.Exchange(ref _speed, 0);
            Interlocked.Exchange(ref _lastSampleBytes, 0);
            Interlocked.Exchange(ref _lastSampleTick, Environment.TickCount64);
        }

        /// <summary>任务收尾：把总字节数对齐到已下载量，进度条停在 100%。</summary>
        internal void Complete()
        {
            long bytes = Bytes;
            Interlocked.Exchange(ref _totalBytes, Math.Max(bytes, TotalBytes));
            Interlocked.Exchange(ref _done, Math.Max(Done, Total));
            Interlocked.Exchange(ref _speed, 0);
        }

        internal void Dispose() => _cts.Dispose();

        /// <summary>回给网页的样子（小驼峰，postMessage 不会自动转换）。</summary>
        public Dictionary<string, object?> ToView()
        {
            return new Dictionary<string, object?>
            {
                ["id"] = Id,
                ["kind"] = Kind,
                ["name"] = Name,
                ["target"] = Target,
                ["status"] = Status,
                ["phase"] = Phase,
                ["done"] = Done,
                ["total"] = Total,
                ["bytes"] = Bytes,
                ["bytesTotal"] = TotalBytes,
                ["speed"] = Speed,
                ["progress"] = Progress,
                ["error"] = Error,
                ["detail"] = Detail
            };
        }
    }

    internal static class DownloadManager
    {
        private static readonly List<DownloadJob> Jobs = new List<DownloadJob>();
        private static readonly SemaphoreSlim Signal = new SemaphoreSlim(0);
        private static readonly object Gate = new object();
        private static bool _workerStarted;
        private static long _lastNotify;
        private static int _parallelism = 6;

        /// <summary>同时下几个文件（设置页的「并发下载数」）。1~16，超出自动收敛。</summary>
        public static int Parallelism
        {
            get => _parallelism;
            set => _parallelism = Math.Clamp(value, 1, 16);
        }

        /// <summary>进度 / 状态变化（已节流）。订阅方负责切回 UI 线程。</summary>
        public static event Action? Changed;

        /// <summary>任务结束（成功 / 失败 / 取消）。</summary>
        public static event Action<DownloadJob>? Finished;

        public static DownloadJob Enqueue(string kind, string name, string? target, Func<DownloadJob, Task> run)
        {
            var job = new DownloadJob(kind, name, target, run);
            lock (Gate)
            {
                Jobs.Add(job);
                // 只留最近 40 条，免得跑久了列表无限长
                if (Jobs.Count > 40) Jobs.RemoveAll(item => item.IsFinished && item != job);
                StartWorkerLocked();
            }
            Signal.Release();
            NotifyNow();
            return job;
        }

        public static List<DownloadJob> Snapshot()
        {
            lock (Gate)
            {
                return Jobs.ToList();
            }
        }

        public static bool Cancel(string? id)
        {
            DownloadJob? job;
            lock (Gate)
            {
                job = Jobs.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
            }
            if (job == null || job.IsFinished) return false;

            job.Cancel();
            if (job.Status == "queued" || job.Status == "paused")
            {
                job.Status = "canceled";
                job.Phase = "已取消";
                job.Dispose();
                NotifyNow();
                RaiseFinished(job);
            }
            return true;
        }

        /// <summary>暂停一个任务（排队中直接暂停，正在跑的打断下载线程后收尾成 paused）。</summary>
        public static bool Pause(string? id)
        {
            DownloadJob? job;
            lock (Gate)
            {
                job = Jobs.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
            }
            if (job == null || job.IsFinished || job.Status == "paused") return false;

            if (job.Status == "queued")
            {
                job.Status = "paused";
                job.Phase = "已暂停";
                job.MarkPaused();
                NotifyNow();
                return true;
            }

            job.Phase = "正在暂停…";
            job.RequestPause();
            NotifyNow();
            return true;
        }

        /// <summary>继续一个已暂停的任务：重新排队，worker 会重跑一遍 RunAsync。</summary>
        public static bool Resume(string? id)
        {
            DownloadJob? job;
            lock (Gate)
            {
                job = Jobs.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
            }
            if (job == null || job.Status != "paused") return false;

            job.PrepareResume();
            Signal.Release();
            NotifyNow();
            return true;
        }

        /// <summary>清掉已经结束的任务（网页上的「清空已完成」）。</summary>
        public static void ClearFinished()
        {
            lock (Gate)
            {
                Jobs.RemoveAll(item => item.IsFinished);
            }
            NotifyNow();
        }

        /// <summary>节流后的进度通知：最多 180ms 一次。</summary>
        public static void Notify()
        {
            long now = Environment.TickCount64;
            long last = Interlocked.Read(ref _lastNotify);
            if (now - last < 180) return;
            if (Interlocked.CompareExchange(ref _lastNotify, now, last) != last) return;
            RaiseChanged();
        }

        public static void NotifyNow()
        {
            Interlocked.Exchange(ref _lastNotify, Environment.TickCount64);
            RaiseChanged();
        }

        private static void RaiseChanged()
        {
            try
            {
                Changed?.Invoke();
            }
            catch (Exception)
            {
                // 界面订阅者出错不该影响下载
            }
        }

        private static void RaiseFinished(DownloadJob job)
        {
            try
            {
                Finished?.Invoke(job);
            }
            catch (Exception)
            {
                // 同上
            }
        }

        private static void StartWorkerLocked()
        {
            if (_workerStarted) return;
            _workerStarted = true;
            _ = Task.Run(WorkerAsync);
        }

        /// <summary>队列的消费者：一次只跑一个任务。</summary>
        private static async Task WorkerAsync()
        {
            while (true)
            {
                await Signal.WaitAsync().ConfigureAwait(false);

                while (true)
                {
                    DownloadJob? job;
                    lock (Gate)
                    {
                        job = Jobs.FirstOrDefault(item => item.Status == "queued");
                        if (job == null) break;
                        job.Status = "running";
                        job.Phase = "准备中…";
                    }

                    NotifyNow();
                    var stopwatch = Stopwatch.StartNew();
                    try
                    {
                        await job.RunAsync(job).ConfigureAwait(false);
                        if (job.Token.IsCancellationRequested)
                        {
                            job.Status = "canceled";
                            job.Phase = "已取消";
                        }
                        else
                        {
                            job.Status = "done";
                            job.Phase = "已完成";
                            job.Complete();
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        job.Status = "canceled";
                        job.Phase = "已取消";
                    }
                    catch (Exception ex)
                    {
                        job.Status = "failed";
                        job.Phase = "失败";
                        job.Error = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message;
                    }
                    finally
                    {
                        stopwatch.Stop();
                        // 暂停的任务还要能继续，取消源和对象都留着
                        if (!job.PauseRequested) job.Dispose();
                    }

                    /* 暂停不是「结束」：留着对象和 .part，等用户点继续 */
                    if (job.PauseRequested && job.Status != "done" && job.Status != "failed")
                    {
                        job.Status = "paused";
                        job.Phase = "已暂停";
                        NotifyNow();
                        continue;
                    }

                    NotifyNow();
                    RaiseFinished(job);
                }
            }
        }
    }
}
