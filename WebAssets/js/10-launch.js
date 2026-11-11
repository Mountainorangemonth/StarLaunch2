/* =====================================================================
   StarLaunch · 启动流程
   ---------------------------------------------------------------------
   启动弹窗、进度与取消。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$ } = SL.core;
    const { activeInstance, modsLabel } = SL.state;
    const routerMod = SL.core.mod('router');
    const go = (...args) => routerMod.go(...args);
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const noticeMod = SL.core.mod('notice');
    const recordLaunchLog = (...args) => noticeMod.recordLaunchLog(...args);

    let launchTimers = [];
    let launchState = 'idle';
    let lastFocus = null;

    /* -----------------------------------------------------------------
       启动流程
       ----------------------------------------------------------------- */
    function clearLaunchTimers() {
        launchTimers.forEach((timer) => window.clearTimeout(timer));
        launchTimers = [];
    }

    function appendLaunchLog(line) {
        const log = $('#launchLog');
        if (log) {
            const p = document.createElement('p');
            p.textContent = line;
            log.appendChild(p);
            log.scrollTop = log.scrollHeight;
        }
        // 同一条日志同时写入公告栏下方的启动日志历史
        recordLaunchLog(line);
    }

    function closeLaunch() {
        const modal = $('#launchModal');
        const wasRunning = launchState === 'running';
        clearLaunchTimers();
        launchState = 'idle';
        if (modal) {
            modal.hidden = true;
            modal.classList.remove('is-done');
        }
        if (wasRunning) toast('已取消启动', 'i-info');
        if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
            lastFocus.focus({ preventScroll: true });
        }
        lastFocus = null;
    }

    function startLaunch() {
        const inst = activeInstance();
        const modal = $('#launchModal');
        if (!modal) return;

        // 一个版本都没有的时候别装模作样地"启动"，直接告诉用户缺什么
        if (!inst.id) {
            toast('还没有可用版本，先到版本管理里放一个再启动', 'i-info');
            go('versions');
            return;
        }
        clearLaunchTimers();
        lastFocus = document.activeElement;
        launchState = 'running';
        modal.hidden = false;
        modal.classList.remove('is-done');

        const title = $('#launchTitle');
        const meta = $('#launchMeta');
        const bar = $('#launchBar');
        const status = $('#launchStatus');
        const pct = $('#launchPct');
        const log = $('#launchLog');
        const goBtn = $('#launchGo');
        const cancel = $('#launchCancel');

        if (title) title.textContent = inst.name;
        if (meta) meta.textContent = inst.loaderName + ' · Minecraft ' + inst.mc + ' · ' + inst.mem + ' GB · Java ' + inst.java;
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            void bar.offsetWidth;
            bar.style.transition = '';
        }
        if (status) status.textContent = '正在准备启动…';
        if (pct) pct.textContent = '0%';
        if (log) log.innerHTML = '';
        if (goBtn) goBtn.hidden = true;
        if (cancel) cancel.textContent = '取消';

        const steps = [
            { p: 16, label: '正在校验游戏文件…', log: '· 校验 ' + (inst.mods > 0 ? '1,284' : '684') + ' 个文件' },
            { p: 42, label: '正在加载加载器与模组…', log: '· ' + inst.loaderName + ' · ' + modsLabel(inst) },
            { p: 66, label: '正在分配内存…', log: '· 分配 ' + inst.mem + ' GB 堆内存 · Java ' + inst.java },
            { p: 88, label: '正在启动 Java 进程…', log: '· ' + inst.path },
            { p: 100, label: '启动完成，等待游戏窗口…', log: '· 游戏窗口即将出现' }
        ];

        steps.forEach((step, index) => {
            const timer = window.setTimeout(() => {
                if (launchState !== 'running') return;
                if (bar) bar.style.width = step.p + '%';
                if (pct) pct.textContent = step.p + '%';
                if (status) status.textContent = step.label;
                appendLaunchLog(step.log);
                if (index === steps.length - 1) {
                    launchState = 'done';
                    modal.classList.add('is-done');
                    if (title) title.textContent = '启动完成';
                    if (goBtn) goBtn.hidden = false;
                    if (cancel) cancel.textContent = '关闭';
                    if (goBtn) goBtn.focus({ preventScroll: true });
                }
            }, 540 * (index + 1));
            launchTimers.push(timer);
        });

        if (cancel) cancel.focus({ preventScroll: true });
    }


    /* 事件绑定 */
    function bindLaunch() {
        /* 启动 */
        $$('[data-launch]').forEach((btn) => btn.addEventListener('click', startLaunch));
        $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeLaunch));
        const launchGo = $('#launchGo');
        if (launchGo) {
            launchGo.addEventListener('click', () => {
                const inst = activeInstance();
                closeLaunch();
                toast('已进入「' + inst.name + '」', 'i-play');
            });
    }

    }

    SL.launch = Object.assign(SL.launch || {}, { clearLaunchTimers, appendLaunchLog, closeLaunch, startLaunch, bindLaunch });
})(window);
