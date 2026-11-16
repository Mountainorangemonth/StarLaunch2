/*=====================================================================
   StarLaunch · 系统动作：内存优化
   ---------------------------------------------------------------------
   主页快捷操作里的「内存优化」→ 网页发 `memory-optimize` → 这里跑一次
   Services/MemoryOptimizer，结果以 `memory-result` 回给页面：
     { ok, pending, error, totalBytes, beforeBytes, afterBytes, freedBytes,
       processes, detail, elapsedMs, elevated }
   清理动作是 library.c 那套「空闲感知」算法的 C# 移植，见 MemoryOptimizer.Cleanup()。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>0 = 空闲，1 = 正在跑。后台线程和界面线程都会读写，所以用 Interlocked。</summary>
        private int _memoryOptimizing;

        /// <summary>网页点了「内存优化」。同一时间只允许跑一次。</summary>
        private void OptimizeMemory()
        {
            if (Interlocked.CompareExchange(ref _memoryOptimizing, 1, 0) != 0)
            {
                PostPageMessage("memory-result", new Dictionary<string, object?>
                {
                    ["ok"] = false,
                    ["error"] = "上一次内存优化还没结束，稍等一会儿"
                });
                return;
            }

            PostPageMessage("memory-start", new Dictionary<string, object?>());

            _ = Task.Run(async () =>
            {
                MemoryOptimizeResult result;
                try
                {
                    result = await MemoryOptimizer.OptimizeAsync(CancellationToken.None).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    result = new MemoryOptimizeResult
                    {
                        Ok = false,
                        Error = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message
                    };
                }
                finally
                {
                    Interlocked.Exchange(ref _memoryOptimizing, 0);
                }

                try
                {
                    Dispatcher.BeginInvoke(new Action(() => PostPageMessage("memory-result", result.ToView())));
                }
                catch (Exception)
                {
                    // 窗口已经关掉了
                }
            });
        }
    }
}
