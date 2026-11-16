/*=====================================================================
   StarLaunch · 账户接口
   ---------------------------------------------------------------------
   GET /api/accounts  当前账号列表 + 选中的那个 + 微软应用 ID 的配置状态
   GET /api/skin      某个账号的皮肤 PNG（网页裁出头像）

   网页只拿到账号的「展示版」：令牌一律不出宿主。
   =====================================================================*/
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Web.WebView2.Core;
using StarLaunch.Services;

namespace StarLaunch
{
    public partial class MainWindow
    {
        /// <summary>GET /api/accounts</summary>
        private void RespondAccounts(CoreWebView2WebResourceRequestedEventArgs e)
        {
            var accounts = AccountStore.All.Select(item => item.ToView()).ToList();
            var selected = AccountStore.Selected;

            RespondJson(e, 200, new
            {
                ok = true,
                accounts,
                selected = selected?.ToView(),
                // 只回脱敏串：完整 client_id 没必要出现在网页里
                hasClientId = AccountService.HasClientId,
                clientId = AccountService.MaskedClientId,
                clientIdFromEnv = AccountService.ClientIdFromEnvironment,
                builtInClientId = AccountService.UsingBuiltInClientId,
                authority = AccountService.Authority,
                // 账号文件的位置：设置里可以让用户直接打开它做备份
                path = AccountStore.FilePath
            });
        }

        /// <summary>
        /// GET /api/skin?account=&lt;id&gt;
        /// 皮肤要从网上下，而 WebView2 的资源回调是同步的：这里用 deferral 把回复推迟到下载完成。
        /// </summary>
        private async void RespondSkinAsync(CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
        {
            CoreWebView2Deferral? deferral = null;
            try
            {
                deferral = e.GetDeferral();
            }
            catch (Exception)
            {
                // 旧版 WebView2 没有 deferral：只能放弃这次请求
                RespondNotFound(e);
                return;
            }

            try
            {
                string? id = ReadQueryValue(uri, "account");
                var account = AccountStore.Find(id) ?? AccountStore.Selected;
                if (account == null)
                {
                    RespondNotFound(e);
                    return;
                }

                byte[]? bytes = await SkinService.GetSkinAsync(account, CancellationToken.None)
                    .ConfigureAwait(true);
                if (bytes == null || bytes.Length == 0)
                {
                    RespondNotFound(e);
                    return;
                }

                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    new MemoryStream(bytes), 200, "OK",
                    "Content-Type: image/png\r\nCache-Control: max-age=600");
            }
            catch (Exception)
            {
                try { RespondNotFound(e); }
                catch (Exception) { /* 响应已经断开了 */ }
            }
            finally
            {
                try { deferral?.Complete(); }
                catch (Exception) { /* 已完成 */ }
            }
        }
    }
}
