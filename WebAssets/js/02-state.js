/* =====================================================================
   StarLaunch · 共享状态
   ---------------------------------------------------------------------
   跨模块读写的偏好和当前实例。原则：

   · 对象型状态（ui / launchPrefs）原地修改，各模块直接取引用即可；
   · 需要整体替换的状态（instances / scanState）走 getter/setter，
     这样任何模块赋值都能被其它模块看到；
   · 只在一个模块里用的状态不放这里，跟着那个模块走。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { STORE, readStore } = SL.core;
    const { MOCK_INSTANCES } = SL.data;

    const ui = readStore(STORE.uiPrefs, {
        activeId: 'winter', instFilter: 'all', dlCat: 'version', source: 'BMCLAPI', setTab: 'appearance',
        folderFilter: 'all'
    });

    const launchPrefs = readStore(STORE.launchPrefs, {
        mem: 8, updater: true, minimize: false, concurrency: 8,
        isolation: 'all', windowTitle: '', customInfo: 'StarLaunch',
        visibility: 'unchanged', priority: 'normal',
        windowMode: 'custom', winW: 854, winH: 480,
        memMode: 'auto', memOptimize: true,
        jvmArgs: '-XX:+OmitStackTraceInFastThrow -Djdk.lang.Process.allowAmbiguousCommands=True -Dfml.ignoreInvalidMinecraftCertificates=True -Dfml.ignorePatchDiscrepancies=True',
        gameArgs: '', preCommand: '', javaList: 'java21', memoryManager: 'g1',
        disableWrapper: false, disableUnsafe: false, highPerfGpu: true,
        advancedOpen: true, advancedNote: true
    });

    // 版本列表：宿主可用时会被 /api/versions 的真实数据整体替换
    let instances = MOCK_INSTANCES;

    // 登记过的游戏文件夹（宿主扫描结果里的 folders）；浏览器预览时为空
    let folders = [];

    // 上一次扫描的结果摘要，详情面板和页脚统计都读它
    let scanState = { ok: false, loaded: false, gameDir: '', custom: false, counts: null, error: '' };

    const EMPTY_INSTANCE = {
        id: '', name: '未选择实例', loader: 'Vanilla', loaderName: 'Vanilla', mc: '—',
        mods: 0, mem: 8, java: '—', kind: 'vanilla', tone: 'plain', last: '尚未启动',
        path: '', modPreview: [], dirId: '', dirPath: '', dirName: '', dirIsolation: 'all'
    };

    const getInstance = (id) => instances.find((item) => item.id === id) || instances[0] || EMPTY_INSTANCE;
    const activeInstance = () => getInstance(ui.activeId);
    const modsLabel = (inst) => (inst.mods > 0 ? inst.mods + ' 个模组' : '无模组');

    SL.state = Object.defineProperties({}, {
        ui: { value: ui, enumerable: true },
        launchPrefs: { value: launchPrefs, enumerable: true },
        instances: {
            enumerable: true,
            get: () => instances,
            set: (value) => { instances = value; }
        },
        folders: {
            enumerable: true,
            get: () => folders,
            set: (value) => { folders = Array.isArray(value) ? value : []; }
        },
        scanState: {
            enumerable: true,
            get: () => scanState,
            set: (value) => { scanState = value; }
        },
        EMPTY_INSTANCE: { value: EMPTY_INSTANCE, enumerable: true },
        getInstance: { value: getInstance, enumerable: true },
        activeInstance: { value: activeInstance, enumerable: true },
        modsLabel: { value: modsLabel, enumerable: true }
    });
})(window);
