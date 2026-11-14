/* =====================================================================
   StarLaunch · 全局事件委托
   ---------------------------------------------------------------------
   一次点击可能落到任何模块，这里统一分发。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $ } = SL.core;
    const routerMod = SL.core.mod('router');
    const go = (...args) => routerMod.go(...args);
    const uiMod = SL.core.mod('ui');
    const closePopovers = (...args) => uiMod.closePopovers(...args);
    const toast = (...args) => uiMod.toast(...args);
    const versionsMod = SL.core.mod('versions');
    const selectInstance = (...args) => versionsMod.selectInstance(...args);
    const downloadMod = SL.core.mod('download');
    const startDownload = (...args) => downloadMod.startDownload(...args);
    const appearanceMod = SL.core.mod('appearance');
    const renderWallpaperUI = (...args) => appearanceMod.renderWallpaperUI(...args);

    /* 事件绑定 */
    function bindGlobalClicks() {
        /* 全局点击委托 */
        document.addEventListener('click', (event) => {
            const nav = event.target.closest('[data-nav]');
            if (nav) {
                event.preventDefault();
                go(nav.dataset.nav);
                return;
            }
            const navLink = event.target.closest('[data-nav-link]');
            if (navLink) {
                event.preventDefault();
                go(navLink.dataset.navLink);
                return;
            }
            const toastBtn = event.target.closest('[data-toast]');
            if (toastBtn) toast(toastBtn.dataset.toast);

            const copyJvm = event.target.closest('[data-copy-jvm]');
            if (copyJvm) {
                const code = $('#launchJvmArgs');
                const text = code ? code.value.trim() : '';
                if (navigator.clipboard && text) {
                    navigator.clipboard.writeText(text).then(() => toast('JVM 参数已复制'), () => toast('复制失败，请手动选择', 'i-info'));
                } else {
                    toast('当前环境不支持剪贴板写入', 'i-info');
                }
            }

            const seedBtn = event.target.closest('[data-seed]');
            if (seedBtn) window.StarTheme.update({ seed: seedBtn.dataset.seed });

            const variantBtn = event.target.closest('[data-variant]');
            if (variantBtn) window.StarTheme.update({ variant: variantBtn.dataset.variant });

            /*
             * 注意：这里必须限定在 #modeSeg 内查找。
             * 明暗模式同时写到了 <html data-mode> 上，而 <html> 是所有元素的祖先，
             * 用 closest('[data-mode]') 会让页面任意一次点击都命中它 ——
             * 表现就是「点哪里都会弹出主题色已切换」（旧版踩过的同一个坑）。
             */
            const modeBtn = event.target.closest('#modeSeg [data-mode]');
            if (modeBtn) {
                window.StarTheme.update({ mode: modeBtn.dataset.mode });
                toast('明暗模式：' + ({ auto: '跟随系统', light: '浅色', dark: '深色' })[modeBtn.dataset.mode], 'i-palette');
            }

            const roleBtn = event.target.closest('[data-role-value]');
            if (roleBtn) {
                const row = roleBtn.closest('.role-row');
                const slot = row ? row.dataset.role : null;
                if (slot) {
                    const patch = { roles: Object.assign({}, window.StarTheme.state.roles) };
                    patch.roles[slot] = roleBtn.dataset.roleValue;
                    window.StarTheme.update(patch);
                }
            }

            const instOption = event.target.closest('[data-pick]');
            if (instOption) {
                selectInstance(instOption.dataset.pick, { toast: true });
                closePopovers();
                const picker = $('#instPicker');
                if (picker) picker.focus({ preventScroll: true });
            }

            const downloadBtn = event.target.closest('[data-download]');
            if (downloadBtn) {
                event.preventDefault();
                startDownload(downloadBtn.dataset.download);
            }

            const wallpaperBtn = event.target.closest('[data-wallpaper]');
            if (wallpaperBtn) {
                window.StarTheme.selectWallpaper(wallpaperBtn.dataset.wallpaper).then((ok) => {
                    if (ok) toast('已切换壁纸', 'i-image');
                    else toast('壁纸加载失败，文件可能已被移动', 'i-info');
                });
            }

            const wallpaperClear = event.target.closest('[data-wallpaper-clear]');
            if (wallpaperClear) {
                const cleared = window.StarTheme.clearWallpaper();
                renderWallpaperUI();
                toast(cleared ? '已关闭壁纸，只保留氛围光' : '当前没有壁纸', cleared ? 'i-image' : 'i-info');
            }

            const wpModeBtn = event.target.closest('[data-wp-mode]');
            if (wpModeBtn) {
                window.StarTheme.update({ wallpaperMode: wpModeBtn.dataset.wpMode });
                renderWallpaperUI();
                toast('壁纸切换方式：' + (wpModeBtn.dataset.wpMode === 'random' ? '随机' : '顺序'), 'i-image');
            }

            const wpIntervalBtn = event.target.closest('[data-wp-interval]');
            if (wpIntervalBtn) {
                const minutes = Number(wpIntervalBtn.dataset.wpInterval);
                window.StarTheme.update({ wallpaperInterval: minutes });
                renderWallpaperUI();
                toast('壁纸每 ' + minutes + ' 分钟切换一次', 'i-refresh');
            }

            if (!event.target.closest('#instPop') && !event.target.closest('#instPicker')) {
                const pop = $('#instPop');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    const trigger = $('#instPicker');
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
            if (!event.target.closest('#accountPop') && !event.target.closest('#railAvatar')) {
                const pop = $('#accountPop');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    const trigger = $('#railAvatar');
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
        });
    }

    SL.events = Object.assign(SL.events || {}, { bindGlobalClicks });
})(window);
