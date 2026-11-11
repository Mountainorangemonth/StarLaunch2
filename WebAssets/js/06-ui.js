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

    SL.ui = Object.assign(SL.ui || {}, { repositionPopovers, toast, closePopovers, positionAccountPop, toggleInstancePicker, toggleAccountPopover, bindPopovers, bindQuote, bindIdle, bindKeyboard });
})(window);
