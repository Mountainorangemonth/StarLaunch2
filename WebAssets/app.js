/* =====================================================================
   StarLaunch · 引导
   ---------------------------------------------------------------------
   这里只做三件事：按顺序把各模块的事件挂上、渲染初始界面、开始路由。

   模块分工（都在 js/ 下，加载顺序见 index.html）：
       00-core        工具函数、localStorage
       01-state       跨模块共享的偏好与当前实例
       02-data        静态数据（还没接后端的示例内容）
       03-host        WebView2 桥接
       04-clock       主页时钟
       05-router      视图切换
       06-ui          Toast / 浮层 / 快捷键
       07-home        主页实例与内存
       08-versions    版本管理
       09-notice      公告与启动日志
       10-launch      启动流程
       11-download    下载中心
       12-appearance  外观与壁纸
       13-settings    启动选项
       14-folders     游戏文件夹列表（多 .minecraft）
       15-events      全局事件委托
       16-xaml-parse  Custom.xaml 解析
       17-xaml-view   Custom.xaml 渲染
       18-select      下拉框外观（原生 select 换成自绘浮层）
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;
    const { $, $$ } = SL.core;
    const { ui } = SL.state;

    /** 各模块自己的监听器在自己文件里，这里按原来的顺序串起来。 */
    function bind() {
        // 先把 <select> 换成自绘下拉，后面的模块拿到的还是同一批 select，
        // 只是 value / change 之外多了一层看得见的外观
        SL.select.bindSelects();

        SL.events.bindGlobalClicks();
        window.addEventListener('hashchange', SL.router.applyRoute);
        window.addEventListener('resize', SL.ui.repositionPopovers);
        window.addEventListener('resize', SL.ui.syncRailGlide);

        SL.clock.bindClock();
        SL.host.bindHost();
        SL.ui.bindPopovers();
        SL.versions.bindVersionList();
        SL.home.bindHomeMemory();
        SL.versions.bindGameDir();
        SL.folders.bindFolders();
        SL.launch.bindLaunch();
        SL.download.bindDownload();
        SL.settings.bindSettings();
        SL.notice.bindNotice();
        SL.ui.bindQuote();
        SL.ui.bindHeroParallax();
        SL.ui.bindIdle();
        SL.ui.bindKeyboard();
    }

    /** 按上次的选择把分段控件、下载分类、设置页 tab 恢复到位。 */
    function initUiState() {
        const instListFilter = ui.instFilter;
        $$('[data-inst-filter]').forEach((btn) => {
            const active = btn.dataset.instFilter === instListFilter;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        const dlTab = ui.dlCat;
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === dlTab;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('.source, [data-dl-source]').forEach((btn) => {
            const value = btn.dataset.source || btn.dataset.dlSource;
            const active = value === ui.source;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        SL.settings.setSettingsTab(ui.setTab || 'appearance');
    }

    function init() {
        bind();
        initUiState();

        if (SL.host.hasHost()) {
            // 跑在启动器里：先把示例数据收起来，等宿主的真实扫描结果再渲染，
            // 免得真实列表回来之前先闪一下假实例。
            SL.state.instances = [];
            SL.versions.renderInstanceList();
            SL.home.renderInstanceOptions();
            SL.versions.clearDetail();
            SL.versions.applyScanState();
            SL.folders.renderFolderList();
            SL.versions.loadInstances();
        } else {
            // 浏览器预览：没有宿主，用示例数据把界面撑起来
            SL.versions.renderInstanceList();
            SL.versions.selectInstance(ui.activeId);
            SL.versions.applyScanState();
            SL.folders.renderFolderList();
        }

        SL.download.syncCatalogForm();
        SL.download.renderDownloads();
        SL.download.renderQueue();
        SL.appearance.renderPalette();
        SL.appearance.renderWallpaperUI();
        SL.notice.renderNoticeSettings();
        SL.notice.renderLaunchLog();
        SL.notice.initNoticeView();

        // 公告来源是本地文件时，启动时让宿主重新读一遍，改了文件不用手动刷新
        const noticePrefs = SL.notice.noticePrefs;
        if (noticePrefs.source === 'file' && noticePrefs.filePath) {
            SL.notice.setSilentReload(true);
            SL.host.hostPost({ type: 'read-notice-file', path: noticePrefs.filePath });
        }

        if (window.StarTheme) {
            window.StarTheme.onChange(() => {
                SL.appearance.renderPalette();
                SL.appearance.renderWallpaperUI();
            });
        }

        if (!location.hash) {
            try { history.replaceState(null, '', '#home'); } catch (err) { /* file:// 下可能被限制 */ }
        }
        SL.router.applyRoute();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
