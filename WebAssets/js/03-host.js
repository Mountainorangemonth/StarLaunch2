/* =====================================================================
   StarLaunch · 宿主桥接
   ---------------------------------------------------------------------
   WebView2 消息、窗口按钮、宿主能力探测。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$ } = SL.core;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);

    /* -----------------------------------------------------------------
       标题栏 / 宿主桥接
       ----------------------------------------------------------------- */
    function handleWindowControl(action) {
        const labels = { minimize: '最小化', maximize: '最大化', close: '关闭' };
        const api = window.starLaunch && window.starLaunch.window;
        if (api && typeof api[action] === 'function') {
            api[action]();
            return;
        }
        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
            window.chrome.webview.postMessage({ type: 'window-control', action: action });
            return;
        }
        const event = new CustomEvent('starlaunch:window-control', { cancelable: true, detail: { action: action } });
        const handled = !window.dispatchEvent(event);
        if (!handled) toast('已发送「' + labels[action] + '」窗口指令', 'i-info');
    }

    function detectHost() {
        const ua = navigator.userAgent;
        const host = $('#heroHost');
        if (!host) return;
        let label = 'Windows 11';
        if (/Windows NT 10/.test(ua)) label = 'Windows 11';
        else if (/Windows NT 6\.3/.test(ua)) label = 'Windows 8.1';
        else if (/Mac OS X/.test(ua)) label = 'macOS';
        else if (/Linux/.test(ua)) label = 'Linux';
        if (/Edg\//.test(ua)) label += ' · Edge WebView2';
        host.textContent = label;

        const engine = $('#engineInfo');
        if (engine) {
            const match = ua.match(/Chrom(e|ium)\/(\d+)/);
            engine.textContent = match ? 'Chromium ' + match[2] : 'Chromium';
        }
    }



    const hasHost = () => Boolean(window.chrome && window.chrome.webview &&
        typeof window.chrome.webview.postMessage === 'function');


    function hostPost(message) {
        const webview = window.chrome && window.chrome.webview;
        if (webview && typeof webview.postMessage === 'function') {
            webview.postMessage(message);
            return true;
        }
        return false;
    }

    /* ── Markdown ────────────────────────────────────────── */

    /* 事件绑定 */
    function bindHost() {
        detectHost();

        /* 标题栏 */
        $$('.tb-btn[data-win]').forEach((btn) => {
            btn.addEventListener('click', () => handleWindowControl(btn.dataset.win));
        });
    }

    SL.host = Object.assign(SL.host || {}, { handleWindowControl, detectHost, hostPost, hasHost, bindHost });
})(window);
