/* =====================================================================
   StarLaunch · 启动流程
   ---------------------------------------------------------------------
   启动不再开弹窗。界面按状态走，状态写进 <body data-launch>：

     idle       点「启动游戏」直接发 launch-game
     preparing  再点一次同一个按钮 = 取消（右下角只有一行「正在启动…」）
     running    游戏进程已起来，右下角出现「停止游戏」，点一下结束进程树
     stopping   已经请求停止，等宿主回 exitCode
     failed     失败原因写进启动日志，并在右下角浮层里说一遍

   · 在启动器里跑的时候，这里是「真启动」：把选项发给宿主
     （Services/GameLauncher.cs 拼参数、起 Java 进程），宿主流式回进度和
     日志；日志只写进公告栏下方的启动日志历史，不再有弹窗日志区；
   · 浏览器预览没有宿主，退化成演示流程（明确标注「演示」，
     不要让人以为游戏真起来了）。

   消息约定见 Host/LaunchMessages.cs 的文件头。
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
    const hostMod = SL.core.mod('host');
    const noticeMod = SL.core.mod('notice');
    const recordLaunchLog = (...args) => noticeMod.recordLaunchLog(...args);
    const recordLaunchLogLines = (...args) => noticeMod.recordLaunchLogLines(...args);
    const flushLaunchLog = (...args) => noticeMod.flushLaunchLog(...args);

    /** 一时的状态：idle / preparing / running / stopping / failed */
    let launchState = 'idle';
    let launchId = '';
    let launchPid = 0;
    let launchInst = { name: '' };
    let launchTimers = [];

    const hasHost = () => typeof hostMod.hasHost === 'function' && hostMod.hasHost();

    /* -----------------------------------------------------------------
       状态与右下角的提示 / 停止按钮
       ----------------------------------------------------------------- */

    /** 底部浮层里的文案：每个状态一句，别让人对着一个点不动的按钮猜。 */
    function setHint(text) {
        const hint = $('#launchHint');
        if (!hint) return;
        if (!text) {
            hint.hidden = true;
            hint.textContent = '';
            return;
        }
        hint.hidden = false;
        hint.textContent = text;
    }

    /**
     * 切换启动状态。所有 [data-launch] 按钮的文字也跟着变：
     * 准备阶段显示「取消启动」，运行阶段显示「游戏中」。
     */
    function applyState(state, detail) {
        launchState = state;
        document.body.setAttribute('data-launch', state);

        switch (state) {
            case 'preparing':
                setHint('正在启动' + (launchInst.name ? '「' + launchInst.name + '」' : '') + '…\n再点一次启动按钮可以取消');
                break;
            case 'running':
                setHint('');
                break;
            case 'stopping':
                // 文案和禁用状态由 stopGame() 写好，这里只管收起提示
                setHint('');
                break;
            case 'failed':
                setHint('启动失败：' + (detail || '没有给出原因'));
                break;
            default:
                setHint('');
                break;
        }

        // 启动按钮的文案
        const labels = {
            idle: '启动游戏',
            preparing: '取消启动',
            running: '游戏中',
            stopping: '正在停止',
            failed: '启动游戏'
        };
        const text = labels[state] || '启动游戏';
        $$('[data-launch-label]').forEach((el) => { el.textContent = text; });

        // 右下角容器：有东西要显示才出来
        const wrap = $('#launchState');
        const dock = $('#launchDock');
        if (wrap) {
            const showHint = state === 'preparing' || state === 'failed';
            const showDock = state === 'running' || state === 'stopping';
            wrap.hidden = !(showHint || showDock);
            if (dock) dock.hidden = !showDock;
        }
    }

    function setDockText(title, sub) {
        const text = $('#launchDockText');
        if (text) text.textContent = sub || '';
        const name = $('#launchDockTitle');
        if (name) name.textContent = title || '停止游戏';
    }

    function setDockStopEnabled(enabled) {
        const btn = $('#launchStop');
        if (btn) btn.disabled = !enabled;
    }

    /** 日志：只进公告栏的启动日志历史，不再画弹窗里的日志区。 */
    function appendLaunchLog(line) {
        if (line == null) return;
        const text = String(line);
        if (!text) return;
        recordLaunchLog(text);
    }

    /** 宿主一次推一批日志：整批交给公告栏，别一行一行画。 */
    function appendLaunchLines(lines) {
        if (!lines) return;
        if (typeof recordLaunchLogLines === 'function') {
            recordLaunchLogLines(lines);
            return;
        }
        const list = Array.isArray(lines) ? lines : [String(lines)];
        list.forEach((line) => {
            if (line != null && String(line).length > 0) appendLaunchLog(String(line));
        });
    }

    /** 准备阶段的进度：弹窗没有了，百分比只写进右下角那一行提示里。 */
    function setProgress(percent, text) {
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        setHint('正在启动' + (launchInst.name ? '「' + launchInst.name + '」' : '') +
            '…' + (text ? text + ' ' : '') + Math.round(value) + '%' +
            '\n再点一次启动按钮可以取消');
    }

    /* -----------------------------------------------------------------
       启动选项：全局设置 + 版本设置合并后发给宿主
       ----------------------------------------------------------------- */
    /** 全局 Java 列表里存的可能是 java.exe 的路径，也可能还是老的 java21 这种提示。 */
    function looksLikePath(value) {
        const text = String(value || '');
        return /[\\/]/.test(text) || /^[a-zA-Z]:/.test(text);
    }

    /** 实例的 key 是「文件夹 id::版本名」，宿主只认后面那半截版本目录名。 */
    function versionIdOf(inst) {
        const raw = String((inst && inst.versionId) || '').trim();
        if (raw) return raw;
        const key = String((inst && inst.id) || '');
        const cut = key.indexOf('::');
        return cut >= 0 ? key.slice(cut + 2) : key;
    }

    function buildOptions(inst) {
        const prefs = SL.state.launchPrefs;
        const config = (SL.instance && typeof SL.instance.resolve === 'function')
            ? SL.instance.resolve(inst)
            : {};

        const memGb = Number(config.mem) || Number(inst.mem) || 8;

        // 版本设置里的 Java 优先；没改过就用全局列表里选的那一台
        const instanceJava = config.java && config.java !== 'inherit' ? config.java : '';
        const globalJava = looksLikePath(prefs.javaList) ? prefs.javaList : '';
        const java = instanceJava || globalJava;
        const javaHint = java ? '' : (prefs.javaList || '');

        return {
            memMb: Math.round(memGb * 1024),
            java: java,
            javaHint: javaHint,
            jvmArgs: config.jvmArgs || '',
            gameArgs: config.gameArgs || '',
            preCommand: config.preCommand || '',
            windowTitle: config.windowTitle || '',
            customInfo: config.customInfo || prefs.customInfo || '',
            visibility: prefs.visibility || 'unchanged',
            priority: prefs.priority || 'normal',
            windowMode: prefs.windowMode || 'custom',
            winW: Number(prefs.winW) || 854,
            winH: Number(prefs.winH) || 480,
            memoryManager: prefs.memoryManager || 'g1',
            disableWrapper: config.disableWrapper === true,
            disableUnsafe: Boolean(prefs.disableUnsafe),
            highPerfGpu: config.highPerfGpu !== false,
            memOptimize: config.memOptimize === true,
            // 「启动前检查更新」= 缺文件时让宿主先补齐
            checkFiles: prefs.updater !== false
        };
    }

    /* -----------------------------------------------------------------
       取消 / 停止
       ----------------------------------------------------------------- */
    function cancelPreparing() {
        if (launchState !== 'preparing' || !launchId) return false;
        appendLaunchLog('· 正在取消这次启动…');
        if (hasHost()) hostMod.hostPost({ type: 'launch-cancel', id: launchId });
        // 不等宿主回执：准备阶段本来就可能卡在下载/解压里，界面先退回去
        applyState('idle');
        launchId = '';
        return true;
    }

    /** 右下角「停止游戏」：直接结束这次启动的整棵进程树。 */
    function stopGame(inst) {
        if (launchState !== 'running' || !launchId) return false;

        const target = launchInst && launchInst.name ? launchInst.name : (inst && inst.name) || '这个实例';
        if (!hasHost()) {
            // 浏览器预览：没有宿主，也就没有进程可停
            toast('浏览器预览里没有真的启动游戏，不需要停止', 'i-info');
            return false;
        }

        setDockText('正在停止…', '正在结束「' + target + '」的进程');
        setDockStopEnabled(false);
        const dock = $('#launchDock');
        if (dock) dock.classList.add('is-stopping');
        applyState('stopping');
        hostMod.hostPost({ type: 'launch-stop', id: launchId });
        armStopWatchdog();
        return true;
    }

    /* -----------------------------------------------------------------
       真启动（宿主）
       ----------------------------------------------------------------- */
    function startRealLaunch(inst) {
        const options = buildOptions(inst);

        launchInst = inst;
        launchId = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        applyState('preparing');

        appendLaunchLog('· 正在请求启动「' + inst.name + '」…');

        const ok = hostMod.hostPost({
            type: 'launch-game',
            id: launchId,
            gameDir: inst.dirPath || '',
            // 注意：inst.id 是「文件夹 id::版本名」的全局 key，宿主拿它去拼
            // versions\<...> 会找不到目录，一定要传去掉前缀的版本目录名
            versionId: versionIdOf(inst),
            runDir: inst.gameDir || '',
            isolated: Boolean(inst.isolatedByPolicy || inst.isolated),
            name: inst.name,
            options: options
        });

        if (!ok) {
            failLaunch('没能联系上启动器：消息发不出去，宿主连接可能断了');
            return;
        }

        // 宿主收到 launch-game 会立刻回一条进度；一条都没回来就是它压根没接住
        // （以前的静默失败会让人对着「正在准备启动…」干等）
        armLaunchWatchdog();
    }

    let launchWatchdog = 0;
    let launchStopWatchdog = 0;

    function clearLaunchWatchdog() {
        if (launchWatchdog) window.clearTimeout(launchWatchdog);
        launchWatchdog = 0;
    }

    function clearStopWatchdog() {
        if (launchStopWatchdog) window.clearTimeout(launchStopWatchdog);
        launchStopWatchdog = 0;
    }

    function armLaunchWatchdog() {
        clearLaunchWatchdog();
        launchWatchdog = window.setTimeout(() => {
            launchWatchdog = 0;
            if (launchState !== 'preparing') return;
            failLaunch('启动器没有回应这次启动请求（15 秒内没有收到任何进度）。\n\n' +
                '可以再点一次启动；如果一直这样，检查启动器是否卡在别的事情上，' +
                '或者先把版本设置里的「启动前检查更新」关掉再试。');
        }, 15000);
    }

    /** 点了停止之后宿主迟迟不回执：别把按钮永远禁着，15 秒后放开并说明。 */
    function armStopWatchdog() {
        clearStopWatchdog();
        launchStopWatchdog = window.setTimeout(() => {
            launchStopWatchdog = 0;
            if (launchState !== 'stopping') return;
            applyState('running');
            setDockText('停止游戏', '游戏正在运行（PID ' + (launchPid || '?') + '）');
            setDockStopEnabled(true);
            appendLaunchLog('✗ 启动器没有回应这次「停止游戏」请求');
            toast('启动器没有回应，游戏可能还在跑', 'i-info');
        }, 15000);
    }

    function failLaunch(message) {
        clearLaunchWatchdog();
        clearStopWatchdog();
        applyState('failed', message);
        launchId = '';
        launchPid = 0;
        appendLaunchLog('✗ ' + message);

        if (typeof uiMod.dialog === 'function') {
            // 内存不足的失败里直接给一个能点的出口：打开系统虚拟内存设置
            if (/虚拟内存|页面文件/.test(message)) {
                const answer = uiMod.dialog({
                    title: '启动失败 · 内存不足',
                    message: message,
                    okLabel: '打开虚拟内存设置',
                    cancelLabel: '知道了'
                });
                if (answer && typeof answer.then === 'function') {
                    answer.then((ok) => {
                        if (ok) hostMod.hostPost({ type: 'open-pagefile-settings' });
                    });
                }
                return;
            }

            uiMod.dialog({
                title: '启动失败',
                message: message,
                okLabel: '知道了',
                cancelLabel: null
            });
        } else {
            toast('启动失败：' + message, 'i-info');
        }
    }

    function onLaunchPhase(data) {
        if (data.id !== launchId) return;
        clearLaunchWatchdog();
        if (launchState !== 'preparing') return;
        setProgress(data.percent, data.text);
    }

    function onLaunchLog(data) {
        if (data.id !== launchId) return;
        clearLaunchWatchdog();
        appendLaunchLines(data.lines);
    }

    /**
     * 宿主拒绝启动时走的是通用 reply 通道（参数不合法、上一次还没结束…），
     * 以前这里没人接，界面就一直停在「正在请求启动」。
     */
    function onLaunchReply(data) {
        if (data.id !== launchId || data.ok !== false) return;
        failLaunch(data.error || '启动器拒绝了这次启动请求');
    }

    function onLaunchReady(data) {
        if (data.id !== launchId) return;

        clearLaunchWatchdog();
        launchPid = Number(data.pid) || 0;

        const dock = $('#launchDock');
        if (dock) dock.classList.remove('is-over');
        setDockText('停止游戏', '游戏正在运行（PID ' + (launchPid || '?') + '）');
        setDockStopEnabled(true);
        applyState('running');

        appendLaunchLog('· 游戏已在运行（PID ' + (launchPid || '?') + '）');
    }

    function onLaunchStopped(data) {
        if (data.id !== launchId) return;

        clearStopWatchdog();
        const dock = $('#launchDock');
        if (dock) dock.classList.remove('is-stopping');

        const code = data.exitCode == null ? '?' : data.exitCode;
        appendLaunchLog('· 已停止游戏（退出码 ' + code + '）');
        toast('已停止「' + (launchInst.name || '游戏') + '」', 'i-square');

        // 停止完成：右下角的入口收起来，界面回到可以再启动的状态
        launchId = '';
        launchPid = 0;
        applyState('idle');
    }

    function onLaunchCanceled(data) {
        if (data.id !== launchId) return;

        clearLaunchWatchdog();
        applyState('idle');
        launchId = '';
        appendLaunchLog('· 已取消启动');
    }

    function onLaunchExited(data) {
        if (data.id !== launchId) return;

        clearLaunchWatchdog();
        clearStopWatchdog();

        const seconds = Math.max(0, Math.round(Number(data.seconds) || 0));
        // 闪退时别再显示「本次 1 分钟」，那会让人以为游戏真的跑了一会儿
        const duration = seconds < 60
            ? seconds + ' 秒'
            : Math.round(seconds / 60) + ' 分钟';

        // 游戏自己退出（不是我们停的）：右下角的停止入口收起来
        const dock = $('#launchDock');
        if (dock) dock.classList.remove('is-stopping');
        appendLaunchLog('· 游戏已退出（本次 ' + duration + '）');

        launchId = '';
        launchPid = 0;
        applyState('idle');

        // 主页「本周游戏」跟着更新
        const homeMod = SL.core.mod('home');
        if (data.week && homeMod && typeof homeMod.renderWeek === 'function') {
            homeMod.renderWeek(data.week);
        }
    }

    function bindLaunchMessages() {
        const webview = window.chrome && window.chrome.webview;
        if (!webview || typeof webview.addEventListener !== 'function') return;

        webview.addEventListener('message', (event) => {
            let data = event.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (err) { return; }
            }
            if (!data || typeof data.type !== 'string') return;

            switch (data.type) {
                case 'reply': onLaunchReply(data); break;
                case 'launch-phase': onLaunchPhase(data); break;
                case 'launch-log': onLaunchLog(data); break;
                case 'launch-ready': onLaunchReady(data); break;
                case 'launch-stopped': onLaunchStopped(data); break;
                case 'launch-failed': onLaunchFailed(data); break;
                case 'launch-canceled': onLaunchCanceled(data); break;
                case 'launch-exited': onLaunchExited(data); break;
                default: break;
            }
        });
    }

    function onLaunchFailed(data) {
        if (data.id !== launchId) return;
        failLaunch(data.error || '没有给出原因');
    }

    /* -----------------------------------------------------------------
       演示流程（浏览器预览，没有宿主）
       ----------------------------------------------------------------- */
    function startDemoLaunch(inst) {
        launchInst = inst;
        launchId = 'demo';
        applyState('preparing');
        setProgress(0, '正在准备启动…');

        const options = buildOptions(inst);
        const accountMod = SL.core.mod('account');
        const account = accountMod.state && accountMod.state.selected;
        const accountLabel = account
            ? account.name + '（' + (account.type === 'ms' ? '微软账户'
                : (account.type === 'authlib' ? (account.serverName || '外置登录') : '离线登录')) + '）'
            : '演示账户';

        appendLaunchLog('· 浏览器预览没有宿主，下面是演示流程，不会真的启动游戏');

        const steps = [
            { p: 16, label: '正在校验游戏文件…', log: '· 校验 ' + (inst.mods > 0 ? '1,284' : '684') + ' 个文件' },
            { p: 42, label: '正在加载加载器与模组…', log: '· ' + inst.loaderName + ' · ' + modsLabel(inst) },
            { p: 66, label: '正在分配内存…', log: '· 分配 ' + options.memMb / 1024 + ' GB 堆内存' },
            { p: 80, label: '正在验证账户…', log: '· ' + accountLabel },
            { p: 88, label: '正在启动 Java 进程…', log: '· ' + inst.path },
            { p: 100, label: '启动完成，等待游戏窗口…', log: '· 游戏窗口即将出现' }
        ];

        steps.forEach((step, index) => {
            const timer = window.setTimeout(() => {
                if (launchState !== 'preparing') return;
                setProgress(step.p, step.label);
                appendLaunchLog(step.log);
                if (index === steps.length - 1) {
                    // 演示里也走到「运行中」，好让人看见右下角那块停止入口长什么样
                    launchId = 'demo';
                    setDockText('停止游戏', '演示实例（点一下看效果）');
                    setDockStopEnabled(true);
                    applyState('running');
                }
            }, 540 * (index + 1));
            launchTimers.push(timer);
        });
    }

    function clearLaunchTimers() {
        launchTimers.forEach((timer) => window.clearTimeout(timer));
        launchTimers = [];
    }

    /* -----------------------------------------------------------------
       入口
       ----------------------------------------------------------------- */
    function startLaunch() {
        const inst = activeInstance();
        const wrap = $('#launchState');
        if (!wrap) return;

        // 已经在启动 / 已经在跑：再点一下不是「再启动一次」
        if (launchState === 'preparing') { cancelPreparing(); return; }
        if (launchState === 'running' || launchState === 'stopping') {
            toast('游戏已经在运行了，要结束它请点右下角的「停止游戏」', 'i-info');
            return;
        }

        // 一个版本都没有的时候别装模作样地"启动"，直接告诉用户缺什么
        if (!inst.id) {
            toast('还没有可用版本，先到版本管理里放一个再启动', 'i-info');
            go('versions');
            return;
        }

        // 没有账户时没有用户名和 UUID，Java 进程根本起不来（真实启动也是这个前提）
        const accountMod = SL.core.mod('account');
        const account = accountMod.state && accountMod.state.selected;
        if (!account) {
            toast('先登录一个账户再启动', 'i-user');
            if (typeof accountMod.openLogin === 'function') accountMod.openLogin('offline');
            return;
        }

        clearLaunchTimers();
        clearStopWatchdog();
        if (hasHost()) startRealLaunch(inst);
        else startDemoLaunch(inst);
    }

    /** 兼容旧调用点：以前是「关闭启动弹窗」，现在是「取消准备 / 收起右下角」。 */
    function closeLaunch() {
        clearLaunchTimers();
        clearLaunchWatchdog();
        clearStopWatchdog();
        if (launchState === 'preparing') cancelPreparing();
        if (launchState === 'failed') applyState('idle');
    }

    /* 事件绑定 */
    function bindLaunch() {
        bindLaunchMessages();

        // 启动按钮：准备阶段同一个按钮就是取消入口，不用再去找别的按钮
        $$('[data-launch]').forEach((btn) => btn.addEventListener('click', startLaunch));

        // 右下角的「停止游戏」
        const stop = $('#launchStop');
        if (stop) stop.addEventListener('click', () => stopGame(activeInstance()));

        // 页面重载后不要残留一个「运行中」（真在跑的话宿主退出时会推 launch-exited）
        applyState('idle');
    }

    SL.launch = Object.assign(SL.launch || {}, {
        clearLaunchTimers, appendLaunchLog, appendLaunchLines, closeLaunch, setProgress, flushLaunchLog,
        startLaunch, bindLaunch, buildOptions, stopGame, cancelPreparing
    });

    // 状态只能读：Object.assign 会把 getter 求值成一次快照，这里显式定义
    Object.defineProperty(SL.launch, 'state', { get: () => launchState, configurable: true });
    Object.defineProperty(SL.launch, 'pid', { get: () => launchPid, configurable: true });
})(window);
