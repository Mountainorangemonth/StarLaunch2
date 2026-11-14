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
            try {
                webview.postMessage(message);
                return true;
            } catch (err) {
                return false;
            }
        }
        return false;
    }

    /* -----------------------------------------------------------------
       宿主动作的回执
       -----------------------------------------------------------------
       打开文件 / 文件夹 / 链接都在宿主里执行，结果以 open-result 回来：
         · 成功 → 一句 toast（「已打开壁纸文件夹」），不用弹窗；
         · 失败 → 项目自己的 .modal 浮层把原因写清楚（文件夹不存在、没有
           关联程序、Win32 错误码……）；
         · 超时没回音 → 同样弹浮层，提示宿主没响应。
       以前这些失败全被宿主 catch 住，界面表现就是「点了没反应」。
       ----------------------------------------------------------------- */
    const OPEN_TIMEOUT = 2500;
    const pendingOpens = new Map();
    let openSeq = 0;

    let noticeOpen = false;

    function notice(title, message) {
        // 同一时间只开一个提示框：两个错误叠在一起会互相遮住按钮
        if (noticeOpen) {
            toast(title + '：' + message, 'i-info');
            return;
        }
        if (typeof uiMod.dialog !== 'function') {
            window.alert(title + '\n\n' + message);
            return;
        }
        noticeOpen = true;
        const done = () => { noticeOpen = false; };
        uiMod.dialog({ title: title, message: message, okLabel: '知道了', cancelLabel: null })
            .then(done, done);
    }

    /**
     * 让宿主打开一个位置。
     *   openLocation('open-game-dir', { path }, '游戏文件夹')
     * label 只用于成功后的提示文案。
     */
    function openLocation(type, payload, label) {
        const id = 'open' + (++openSeq);
        const message = Object.assign({ type: type, id: id }, payload || {});

        // 先把 waiting 记下来再发：宿主快到「同步」回包时才不会漏掉这次等待
        const entry = {
            label: label || '',
            timer: window.setTimeout(() => {
                pendingOpens.delete(id);
                notice('启动器没有响应',
                    '请求已经发出，但一直没有收到启动器的回音。\n\n' +
                    '可以重启 StarLaunch 再试一次；如果一直这样，多半是宿主那边卡住了。');
            }, OPEN_TIMEOUT)
        };
        pendingOpens.set(id, entry);

        if (!hostPost(message)) {
            window.clearTimeout(entry.timer);
            pendingOpens.delete(id);
            notice('只有启动器里才能打开', '这个按钮要在 StarLaunch 里才有效；浏览器预览里没有权限打开本机的位置。');
            return false;
        }
        return true;
    }

    function settleOpen(data) {
        const id = data.id == null ? '' : String(data.id);
        const pending = id ? pendingOpens.get(id) : null;
        if (pending) {
            window.clearTimeout(pending.timer);
            pendingOpens.delete(id);
        }

        if (data.ok) {
            // 自己登记过的请求才提示；老调用点直接 post 过去的，不打扰用户
            if (pending) toast(pending.label ? '已打开' + pending.label : '已打开', 'i-folder');
            return;
        }

        const message = (data.error || '系统没有给出原因') + (data.path ? '\n\n' + data.path : '');

        // 提权状态下打不开文件夹：Windows 不允许提权进程驱动资源管理器，这不是权限不够，
        // 而是权限太够。给一个「以普通权限重启」的出口，比只显示原因有用。
        if (data.elevated === true && typeof uiMod.dialog === 'function') {
            if (noticeOpen) {
                toast('打不开这个位置：' + message, 'i-info');
                return;
            }
            noticeOpen = true;
            const done = () => { noticeOpen = false; };
            uiMod.dialog({
                title: '打不开这个位置',
                message: message,
                okLabel: '以普通权限重启',
                cancelLabel: '知道了'
            }).then((confirmed) => {
                done();
                if (!confirmed) return;
                if (!hostPost({ type: 'restart-as-user' })) return;
                toast('正在以普通权限重启 StarLaunch…', 'i-refresh');
            }, done);
            return;
        }

        notice('打不开这个位置', message);
    }

    function onHostError(data) {
        notice(data.title || '启动器出错了', data.message || '没有更多信息');
    }

    /** 只处理自己关心的回包，别的消息各模块自己监听。 */
    function bindHostMessages() {
        const webview = window.chrome && window.chrome.webview;
        if (!webview || typeof webview.addEventListener !== 'function') return;

        webview.addEventListener('message', (event) => {
            let data = event.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (err) { return; }
            }
            if (!data || typeof data.type !== 'string') return;
            if (data.type === 'open-result') settleOpen(data);
            else if (data.type === 'host-error') onHostError(data);
            else if (data.type === 'restart-result' && !data.ok) {
                notice('没能以普通权限重启', data.error || '系统没有给出原因');
            }
        });
    }

    /* -----------------------------------------------------------------
       页面自己的报错
       -----------------------------------------------------------------
       宿主关掉了 DevTools，脚本出错时控制台谁也看不见。这里把
       error / unhandledrejection 接住，用同一个浮层显示出来；
       同一条错误只弹一次，一次会话最多弹三条，免得循环出错把界面堵死。
       ----------------------------------------------------------------- */
    function bindPageErrors() {
        const seen = new Set();
        let shown = 0;

        const report = (message) => {
            const text = String(message || '未知错误').slice(0, 600);
            if (shown >= 3 || seen.has(text)) return;
            seen.add(text);
            shown += 1;
            notice('页面脚本出错了', text);
        };

        window.addEventListener('error', (event) => {
            const where = event.filename ? '\n\n' + event.filename + ':' + (event.lineno || 0) : '';
            report((event.message || '未知错误') + where);
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            report(reason && (reason.stack || reason.message) ? (reason.stack || reason.message) : String(reason));
        });
    }

    /* -----------------------------------------------------------------
       确认框
       -----------------------------------------------------------------
       确认框由网页自己画（06-ui.js 的 dialog()），宿主不再弹系统窗口。
       和 Custom.xaml 的 MyDialog 一样走 .modal 材质：同一个圆角、同一套
       配色和动画，也会跟着页面缩放和深浅色模式走。
       ----------------------------------------------------------------- */
    /**
     * 弹一个确认浮层，返回 Promise<boolean>。
     *   confirmDialog({ title, message, danger, okLabel, cancelLabel })
     * danger 为真时确定按钮是红底，默认焦点在「取消」。
     */
    function confirmDialog(options) {
        if (typeof uiMod.dialog === 'function') return uiMod.dialog(options);
        // 极端情况下 UI 模块没就位（脚本顺序被改过），退化成浏览器自带确认框
        return Promise.resolve(window.confirm((options && options.message) || '确定要继续吗？'));
    }

    /* ── Markdown ────────────────────────────────────────── */

    /* 事件绑定 */
    function bindHost() {
        detectHost();
        bindHostMessages();
        bindPageErrors();

        /* 标题栏 */
        $$('.tb-btn[data-win]').forEach((btn) => {
            btn.addEventListener('click', () => handleWindowControl(btn.dataset.win));
        });
    }

    SL.host = Object.assign(SL.host || {}, {
        handleWindowControl, detectHost, hostPost, hasHost, bindHost, confirmDialog,
        openLocation, settleOpen, notice
    });
})(window);
