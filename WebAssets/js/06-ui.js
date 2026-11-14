/* =====================================================================
   StarLaunch · 通用 UI：Toast、浮层、快捷键
   ---------------------------------------------------------------------
   跨页面共用的小交互，和具体业务无关。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, escapeHtml } = SL.core;
    const { QUOTES } = SL.data;
    const homeMod = SL.core.mod('home');
    const renderInstanceOptions = (...args) => homeMod.renderInstanceOptions(...args);
    const launchMod = SL.core.mod('launch');
    const closeLaunch = (...args) => launchMod.closeLaunch(...args);

    let quoteIndex = 0;

    /* -----------------------------------------------------------------
       Toast
       ----------------------------------------------------------------- */
    function toast(message, icon) {
        const host = $('#toasts');
        if (!host) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + escapeHtml(message) + '</span>';
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-in'));
        while (host.children.length > 3) host.firstElementChild.remove();
        window.setTimeout(() => {
            el.classList.remove('is-in');
            window.setTimeout(() => el.remove(), 220);
        }, 2600);
    }


    /* -----------------------------------------------------------------
       确认弹窗
       -----------------------------------------------------------------
       和 Custom.xaml 里的 MyDialog 一样，确认框是网页自己画的浮层，
       宿主不再弹系统 MessageBox：这样按钮、圆角、配色、动画全走同一套
       材质，也会跟着网页缩放和深浅色模式走。

       约定：危险操作把焦点放在「取消」上，回车不会误删东西；
       Esc 和点遮罩都算取消。
       ----------------------------------------------------------------- */
    let dialogSeq = 0;

    /**
     * 打开确认弹窗，返回 Promise<boolean>（确定 true / 取消 false）。
     *   dialog({ title, message, danger, okLabel, cancelLabel })
     * message 里的 \n 原样保留（CSS 用 white-space: pre-wrap）。
     */
    function dialog(options) {
        const opts = options || {};
        const title = String(opts.title || 'StarLaunch');
        const message = String(opts.message || '确定要继续吗？');
        const danger = opts.danger === true;
        const okLabel = String(opts.okLabel || '确定');
        const cancelLabel = String(opts.cancelLabel || '取消');

        closePopovers(); // 弹窗盖住页面时，先把菜单 / 浮层收掉

        return new Promise((resolve) => {
            const titleId = 'dialogTitle' + (++dialogSeq);
            const previousFocus = document.activeElement;

            const modal = document.createElement('div');
            modal.className = 'modal confirm-modal';

            const scrim = document.createElement('div');
            scrim.className = 'modal-scrim';

            const card = document.createElement('div');
            card.className = 'modal-card confirm-card';
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-modal', 'true');
            card.setAttribute('aria-labelledby', titleId);

            const head = document.createElement('div');
            head.className = 'confirm-head';

            const mark = document.createElement('span');
            mark.className = 'confirm-mark' + (danger ? ' is-danger' : '');
            mark.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-info"/></svg>';

            const copy = document.createElement('div');
            copy.className = 'confirm-copy';
            const heading = document.createElement('h2');
            heading.id = titleId;
            heading.textContent = title;
            copy.appendChild(heading);

            head.appendChild(mark);
            head.appendChild(copy);

            const body = document.createElement('p');
            body.className = 'confirm-body';
            body.textContent = message;

            const actions = document.createElement('div');
            actions.className = 'confirm-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-ghost';
            cancelBtn.textContent = cancelLabel;

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-filled');
            okBtn.textContent = okLabel;

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);

            card.appendChild(head);
            card.appendChild(body);
            card.appendChild(actions);
            modal.appendChild(scrim);
            modal.appendChild(card);

            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                modal.classList.add('is-out');
                window.setTimeout(() => modal.remove(), 160);
                // 关掉后把焦点还回原处，键盘操作不丢位置
                if (previousFocus && previousFocus !== document.body &&
                    document.contains(previousFocus)) {
                    try { previousFocus.focus({ preventScroll: true }); } catch (err) { /* 元素已不可聚焦 */ }
                }
                resolve(ok);
            };

            scrim.addEventListener('click', () => finish(false));
            cancelBtn.addEventListener('click', () => finish(false));
            okBtn.addEventListener('click', () => finish(true));

            // 键盘只作用在弹窗内：Esc 取消，Tab 在两个按钮之间循环
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                    return;
                }
                if (event.key !== 'Tab') return;
                const buttons = [cancelBtn, okBtn];
                const index = buttons.indexOf(document.activeElement);
                event.preventDefault();
                const next = event.shiftKey
                    ? buttons[index <= 0 ? buttons.length - 1 : index - 1]
                    : buttons[(index + 1) % buttons.length];
                next.focus({ preventScroll: true });
            });

            document.body.appendChild(modal);
            (danger ? cancelBtn : okBtn).focus({ preventScroll: true });
        });
    }


    /* -----------------------------------------------------------------
       浮层
       ----------------------------------------------------------------- */
    function closePopovers() {
        const instPop = $('#instPop');
        const instTrigger = $('#instPicker');
        if (instPop) instPop.hidden = true;
        if (instTrigger) instTrigger.setAttribute('aria-expanded', 'false');
        const slab = $('.slab--launch');
        if (slab) slab.classList.remove('is-expanded');
        const accountPop = $('#accountPop');
        const accountTrigger = $('#railAvatar');
        if (accountPop) accountPop.hidden = true;
        if (accountTrigger) accountTrigger.setAttribute('aria-expanded', 'false');
    }

    function positionAccountPop() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = pop.offsetWidth || 288;
        const left = Math.min(window.innerWidth - width - 14, rect.right + 12);
        pop.style.left = Math.max(14, left) + 'px';
        pop.style.bottom = Math.max(14, window.innerHeight - rect.bottom - 6) + 'px';
        pop.style.top = 'auto';
    }

    function toggleInstancePicker() {
        const pop = $('#instPop');
        const trigger = $('#instPicker');
        const slab = $('.slab--launch');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            renderInstanceOptions();
            const accountPop = $('#accountPop');
            if (accountPop) accountPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (slab) slab.classList.toggle('is-expanded', willOpen);
    }

    function toggleAccountPopover() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            const instPop = $('#instPop');
            if (instPop) instPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) positionAccountPop();
    }


    /* 事件绑定 */
    function bindPopovers() {
        /* 实例选择器 */
        const instPicker = $('#instPicker');
        if (instPicker) {
            instPicker.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleInstancePicker();
            });
    }

    /* 账户浮层 */
    const railAvatar = $('#railAvatar');
    if (railAvatar) {
        railAvatar.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleAccountPopover();
        });
    }
    const accountPop = $('#accountPop');
    if (accountPop) {
        accountPop.addEventListener('click', (event) => {
            if (event.target.closest('.pop-item, .link')) closePopovers();
        });
    }

    }

    /* 事件绑定 */
    function bindQuote() {
        /* 换一句 */
        const quoteBtn = $('#quoteBtn');
        if (quoteBtn) {
            quoteBtn.addEventListener('click', () => {
                quoteIndex = (quoteIndex + 1) % QUOTES.length;
                const el = $('#heroQuote');
                if (el) el.textContent = QUOTES[quoteIndex];
                quoteBtn.classList.remove('is-spin');
                void quoteBtn.offsetWidth;
                quoteBtn.classList.add('is-spin');
            });
    }

    }

    /* 事件绑定 */
    function bindIdle() {
        /* 后台时暂停装饰动画 */
        document.addEventListener('visibilitychange', () => {
            document.documentElement.classList.toggle('is-idle', document.hidden);
        });

    }

    /* 事件绑定 */
    function bindKeyboard() {
        /* 键盘 */
        document.addEventListener('keydown', (event) => {
            // 屏蔽打开控制台 / 查看源代码的快捷键。
            // 宿主已经关掉 DevTools，这里再兜一层，避免焦点在网页上时被浏览器绕过。
            const key = (event.key || '').toLowerCase();
            if (event.key === 'F12' ||
                (event.ctrlKey && event.shiftKey && ['i', 'j', 'c', 'k'].indexOf(key) !== -1) ||
                (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'u')) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (event.key !== 'Escape') return;
            const modal = $('#launchModal');
            if (modal && !modal.hidden) {
                closeLaunch();
                return;
            }
            closePopovers();
        });
    }

    /** 窗口尺寸变化后，浮层要跟着挪位置 */
    function repositionPopovers() {
        const pop = $('#accountPop');
        if (pop && !pop.hidden) positionAccountPop();
    }

    SL.ui = Object.assign(SL.ui || {}, { repositionPopovers, toast, dialog, closePopovers, positionAccountPop, toggleInstancePicker, toggleAccountPopover, bindPopovers, bindQuote, bindIdle, bindKeyboard });
})(window);
