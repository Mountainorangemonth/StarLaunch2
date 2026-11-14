/* =====================================================================
   StarLaunch · 路由
   ---------------------------------------------------------------------
   四个主视图之间的切换与滑动过渡。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$ } = SL.core;
    const { ROUTES } = SL.data;
    const uiMod = SL.core.mod('ui');
    const closePopovers = (...args) => uiMod.closePopovers(...args);
    const syncRailGlide = (...args) => {
        if (typeof uiMod.syncRailGlide === 'function') uiMod.syncRailGlide(...args);
    };

    /* -----------------------------------------------------------------
       路由
       ----------------------------------------------------------------- */
    function routeName() {
        const hash = (location.hash || '').replace(/^#\/?/, '');
        return Object.prototype.hasOwnProperty.call(ROUTES, hash) ? hash : 'home';
    }

    function staggerView(view) {
        if (!view) return;
        const blocks = $$('.page-head, .hero, .slab, .panel, .set-head, .set-block, .about, .tip', view);
        blocks.forEach((el, index) => {
            el.style.setProperty('--stagger', String(Math.min(index, 7)));
        });
    }

    /* 路由顺序决定滑动方向：往后翻页 = 新页从右侧进来，往前翻反之 */
    const ROUTE_ORDER = Object.keys(ROUTES);
    const LEAVE_MS = 260;
    let leavingView = null;
    let leavingTimer = 0;

    function slideDirection(fromName, toName) {
        const from = ROUTE_ORDER.indexOf(fromName);
        const to = ROUTE_ORDER.indexOf(toName);
        if (from === -1 || to === -1 || from === to) return 1;
        return to > from ? 1 : -1;
    }

    function clearLeaving() {
        window.clearTimeout(leavingTimer);
        if (leavingView) {
            leavingView.classList.remove('is-leaving');
            leavingView.style.removeProperty('--slide-dir');
            leavingView = null;
        }
    }

    /**
     * 旧页面先变成一张绝对定位的「残影图层」再淡出：
     * 顺序是先挂 class、后切 is-active，否则 display:none 会直接把它吃掉，
     * 根本看不到滑出过程。布局交给新页面接管，所以不会跳一下。
     */
    function startLeave(view, direction) {
        clearLeaving();
        leavingView = view;
        view.classList.add('is-leaving');
        view.style.setProperty('--slide-dir', String(direction));
        leavingTimer = window.setTimeout(clearLeaving, LEAVE_MS + 40);
    }

    function applyRoute() {
        const name = routeName();
        const route = ROUTES[name];
        const previous = $('.view.is-active');
        const previousName = previous ? previous.dataset.view : null;
        const next = $('.view[data-view="' + name + '"]');
        const direction = slideDirection(previousName, name);

        if (previous && next && previous !== next) {
            startLeave(previous, direction);
            next.style.setProperty('--slide-dir', String(direction));
        }

        $$('.view').forEach((view) => view.classList.toggle('is-active', view === next));
        $$('.rail-item[data-nav]').forEach((btn) => {
            const active = btn.dataset.nav === name;
            btn.classList.toggle('is-active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        // 导航的选中块同时滑过去，和高亮换页看起来是一件事
        syncRailGlide();
        const crumb = $('#tbCrumb');
        if (crumb) crumb.textContent = route.crumb;
        document.title = route.title;
        const stage = $('#stage');
        if (stage) stage.scrollTop = 0;
        if (name !== previousName) staggerView(next);
        closePopovers();
    }

    function go(view) {
        if (!ROUTES[view]) return;
        if (location.hash === '#' + view) applyRoute();
        else location.hash = view;
    }

    SL.router = Object.assign(SL.router || {}, { routeName, staggerView, ROUTE_ORDER, LEAVE_MS, slideDirection, clearLeaving, startLeave, applyRoute, go });
})(window);
