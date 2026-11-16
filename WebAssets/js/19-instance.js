/* =====================================================================
   StarLaunch · 版本设置（PCL 的「版本设置」窗口）
   ---------------------------------------------------------------------
   一个版本一份配置，落在 .minecraft\versions\<版本名>\StarLaunch.instance.json：

       · 只写用户真正改过的字段，没改的项不出现 = 跟随全局设置；
       · 写盘由宿主负责（save-instance-settings / reset-instance-settings），
         网页这边先乐观更新界面，再等 instance-settings-saved 回执；
       · 没有宿主（浏览器预览）时退化成 localStorage，界面照样能点。

   这个模块同时是「实例设置怎么解释」的唯一来源：
     applyToInstance() 把设置合进版本对象（显示名、图标配色、内存、Java），
     memoryOf() / resolve() 给版本列表、详情页和启动流程用。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, readStore, writeStore, escapeHtml } = SL.core;
    const { ui, launchPrefs, activeInstance } = SL.state;

    /* 模块互相引用：versions / home / settings 都会反过来用这里，用到时再解析 */
    const hostMod = () => SL.core.mod('host');
    const uiMod = () => SL.core.mod('ui');
    const versionsMod = () => SL.core.mod('versions');
    const homeMod = () => SL.core.mod('home');
    const settingsMod = () => SL.core.mod('settings');

    const TABS = ['overview', 'launch', 'loader', 'mods', 'shaderpacks', 'resourcepacks', 'export'];
    const MB_PER_GB = 1024;
    const MEM_MIN = 2;
    const MEM_MAX = 32;
    const SAVE_DELAY = 600;
    const FOLDER_LABELS = {
        version: '版本文件夹',
        mods: 'Mod 文件夹',
        shaderpacks: '光影文件夹',
        resourcepacks: '材质包文件夹',
        saves: '存档文件夹',
        screenshots: '截图文件夹'
    };

    /** 浏览器预览时的本地镜像（宿主环境里以版本目录里的 json 为准）。 */
    const previewStore = readStore(STORE.instancePrefs, {});

    let currentId = '';
    let previousFocus = null;
    let closeTimer = 0;
    let savedTimer = 0;
    let lastTab = 'overview';
    let advancedOpen = true;
    let isolationDirty = false;
    let saveErrorShown = false;
    /**
     * 「手动指定 Java」这一档在设置文件里没有单独的标记（存的就是路径本身），
     * 用户刚切过去、还没填路径时要记住这个意图，否则一 fill 就被打回「跟随全局」。
     */
    let javaManual = false;
    const saveTimers = Object.create(null);

    const hasHost = () => {
        const mod = hostMod();
        return typeof mod.hasHost === 'function' && mod.hasHost();
    };
    const toast = (...args) => uiMod().toast(...args);

    /* -----------------------------------------------------------------
       设置读写
       ----------------------------------------------------------------- */

    /** 一个版本当前的设置对象（没有就是空对象 = 全部跟随全局）。 */
    function settingsOf(inst) {
        if (!inst || !inst.id) return {};
        if (inst.settings && typeof inst.settings === 'object') return inst.settings;
        if (!hasHost()) {
            const local = previewStore[inst.id];
            if (local && typeof local === 'object') return local;
        }
        return {};
    }

    /** 空值 / 空串 / 空对象都表示「跟随全局」，落盘前统一清掉。 */
    function prune(raw) {
        const out = {};
        Object.keys(raw || {}).forEach((key) => {
            const value = raw[key];
            if (value === null || value === undefined) return;
            if (typeof value === 'string') {
                const text = value.trim();
                if (!text) return;
                out[key] = text;
                return;
            }
            if (key === 'memoryMb') {
                const mb = Math.round(Number(value));
                if (!mb || mb <= 0) return;
                out[key] = mb;
                return;
            }
            if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
        });
        return out;
    }

    function clampGb(value) {
        const gb = Math.round(Number(value) || 0);
        return Math.max(MEM_MIN, Math.min(MEM_MAX, gb));
    }

    /** 全局层面的内存分配结果（自动配置 → 按可用内存推算）。 */
    function autoMemory() {
        const mod = settingsMod();
        if (typeof mod.launchAllocatedMem === 'function') return clampGb(mod.launchAllocatedMem());
        return clampGb(launchPrefs.mem || 8);
    }

    function globalMemory() {
        if (launchPrefs.memMode === 'auto') return autoMemory();
        return clampGb(launchPrefs.mem || 8);
    }

    /** 这个版本实际会用多少内存（GB）。 */
    function memoryOf(inst, settings) {
        const s = settings || settingsOf(inst);
        if (s.memoryMode === 'custom' && Number(s.memoryMb) > 0) {
            return clampGb(Number(s.memoryMb) / MB_PER_GB);
        }
        if (s.memoryMode === 'auto') return autoMemory();

        // 旧版本把每个版本的内存存在 ui.instanceMem 里，迁移期还认它
        const legacy = ui.instanceMem && Number(ui.instanceMem[inst.id]);
        if (legacy > 0) return clampGb(legacy);

        return globalMemory();
    }

    function shortJava(path) {
        const text = String(path || '').trim();
        if (!text) return '';
        const parts = text.split(/[\\/]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : text;
    }

    /** 概览 / 启动弹窗里显示的 Java 文案。 */
    function javaLabel(inst, settings) {
        const s = settings || settingsOf(inst);
        if (s.java && s.java !== 'auto') return shortJava(s.java) || '手动指定';
        if (s.java === 'auto') return '自动选择';
        return inst.java || '未知';
    }

    /** 把版本设置合并进版本对象：显示名、配色、收藏、内存、Java。 */
    function applyToInstance(inst) {
        if (!inst || !inst.id) return inst;

        const s = settingsOf(inst);
        if (!inst.rawName) inst.rawName = inst.name;
        if (!inst.baseTone) inst.baseTone = inst.tone;

        inst.name = s.alias || inst.rawName;
        inst.description = s.description || '';
        inst.tone = s.tone || inst.baseTone;
        inst.favorite = s.favorite === true;
        inst.mem = memoryOf(inst, s);
        inst.javaLabel = javaLabel(inst, s);
        return inst;
    }

    /** 全局 + 本版本合并后的启动参数（启动流程读这里）。 */
    function resolve(inst) {
        const s = settingsOf(inst);
        const pick = (value, fallback) => (value === undefined || value === null || value === ''
            ? fallback
            : value);
        return {
            mem: memoryOf(inst, s),
            windowTitle: pick(s.windowTitle, launchPrefs.windowTitle || ''),
            customInfo: pick(s.customInfo, launchPrefs.customInfo || ''),
            java: s.java || 'inherit',
            javaLabel: javaLabel(inst, s),
            jvmArgs: pick(s.jvmArgs, launchPrefs.jvmArgs || ''),
            gameArgs: pick(s.gameArgs, launchPrefs.gameArgs || ''),
            preCommand: pick(s.preCommand, launchPrefs.preCommand || ''),
            memOptimize: s.memoryOptimize
                ? s.memoryOptimize === 'on'
                : launchPrefs.memOptimize !== false,
            disableWrapper: typeof s.disableWrapper === 'boolean'
                ? s.disableWrapper
                : Boolean(launchPrefs.disableWrapper),
            highPerfGpu: typeof s.highPerfGpu === 'boolean'
                ? s.highPerfGpu
                : launchPrefs.highPerfGpu !== false
        };
    }

    /** 改一项设置：先更新内存里的对象，再排队写盘。 */
    function updateSettings(inst, patch, options) {
        if (!inst || !inst.id) return;
        const next = prune(Object.assign({}, settingsOf(inst), patch));
        const hasValues = Object.keys(next).length > 0;

        inst.settings = hasValues ? next : null;

        if (!hasHost()) {
            if (hasValues) previewStore[inst.id] = next;
            else delete previewStore[inst.id];
            writeStore(STORE.instancePrefs, previewStore);
        }

        applyToInstance(inst);
        queueSave(inst, options);
    }

    function queueSave(inst, options) {
        const opts = options || {};
        const delay = opts.delay === undefined ? SAVE_DELAY : opts.delay;
        window.clearTimeout(saveTimers[inst.id]);
        saveTimers[inst.id] = window.setTimeout(() => {
            delete saveTimers[inst.id];
            flushSave(inst);
        }, delay);
    }

    /** 真正写盘：宿主负责落文件，没有宿主就只留在 localStorage。 */
    function flushSave(inst) {
        if (!inst || !inst.id) return;
        if (!hasHost()) {
            markSaved();
            return;
        }
        const ok = hostMod().hostPost({
            type: 'save-instance-settings',
            id: inst.path,
            path: inst.path,
            settings: inst.settings || {}
        });
        if (!ok) showSaveError('宿主没有收到保存请求，设置只留在了界面上。');
    }

    function markSaved() {
        const el = $('#isetSaved');
        if (!el) return;
        el.textContent = '已保存';
        el.classList.add('is-in');
        window.clearTimeout(savedTimer);
        savedTimer = window.setTimeout(() => el.classList.remove('is-in'), 1400);
    }

    function showSaveError(message) {
        if (saveErrorShown) return;
        saveErrorShown = true;
        const mod = uiMod();
        if (typeof mod.dialog === 'function') {
            mod.dialog({
                title: '版本设置没能保存',
                message: message + '\n\n设置还在界面上，改回可写目录或者以普通权限启动后再试一次。',
                okLabel: '知道了',
                cancelLabel: null
            });
        } else {
            toast('版本设置没能保存：' + message, 'i-info');
        }
    }

    /* -----------------------------------------------------------------
       打开 / 关闭
       ----------------------------------------------------------------- */

    function findInstance(id) {
        if (!id) return null;
        return SL.state.instances.find((item) => item.id === id) || null;
    }

    function currentInstance() {
        return findInstance(currentId) || (SL.state.instances.length ? activeInstance() : null);
    }

    function openInstanceSettings(id) {
        const inst = findInstance(id) ||
            (SL.state.instances.length ? activeInstance() : null);

        if (!inst || !inst.id) {
            toast('先选一个版本，再打开版本设置', 'i-info');
            return;
        }

        currentId = inst.id;
        javaManual = false;
        applyToInstance(inst);

        previousFocus = document.activeElement;
        window.clearTimeout(closeTimer);

        const root = $('#instSettings');
        if (!root) return;
        root.hidden = false;
        root.classList.remove('is-out');

        // 背景整块 inert：Tab 不会跑到浮层后面去
        setBackgroundInert(true);

        fill(inst);
        resetAssetSearch();
        clearAssetSelection();   // 每次打开都从「什么都没选」开始
        renderAssets(inst);
        renderLoaderNow(inst);
        setTab(lastTab);
        setText('#isetExportHint', '导出成 zip，结构可以直接用「导入整合包」读回来。');

        const focusTarget = $('#instSettings .iset-window');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    /** 浮层开着的时候，背后的应用不参与 Tab / 点击。 */
    function setBackgroundInert(on) {
        const app = document.querySelector('.app');
        if (!app) return;
        try { app.inert = Boolean(on); } catch (err) { /* 老内核不支持就算了 */ }
    }

    function closeInstanceSettings() {
        const root = $('#instSettings');
        if (!root || root.hidden) return;

        // 浮层里的下拉如果还开着，先收掉，别留一个孤儿菜单挂在屏幕上
        const selectMod = SL.select;
        if (selectMod && typeof selectMod.close === 'function') selectMod.close();

        root.classList.add('is-out');
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
            root.hidden = true;
            root.classList.remove('is-out');
        }, 150);

        setBackgroundInert(false);

        if (previousFocus && document.contains(previousFocus) &&
            typeof previousFocus.focus === 'function') {
            try { previousFocus.focus({ preventScroll: true }); } catch (err) { /* 元素已不可聚焦 */ }
        }
        previousFocus = null;
    }

    function setTab(tab) {
        const target = TABS.indexOf(tab) === -1 ? 'overview' : tab;
        lastTab = target;

        $$('#isetNav [data-inst-tab]').forEach((btn) => {
            const active = btn.dataset.instTab === target;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('#instSettings [data-inst-panel]').forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.instPanel === target);
        });

        const scroll = $('#isetScroll');
        if (scroll) scroll.scrollTop = 0;

        if (ASSET_KINDS[target]) renderAsset(target, currentInstance());
        else {
            renderSelectionBar();   // 非资源页：把底部操作栏收起来
        }

        // 「修改」页每次切过去都重新拉一次加载器列表（换源 / 网络恢复后能自愈）
        if (target === 'loader') loadLoaderOptions(false);
    }

    /* -----------------------------------------------------------------
       填界面
       ----------------------------------------------------------------- */

    function typeLabel(inst) {
        if (inst.broken) return '无法识别';
        if (inst.type === 'snapshot') return '预览版';
        if (inst.type === 'release') return '正式版';
        return inst.type || '';
    }

    /** 版本摘要那一行：空的部分直接不显示，别留一串「· — ·」。 */
    function heroMeta(inst) {
        return [inst.loaderName, 'Minecraft ' + inst.mc, typeLabel(inst)]
            .filter((part) => Boolean(part))
            .join(' · ');
    }

    function setText(sel, text) {
        const el = $(sel);
        if (el) el.textContent = text;
    }

    function setValue(sel, value) {
        const el = $(sel);
        if (el) el.value = value;
    }

    function setChecked(sel, checked) {
        const el = $(sel);
        if (el) el.checked = Boolean(checked);
    }

    function currentMemMode() {
        const radio = $$('input[name="isetMemMode"]').find((item) => item.checked);
        return radio ? radio.value : 'inherit';
    }

    function fill(inst) {
        if (!inst) return;
        const s = settingsOf(inst);

        /* 概览 */
        setText('#isetTitle', inst.name);
        setText('#isetHeroName', inst.name);
        setText('#isetHeroMeta', heroMeta(inst));
        setText('#isetHeroPath', inst.path || '—');
        setText('#isetHeroBadge', inst.loader || 'Vanilla');

        const hero = $('#isetHero');
        if (hero) hero.dataset.tone = inst.tone;
        const heroTile = $('#isetHeroTile');
        if (heroTile) heroTile.className = 'inst-tile iset-hero-tile tile--' + inst.tone;

        const iso = versionsMod().isolationState(inst);
        setText('#isetSumMem', inst.mem + ' GB');
        setText('#isetSumJava', javaLabel(inst, s));
        setText('#isetSumIso', iso.label);
        setText('#isetSumMods', inst.mods > 0 ? inst.mods + ' 个' : '无');

        setValue('#isetName', s.alias || '');
        setValue('#isetDesc', s.description || '');
        setValue('#isetTone', s.tone || '');
        const fav = $('#isetFav');
        if (fav) fav.setAttribute('aria-checked', String(s.favorite === true));

        /* 启动选项 */
        setValue('#isetIsolation', s.isolation || '');
        setValue('#isetWindowTitle', s.windowTitle || '');
        setValue('#isetCustomInfo', s.customInfo || '');

        const javaMode = s.java ? (s.java === 'auto' ? 'auto' : 'custom')
            : (javaManual ? 'custom' : '');
        setValue('#isetJava', javaMode);
        setValue('#isetJavaPath', javaMode === 'custom' ? (s.java || '') : '');
        const javaPathRow = $('#isetJavaPathRow');
        if (javaPathRow) javaPathRow.hidden = javaMode !== 'custom';
        setText('#isetJavaHint', inst.java
            ? '这个版本需要 ' + inst.java
            : '没有从版本 JSON 里读到 Java 版本');

        /* 内存 */
        const mode = s.memoryMode === 'auto' || s.memoryMode === 'custom' ? s.memoryMode : 'inherit';
        $$('input[name="isetMemMode"]').forEach((radio) => { radio.checked = radio.value === mode; });

        const range = $('#isetMemRange');
        if (range) {
            range.value = String(memoryOf(inst, s));
            range.disabled = mode !== 'custom';
            homeMod().paintRange(range);
        }
        paintMemory(inst);
        setValue('#isetMemOptimize', s.memoryOptimize || '');

        /* 高级 */
        setValue('#isetJvmArgs', s.jvmArgs || '');
        setValue('#isetGameArgs', s.gameArgs || '');
        setValue('#isetPreCommand', s.preCommand || '');
        setValue('#isetDisableWrapper', s.disableWrapper === true ? 'on'
            : s.disableWrapper === false ? 'off' : '');
        setValue('#isetHighPerfGpu', s.highPerfGpu === true ? 'on'
            : s.highPerfGpu === false ? 'off' : '');

        const advanced = $('#isetAdvancedBlock');
        const advancedToggle = $('#isetAdvancedToggle');
        if (advanced) advanced.classList.toggle('is-collapsed', !advancedOpen);
        if (advancedToggle) advancedToggle.setAttribute('aria-expanded', String(advancedOpen));

        /* 提示条：关过一次就不再冒出来 */
        const note = $('#isetNote');
        if (note) note.hidden = ui.instNoteHidden === true;
    }

    function paintMemory(inst) {
        const range = $('#isetMemRange');
        const mode = currentMemMode();
        const custom = mode === 'custom';
        const value = custom && range ? Number(range.value) : memoryOf(inst);

        const mod = settingsMod();
        const status = mod && typeof mod.memoryStatus === 'function' ? mod.memoryStatus() : null;
        const total = Number(status && status.totalGb) || 23.6;
        const used = Number(status && status.usedGb) || 14.9;

        // 滑杆上限按真机物理内存收，别让 16 GB 的机器能拖到 32 GB
        if (range) {
            const max = Math.max(MEM_MIN, Math.min(MEM_MAX, Math.floor(total)));
            if (Number(range.max) !== max) range.max = String(max);
            if (Number(range.value) > max) range.value = String(max);
        }

        const label = $('#isetMemValue');
        if (label) label.textContent = value + ' GB';

        if (range) {
            if (custom) homeMod().paintRange(range);
            else range.value = String(value);
        }

        setText('#isetMemUsedLabel', used.toFixed(1) + ' GB / ' + total.toFixed(1) + ' GB');
        setText('#isetMemLabel', value + ' GB');

        const usedPct = Math.min(100, (used / total) * 100);
        const gamePct = Math.min(100 - usedPct, (value / total) * 100);
        const usedBar = $('#isetMeterUsed');
        const gameBar = $('#isetMeterGame');
        if (usedBar) usedBar.style.width = usedPct + '%';
        if (gameBar) {
            gameBar.style.left = usedPct + '%';
            gameBar.style.width = gamePct + '%';
        }
    }

    /** 宿主报来新的内存读数时，浮层里的内存条跟着重画（没打开就什么也不做）。 */
    function refreshMemory() {
        const inst = currentInstance();
        if (!inst || !inst.id) return;
        paintMemory(inst);
    }

    /** 列表 / 详情 / 主页三处一起刷新（改显示名、配色、收藏时需要）。 */
    function syncViews(inst) {
        const versions = versionsMod();
        versions.renderInstanceList();
        if (ui.activeId === inst.id) {
            versions.selectInstance(inst.id);
            homeMod().syncMem(inst);
        } else {
            homeMod().renderInstanceOptions();
        }
    }

    /* -----------------------------------------------------------------
       资源管理：Mod / 光影 / 材质包
       -----------------------------------------------------------------
       三类东西的界面完全一样，差别只有目录名、数据字段和文案，所以用一张表
       描述，渲染和动作共用一套代码：

         · 点一行 = 选中（可多选），底部浮出操作栏：更新 / 启用 / 禁用 /
           删除 / 取消选择；操作栏三个页面共用一条；
         · 启用 / 禁用 = 改后缀（foo.jar ⇄ foo.jar.disabled，材质包和光影是
           .zip），宿主负责真正改名，改完把这个目录的新清单发回来；
         · 删除 = 移到回收站（确认框在网页这边画，宿主那边只负责执行）；
         · 文件夹形态的光影 / 材质包改名禁不掉（游戏照样读得到里面的
           pack.mcmeta），所以只给删除，行里标一个「文件夹」。

       表的 key 就是目录名：宿主的 instance-asset 消息也是按目录名认的。
       ----------------------------------------------------------------- */
    const ASSET_KINDS = {
        mods: {
            noun: 'Mod',
            listKey: 'modFiles',
            pathKey: 'modsPath',
            previewKey: 'modPreview',
            icon: '#i-package',
            search: '#isetModSearch',
            list: '#isetModList',
            path: '#isetModPath',
            summary: '#isetModSummary',
            empty: '#isetModEmpty',
            count: '#isetModCount',
            emptyText: '这个版本的工作目录里还没有 Mod。把 .jar 放进上面的文件夹，再点「重新扫描」就会出现在这里。'
        },
        shaderpacks: {
            noun: '光影',
            listKey: 'shaderPackFiles',
            pathKey: 'shaderPacksPath',
            icon: '#i-sun',
            search: '#isetShaderSearch',
            list: '#isetShaderList',
            path: '#isetShaderPath',
            summary: '#isetShaderSummary',
            empty: '#isetShaderEmpty',
            count: '#isetShaderCount',
            emptyText: '这个版本的工作目录里还没有光影。把光影的 .zip 放进上面的文件夹就能在这里管理。'
        },
        resourcepacks: {
            noun: '材质包',
            listKey: 'resourcePackFiles',
            pathKey: 'resourcePacksPath',
            icon: '#i-layers',
            search: '#isetPackSearch',
            list: '#isetPackList',
            path: '#isetPackPath',
            summary: '#isetPackSummary',
            empty: '#isetPackEmpty',
            count: '#isetPackCount',
            emptyText: '这个版本的工作目录里还没有材质包。把材质包的 .zip 放进上面的文件夹就能在这里管理。'
        }
    };
    const ASSET_LIST = Object.keys(ASSET_KINDS);

    /** 这一类资源实际用的目录（宿主没给就从工作目录拼一个）。 */
    function assetDir(inst, kind) {
        const cfg = ASSET_KINDS[kind];
        if (!inst || !cfg) return '';
        const own = inst[cfg.pathKey];
        if (own) return own;
        const base = inst.gameDir || '';
        return base ? base + '\\' + kind : '';
    }

    /** 一个版本在某一类资源上的清单，统一成 { name, enabled, size, folder }。 */
    function assetEntries(inst, kind) {
        const cfg = ASSET_KINDS[kind];
        if (!inst || !cfg) return [];

        const files = inst[cfg.listKey];
        if (Array.isArray(files) && files.length) {
            return files.map((file) => ({
                name: file.name || '',
                enabled: file.enabled !== false,
                size: Number(file.size) || 0,
                folder: file.isFolder === true
            }));
        }

        // 浏览器预览：拿示例数据里的名字凑一列，别让页面空着。
        // 顺手写回 listKey，这样预览里点「禁用」也能改到同一份数据
        if (cfg.previewKey && Array.isArray(inst[cfg.previewKey]) && inst[cfg.previewKey].length) {
            const list = inst[cfg.previewKey].map((name) => ({
                name: name + '.jar',
                enabled: true,
                size: 0,
                folder: false
            }));
            inst[cfg.listKey] = list;
            return list;
        }
        return [];
    }

    function renderAsset(kind, inst) {
        const cfg = ASSET_KINDS[kind];
        if (!cfg) return;
        const list = $(cfg.list);
        if (!list) return;

        inst = inst || currentInstance();
        if (!inst) return;

        const files = assetEntries(inst, kind);
        const query = (($(cfg.search) && $(cfg.search).value) || '').trim().toLowerCase();
        const shown = files.filter((file) => !query || file.name.toLowerCase().indexOf(query) !== -1);
        const enabled = files.filter((file) => file.enabled).length;

        const versions = versionsMod();
        const sizeText = (bytes) => (typeof versions.formatSize === 'function'
            ? versions.formatSize(bytes)
            : bytes + ' B');

        list.innerHTML = shown.map((file) => {
            const disabled = !file.enabled;
            const selected = selectedSet(kind).has(file.name);
            // 列表里不显示 .disabled 后缀（右边的徽标已经说明了状态），
            // 但发回宿主的必须还是磁盘上的真名字
            const label = escapeHtml(file.name.replace(/\.disabled$/i, ''));
            const raw = escapeHtml(file.name);
            const chip = file.folder
                ? '<span class="iso-chip is-custom">文件夹</span>'
                : '<span class="iso-chip ' + (disabled ? 'is-off' : 'is-on') + '">' +
                    (disabled ? '已禁用' : '已启用') + '</span>';

            return '<div class="iset-mod-row' + (disabled ? ' is-disabled' : '') +
                (selected ? ' is-selected' : '') + '" role="option" tabindex="0"' +
                ' aria-selected="' + (selected ? 'true' : 'false') + '"' +
                ' data-asset-row="' + raw + '" data-asset-kind="' + kind + '"' +
                ' title="' + raw + '">' +
                '<span class="iset-mod-icon" aria-hidden="true" data-icon-kind="' + kind + '" data-icon-name="' + raw + '">' +
                    '<svg class="icon"><use href="' + cfg.icon + '"/></svg>' +
                '</span>' +
                '<span class="iset-mod-name">' + label + '</span>' +
                chip +
                '<span class="iset-mod-size num">' + escapeHtml(file.size ? sizeText(file.size) : '—') + '</span>' +
                '</div>';
        }).join('');

        setText(cfg.path, assetDir(inst, kind) || '—');
        setText(cfg.summary, files.length
            ? '共 ' + files.length + ' 个' + cfg.noun + ' · 启用 ' + enabled +
                (files.length > enabled ? ' · 禁用 ' + (files.length - enabled) : '')
            : '共 0 个' + cfg.noun);

        const count = $(cfg.count);
        if (count) {
            count.textContent = String(files.length);
            count.hidden = files.length === 0;
        }

        const empty = $(cfg.empty);
        if (empty) {
            empty.hidden = shown.length > 0;
            if (!shown.length) {
                empty.textContent = files.length
                    ? '没有匹配的' + cfg.noun + '，换个关键词试试。'
                    : cfg.emptyText;
            }
        }

        loadAssetIcons(kind, list);
        renderSelectionBar();
    }

    /* ── 资源自己的图标 ───────────────────────────────────────── */

    /** 已经试过、确定没有图标的行：别每次重画都再请求一遍。 */
    const iconMisses = Object.create(null);

    /**
     * 让每一行显示它自己的图标（Mod 的 icon.png、材质包 / 光影的 pack.png）。
     * 宿主按「目录 + 文件名」解压对应文件取图标，读不到就 404，
     * 这里保持通用图标不动 —— 不会出现一个破图占位。
     */
    function loadAssetIcons(kind, list) {
        const hostMod = SL.core.mod('host');
        if (!hostMod || typeof hostMod.hasHost !== 'function' || !hostMod.hasHost()) return;
        if (!list || typeof list.querySelectorAll !== 'function') return;

        const dir = assetDir(currentInstance(), kind);
        if (!dir) return;

        list.querySelectorAll('[data-icon-name]').forEach((cell) => {
            if (cell.classList.contains('has-image')) return;

            const name = cell.dataset.iconName || '';
            const key = kind + '::' + name;
            if (!name || iconMisses[key]) return;

            const url = '/api/asset-icon?dir=' + encodeURIComponent(dir) +
                '&name=' + encodeURIComponent(name);

            // 先把 img 放进 DOM 再设 src：图不在文档里时 loading="lazy" 永远不会触发，
            // 之前的写法就是要等 load 才 append，于是图标一个都出不来。
            const img = new Image();
            img.decoding = 'async';
            img.alt = '';
            img.className = 'iset-mod-icon-img';
            cell.classList.add('is-loading-icon');
            cell.appendChild(img);
            img.addEventListener('load', () => {
                cell.classList.remove('is-loading-icon');
                cell.classList.add('has-image');
            });
            img.addEventListener('error', () => {
                iconMisses[key] = true;
                img.remove();
                cell.classList.remove('is-loading-icon');
            });
            img.src = url;
        });
    }

    /* ── 选中与底部操作栏 ─────────────────────────────────────── */

    /** 三个页面各记一份选中集合，键是磁盘上的真实文件名。 */
    const assetSel = Object.create(null);

    function selectedSet(kind) {
        if (!assetSel[kind]) assetSel[kind] = new Set();
        return assetSel[kind];
    }

    /** 当前标签页对应的资源类型；不在资源页时返回空串（操作栏据此藏起来）。 */
    function activeAssetKind() {
        return ASSET_KINDS[lastTab] ? lastTab : '';
    }

    function clearAssetSelection(kind) {
        if (kind) selectedSet(kind).clear();
        else ASSET_LIST.forEach((item) => selectedSet(item).clear());
    }

    /** 点一行 = 选中 / 取消选中，然后只重画这一页（顺带刷新底部操作栏）。 */
    function toggleRowSelection(kind, name) {
        // 操作栏跟着当前标签页走；万一点到的是别的页的行，先切过去
        if (lastTab !== kind) setTab(kind);

        const set = selectedSet(kind);
        if (set.has(name)) set.delete(name);
        else set.add(name);
        paintAssetSelection(kind);
    }

    /* -----------------------------------------------------------------
       按住左键往下拖 = 连选
       -----------------------------------------------------------------
       交互按用户描述来的：按住左键先把按下的那一行选上，然后往下（或往上）
       拖，经过的行一起选上；拖回去会跟着缩回来（始终是「按下那一行 → 当前
       行」这个区间，加上按下之前就已经选中的那些）。

       两个不能踩的点：
         · 拖动时不能重建 DOM（innerHTML 会把手上的节点全换掉），只改
           class / aria，见 paintAssetSelection()；
         · 按下就选中有个副作用：松手时浏览器还会补一个 click。已经改过
           选择的这次 click 要吃掉（swallowClick），否则刚选上的会被翻回去。
       ----------------------------------------------------------------- */

    const DRAG_EDGE = 44;   // 离上下边缘多少像素开始自动滚动
    const DRAG_STEP = 12;   // 自动滚动的速度（像素 / 帧）

    let dragState = null;
    let dragRaf = 0;
    let swallowClick = false;

    /** 列表里当前看得到的行（搜索过滤之后的那批，顺序就是屏幕顺序）。 */
    function visibleRows(kind) {
        const cfg = ASSET_KINDS[kind];
        return cfg ? $$(cfg.list + ' .iset-mod-row') : [];
    }

    /** 只改选中态，不重建列表 —— 拖动时每跨一行都会调一次。 */
    function paintAssetSelection(kind) {
        const set = selectedSet(kind);
        visibleRows(kind).forEach((node) => {
            const on = set.has(node.dataset.assetRow);
            if (node.classList.contains('is-selected') === on) return;
            node.classList.toggle('is-selected', on);
            node.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        renderSelectionBar();
    }

    function sameNames(a, b) {
        if (a.size !== b.size) return false;
        let same = true;
        a.forEach((name) => { if (!b.has(name)) same = false; });
        return same;
    }

    function beginRowDrag(row) {
        const kind = row.dataset.assetKind;
        const name = row.dataset.assetRow;
        if (!ASSET_KINDS[kind]) return;

        swallowClick = false;   // 新手势开始，上一条 flag 作废

        // 操作栏跟着当前标签页走；万一点到的是别的页的行，先切过去（切完行会重建，重新找一次）
        if (lastTab !== kind) setTab(kind);

        const rows = visibleRows(kind);
        const index = rows.findIndex((node) => node.dataset.assetRow === name);
        if (index === -1) return;

        const set = selectedSet(kind);
        dragState = {
            kind: kind,
            name: name,
            index: index,
            base: new Set(set),   // 按下之前的选择，拖回去时用它还原
            changed: false,
            reached: index,
            edge: 0,
            x: 0,
            y: 0
        };

        // 「按住左键就把第一个选上」：本来没选中的直接选；已经选中的先不动，
        // 松手没拖动才算一次取消（走的还是 click 那套）
        if (!set.has(name)) {
            set.add(name);
            dragState.changed = true;
            paintAssetSelection(kind);
        }
    }

    /** 把「按下那一行 → 当前行」整段选上（拖回去会缩回来）。 */
    function extendDragToRow(row) {
        if (!dragState || !row) return;
        const kind = dragState.kind;
        if (row.dataset.assetKind !== kind) return;

        const rows = visibleRows(kind);
        const index = rows.findIndex((node) => node.dataset.assetRow === row.dataset.assetRow);
        if (index === -1 || index === dragState.reached) return;
        dragState.reached = index;

        const from = Math.min(dragState.index, index);
        const to = Math.max(dragState.index, index);

        const next = new Set(dragState.base);
        for (let i = from; i <= to; i += 1) next.add(rows[i].dataset.assetRow);

        const set = selectedSet(kind);
        if (sameNames(set, next)) return;

        set.clear();
        next.forEach((item) => set.add(item));
        dragState.changed = true;
        paintAssetSelection(kind);
    }

    /** 指针贴着内容区上下边缘时自动滚，方便一口气选完一长串。 */
    function dragEdgeFor(clientY) {
        const box = $('#isetScroll');
        if (!box) return 0;
        const rect = box.getBoundingClientRect();
        if (rect.height < 80) return 0;   // 布局还没算出来（首帧 / jsdom）就别滚
        if (clientY < rect.top + DRAG_EDGE) return -DRAG_STEP;
        if (clientY > rect.bottom - DRAG_EDGE) return DRAG_STEP;
        return 0;
    }

    function rowUnderPoint(x, y) {
        try {
            const el = document.elementFromPoint(x, y);
            return el && typeof el.closest === 'function' ? el.closest('[data-asset-row]') : null;
        } catch (err) {
            return null;
        }
    }

    /** 指针没动、内容在滚：重新看指针下面现在是哪一行。 */
    function pumpDragScroll() {
        dragRaf = 0;
        if (!dragState || !dragState.edge) return;

        const box = $('#isetScroll');
        if (box) box.scrollTop += dragState.edge;

        const node = rowUnderPoint(dragState.x, dragState.y);
        if (node) extendDragToRow(node);

        dragRaf = requestAnimationFrame(pumpDragScroll);
    }

    function updateDragPointer(event) {
        if (!dragState) return;
        dragState.x = event.clientX;
        dragState.y = event.clientY;
        dragState.edge = dragEdgeFor(event.clientY);
        if (dragState.edge !== 0 && !dragRaf) dragRaf = requestAnimationFrame(pumpDragScroll);
    }

    function endRowDrag() {
        if (dragRaf) {
            cancelAnimationFrame(dragRaf);
            dragRaf = 0;
        }
        if (!dragState) return;

        // 这次手势已经改过选择：紧跟着补上来的那个 click 不要再翻转一次
        swallowClick = dragState.changed;
        dragState = null;
    }

    /**
     * 底部操作栏：有选中才浮出来，按钮能不能点按选中的东西算 ——
     * 已经全是启用状态就把「启用」灰掉，反过来也一样；
     * 文件夹反正禁不掉，只留「删除」可用。
     */
    function renderSelectionBar() {
        const bar = $('#isetSelectBar');
        if (!bar) return;

        const kind = activeAssetKind();
        const cfg = ASSET_KINDS[kind];
        if (!cfg) {
            bar.hidden = true;
            bar.classList.remove('is-in');
            return;
        }

        const files = assetEntries(currentInstance(), kind);
        const set = selectedSet(kind);

        // 重新扫描 / 删完之后，选择里可能留着已经不存在的名字，顺手剔掉
        const alive = new Set(files.map((file) => file.name));
        [...set].forEach((name) => { if (!alive.has(name)) set.delete(name); });

        const picked = files.filter((file) => set.has(file.name));
        if (!picked.length) {
            bar.hidden = true;
            bar.classList.remove('is-in');
            return;
        }

        const count = $('#isetSelectCount');
        if (count) count.textContent = '已选择 ' + picked.length + ' 个文件';

        // 文件夹不能改名禁用，所以只有文件参与「能启用 / 能禁用」的判断
        const canEnable = picked.some((file) => !file.folder && !file.enabled);
        const canDisable = picked.some((file) => !file.folder && file.enabled);

        const enableBtn = bar.querySelector('[data-asset-bar="enable"]');
        const disableBtn = bar.querySelector('[data-asset-bar="disable"]');
        if (enableBtn) {
            enableBtn.disabled = !canEnable;
            enableBtn.classList.toggle('is-primary', canEnable && !canDisable);
        }
        if (disableBtn) {
            disableBtn.disabled = !canDisable;
            disableBtn.classList.toggle('is-primary', canDisable);
        }

        if (bar.hidden) {
            bar.hidden = false;
            // 先排一帧再加 class，进场过渡才会播
            requestAnimationFrame(() => bar.classList.add('is-in'));
        }
    }

    /** 操作栏上的按钮。 */
    function runBarAction(action) {
        const kind = activeAssetKind();
        const cfg = ASSET_KINDS[kind];
        const inst = currentInstance();
        if (!cfg || !inst) return;

        if (action === 'clear') {
            clearAssetSelection(kind);
            renderAsset(kind, inst);
            return;
        }

        const set = selectedSet(kind);
        const picked = assetEntries(inst, kind).filter((file) => set.has(file.name));
        if (!picked.length) return;

        if (action === 'delete') {
            deleteAssets(kind, picked.map((file) => file.name));
            return;
        }

        // 只有启用 / 禁用会走到下面；「更新」还没接更新源（按钮是灰的）
        if (action !== 'enable' && action !== 'disable') return;

        const enable = action === 'enable';
        const targets = picked.filter((file) => !file.folder && file.enabled !== enable);
        if (!targets.length) {
            toast('选中的' + cfg.noun + '已经是' + (enable ? '启用' : '禁用') + '状态了', 'i-info');
            return;
        }
        applyAssets(kind, targets.map((file) => file.name), 'toggle', enable);
    }

    /** 三个页面一起重画（切换标签、重新扫描、改完设置之后）。 */
    function renderAssets(inst) {
        ASSET_LIST.forEach((kind) => renderAsset(kind, inst));
    }

    /** 兼容旧调用点：只画 Mod 那一页。 */
    function renderMods(inst) {
        renderAsset('mods', inst);
    }

    function resetAssetSearch() {
        ASSET_LIST.forEach((kind) => {
            const input = $(ASSET_KINDS[kind].search);
            if (input) input.value = '';
        });
    }

    /** 启用 / 禁用一批：改后缀，宿主改完把整个目录的新清单发回来。 */
    function applyAssets(kind, names, action, enabled) {
        const cfg = ASSET_KINDS[kind];
        const inst = currentInstance();
        if (!cfg || !inst || !names || !names.length) return;

        const dir = assetDir(inst, kind);
        if (!dir) {
            toast('这个版本还没算出工作目录，先重新扫描一次', 'i-info');
            return;
        }

        if (!hasHost()) {
            // 预览：只改内存里的清单
            const files = inst[cfg.listKey];
            if (Array.isArray(files)) {
                names.forEach((name) => {
                    const file = files.find((item) => item.name === name);
                    if (!file) return;
                    if (action === 'delete') {
                        files.splice(files.indexOf(file), 1);
                        return;
                    }
                    file.name = enabled ? name.replace(/\.disabled$/i, '') : name + '.disabled';
                    file.enabled = enabled;
                });
            }
            clearAssetSelection(kind);
            renderAsset(kind, inst);
            toast((action === 'delete' ? '已移除 ' : (enabled ? '已启用 ' : '已禁用 ')) + names.length + ' 个（浏览器预览不会动真文件）', 'i-info');
            return;
        }

        const message = {
            type: 'instance-asset',
            kind: kind,
            action: action,
            dir: dir,
            names: names
        };
        if (action === 'toggle') message.enabled = Boolean(enabled);

        if (!hostMod().hostPost(message)) {
            toast('宿主没有收到请求，这次改动没有生效', 'i-info');
        }
    }

    /** 删除一批：先问一句，再让宿主挪进回收站。 */
    function deleteAssets(kind, names) {
        const cfg = ASSET_KINDS[kind];
        const inst = currentInstance();
        if (!cfg || !inst || !names || !names.length) return;

        const dir = assetDir(inst, kind);
        if (!dir) {
            toast('这个版本还没算出工作目录，先重新扫描一次', 'i-info');
            return;
        }

        const what = names.length === 1
            ? '把「' + names[0] + '」移到回收站？'
            : '把这 ' + names.length + ' 个' + cfg.noun + '移到回收站？';

        hostMod().confirmDialog({
            title: '删除' + cfg.noun,
            message: what + '\n\n' + dir +
                '\n\n删掉之后可以从回收站还原；清空回收站就找不回来了。',
            danger: true,
            okLabel: '移到回收站'
        }).then((confirmed) => {
            if (!confirmed) return;
            applyAssets(kind, names, 'delete', false);
        });
    }

    /** 重新扫描：宿主重新读一遍磁盘，三个页面一起更新（顶栏的「N 个」也跟着变）。 */
    async function rescanAssets() {
        const id = currentId;
        toast('正在重新扫描…', 'i-refresh');
        await versionsMod().loadInstances({ force: true });

        const inst = findInstance(id);
        if (!inst) {
            toast('这个版本已经不在列表里了', 'i-info');
            return;
        }
        currentId = inst.id;
        fill(inst);
        renderAssets(inst);
    }

    /* -----------------------------------------------------------------
       文件夹快捷方式
       ----------------------------------------------------------------- */

    function folderPath(inst, kind) {
        const base = inst.gameDir || '';
        if (kind === 'version') return inst.path || '';
        if (ASSET_KINDS[kind]) return assetDir(inst, kind);
        if (kind === 'saves') return base ? base + '\\saves' : '';
        if (kind === 'screenshots') return base ? base + '\\screenshots' : '';
        return base || inst.path || '';
    }

    function openFolder(kind) {
        const inst = currentInstance();
        if (!inst) return;

        const label = FOLDER_LABELS[kind] || '文件夹';
        if (kind === 'version') {
            hostMod().openLocation('open-instance-dir', { path: inst.path }, label);
            return;
        }

        // 资源目录走自己的消息：目录还不存在时宿主会先建出来，
        // 新版本第一次点「打开文件夹」不会弹「文件夹不存在」
        if (ASSET_KINDS[kind]) {
            const dir = assetDir(inst, kind);
            if (!dir) {
                toast('这个版本还没算出工作目录，先重新扫描一次', 'i-info');
                return;
            }
            hostMod().openLocation('open-asset-dir', { dir: dir, kind: kind }, label);
            return;
        }

        const path = folderPath(inst, kind);
        if (!path) {
            toast('这个版本还没算出工作目录，先重新扫描一次', 'i-info');
            return;
        }
        hostMod().openLocation('open-path', { path: path, base: inst.gameDir || inst.path }, label);
    }

    /* -----------------------------------------------------------------
       导出
       ----------------------------------------------------------------- */

    let exportTimer = 0;

    function startExport() {
        const inst = currentInstance();
        if (!inst) return;

        if (!hasHost()) {
            toast('导出要跑在启动器里，浏览器预览写不了 zip', 'i-info');
            return;
        }

        const parts = $$('.iset-export-list input[type="checkbox"]')
            .filter((input) => !input.disabled && input.checked)
            .map((input) => input.value)
            .filter(Boolean);

        const name = (($('#isetExportName') && $('#isetExportName').value) || '').trim() || inst.name;
        const version = (($('#isetExportVersion') && $('#isetExportVersion').value) || '').trim() || '1.0.0';

        const btn = $('#isetExportStart');
        if (btn) btn.disabled = true;
        window.clearTimeout(exportTimer);
        exportTimer = window.setTimeout(() => {
            if (btn) btn.disabled = false;
        }, 180000);

        const ok = hostMod().hostPost({
            type: 'export-instance',
            path: inst.path,
            name: name,
            version: version,
            parts: parts
        });

        if (!ok) {
            if (btn) btn.disabled = false;
            toast('宿主没有收到导出请求', 'i-info');
            return;
        }
        toast('正在打包「' + name + '-' + version + '」…', 'i-package');
    }

    /* -----------------------------------------------------------------
       宿主回包
       ----------------------------------------------------------------- */

    function onHostMessage(data) {
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'instance-settings-saved') {
            if (!data.ok) {
                showSaveError(data.error || '未知错误');
                return;
            }
            saveErrorShown = false;
            markSaved();

            if (data.action === 'reset') {
                const inst = findInstance(currentId);
                if (inst) {
                    inst.settings = null;
                    applyToInstance(inst);
                    fill(inst);
                    syncViews(inst);
                }
            }

            // 版本隔离会改变工作目录，必须让宿主重扫一遍才能算对 mods / 存档位置
            if (isolationDirty) {
                isolationDirty = false;
                const id = currentId;
                versionsMod().loadInstances({ force: true }).then(() => {
                    const inst = findInstance(id);
                    if (!inst) return;
                    currentId = inst.id;
                    fill(inst);
                    renderAssets(inst);
                    syncViews(inst);
                });
            }
            return;
        }

        if (data.type === 'loader-changed') {
            const install = $('#isetLoaderInstall');
            if (install) install.disabled = false;

            if (!data.ok) {
                setLoaderStatus('加载器没装上：' + (data.error || '系统没有给出原因'), 'error');
                return;
            }

            setLoaderStatus('已装好「' + (data.name || '新版本') + '」，正在刷新版本列表…');
            toast('已安装 ' + (data.name || '新加载器'), 'i-check');
            versionsMod().loadInstances({ force: true }).then(() => {
                const inst = currentInstance();
                if (inst) {
                    renderLoaderNow(inst);
                    // 新装出来的加载器版本很可能就是用户想选的：提一句
                    setLoaderStatus('装好了。新版本已经出现在版本管理列表里，可以切过去试试。');
                }
            });
            return;
        }

        if (data.type === 'instance-asset') {
            const cfg = ASSET_KINDS[data.kind];
            const inst = currentInstance();
            if (!cfg || !inst) return;

            const names = Array.isArray(data.names) ? data.names
                : (data.name ? [data.name] : []);
            const count = names.length || 1;

            // 即使是部分失败，宿主也会把刷新后的清单发回来：先更新界面再报错
            if (Array.isArray(data.files)) inst[cfg.listKey] = data.files;
            if (data.kind === 'mods') inst.mods = (inst[cfg.listKey] || []).length;

            clearAssetSelection(data.kind);
            renderAsset(data.kind, inst);
            if (data.kind === 'mods') syncViews(inst);

            if (!data.ok) {
                uiMod().notice('没能完成操作', data.error || '系统没有给出原因');
                return;
            }

            if (data.action === 'delete') {
                toast('已把 ' + count + ' 个' + cfg.noun + '移到回收站', 'i-trash');
            } else {
                toast('已' + (data.enabled ? '启用' : '禁用') + ' ' + count + ' 个' + cfg.noun, 'i-check');
            }
            return;
        }

        if (data.type === 'export-instance') {
            window.clearTimeout(exportTimer);
            resetExportButton();
            if (data.canceled) return;

            if (!data.ok) {
                uiMod().notice('导出失败', data.error || '系统没有给出原因');
                return;
            }

            const files = Number(data.files) || 0;
            setText('#isetExportHint', '已导出 ' + files + ' 个文件：' + (data.path || ''));
            toast('已导出 ' + files + ' 个文件', 'i-check');
        }
    }

    /* -----------------------------------------------------------------
       事件绑定
       ----------------------------------------------------------------- */

    function currentFromUi() {
        return currentInstance();
    }

    /** 输入框：边打字边存（防抖），失焦时补一次并把列表一起刷新。 */
    function bindText(sel, key, options) {
        const el = $(sel);
        if (!el) return;
        const opts = options || {};

        el.addEventListener('input', () => {
            const inst = currentFromUi();
            if (!inst) return;
            updateSettings(inst, { [key]: el.value }, { delay: SAVE_DELAY });
        });

        el.addEventListener('change', () => {
            const inst = currentFromUi();
            if (!inst) return;
            updateSettings(inst, { [key]: el.value }, { delay: 0 });
            if (opts.keepManual) javaManual = true;
            if (opts.list) {
                fill(inst); // 显示名会同步到浮层标题和概览卡片
                syncViews(inst);
            }
            if (opts.mem) paintMemory(inst);
            if (opts.java) fill(inst);
        });
    }

    /** 下拉：选完立即存，after 里做和这一项相关的界面联动。 */
    function bindSelect(sel, key, after) {
        const el = $(sel);
        if (!el) return;
        el.addEventListener('change', () => {
            const inst = currentFromUi();
            if (!inst) return;
            const value = el.value;
            updateSettings(inst, { [key]: value === '' ? null : value }, { delay: 0 });
            if (after) after(inst, value);
        });
    }

    function bindOnOffSelect(sel, key) {
        const el = $(sel);
        if (!el) return;
        el.addEventListener('change', () => {
            const inst = currentFromUi();
            if (!inst) return;
            const value = el.value;
            updateSettings(inst, { [key]: value === '' ? null : value === 'on' }, { delay: 0 });
            fill(inst);
            syncViews(inst);
        });
    }

    function bindInstanceSettings() {
        bindLoaderPage();

        const root = $('#instSettings');
        if (!root) return;

        /* 关闭 / 分组 / 快捷方式：一次委托 */
        root.addEventListener('click', (event) => {
            if (event.target.closest('[data-inst-close]')) {
                closeInstanceSettings();
                return;
            }
            const tabBtn = event.target.closest('[data-inst-tab]');
            if (tabBtn) {
                setTab(tabBtn.dataset.instTab);
                return;
            }
            // 资源行：点一行 = 选中；底部操作栏的按钮各管一件事
            const row = event.target.closest('[data-asset-row]');
            if (row) {
                // 拖选结束时浏览器会补一个 click：已经改过选择的这一次要吞掉，
                // 不然刚拖出来的那些会被这一下翻转掉
                if (swallowClick) {
                    swallowClick = false;
                    return;
                }
                toggleRowSelection(row.dataset.assetKind, row.dataset.assetRow);
                return;
            }
            swallowClick = false;   // 点到别的地方，这条 flag 作废
            const barBtn = event.target.closest('[data-asset-bar]');
            if (barBtn) {
                if (!barBtn.disabled) runBarAction(barBtn.dataset.assetBar);
                return;
            }
            const rescanBtn = event.target.closest('[data-asset-rescan]');
            if (rescanBtn) {
                rescanAssets();
                return;
            }
            const openBtn = event.target.closest('[data-inst-open]');
            if (openBtn) openFolder(openBtn.dataset.instOpen);
        });

        /* 键盘：资源行上回车 / 空格 = 选中（行本身是 role=option） */
        root.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const row = event.target.closest('[data-asset-row]');
            if (!row) return;
            event.preventDefault();
            toggleRowSelection(row.dataset.assetKind, row.dataset.assetRow);
        });

        /* 鼠标：按住左键往下拖 = 连选 */
        root.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            const row = event.target.closest('[data-asset-row]');
            if (row) beginRowDrag(row);
        });

        root.addEventListener('mousemove', (event) => {
            if (!dragState) return;
            if ((event.buttons & 1) === 0) {
                // 松手事件漏了（比如拖到窗口外面才松的），别让拖动粘住
                endRowDrag();
                return;
            }
            const row = event.target.closest('[data-asset-row]');
            if (row) extendDragToRow(row);
            updateDragPointer(event);
        });

        // 松手可能发生在浮层外面，所以挂到 document 上
        document.addEventListener('mouseup', () => {
            if (dragState) endRowDrag();
        });

        /* 概览：显示名 / 描述 / 配色 / 收藏 */
        bindText('#isetName', 'alias', { list: true });
        bindText('#isetDesc', 'description');
        bindSelect('#isetTone', 'tone', (inst) => {
            fill(inst);
            syncViews(inst);
        });

        const fav = $('#isetFav');
        if (fav) {
            fav.addEventListener('click', () => {
                const inst = currentFromUi();
                if (!inst) return;
                const next = fav.getAttribute('aria-checked') !== 'true';
                fav.setAttribute('aria-checked', String(next));
                updateSettings(inst, { favorite: next }, { delay: 0 });
                syncViews(inst);
                toast(next ? '已收藏「' + inst.name + '」' : '已取消收藏', next ? 'i-check' : 'i-info');
            });
        }

        /* 概览：高级管理 */
        const openConfig = $('#isetOpenConfig');
        if (openConfig) {
            openConfig.addEventListener('click', () => {
                const inst = currentFromUi();
                if (!inst) return;
                if (!inst.settings) {
                    toast('这个版本还没有单独的设置文件，改任意一项就会生成', 'i-info');
                    return;
                }
                const base = inst.path || '';
                const path = base.replace(/[\\/]$/, '') + '\\StarLaunch.instance.json';
                hostMod().openLocation('open-path', { path: path, base: base }, '设置文件');
            });
        }

        const reset = $('#isetReset');
        if (reset) {
            reset.addEventListener('click', async () => {
                const inst = currentFromUi();
                if (!inst) return;
                const confirmed = await hostMod().confirmDialog({
                    title: '恢复默认设置',
                    message: '把「' + inst.name + '」的独立设置全部清掉，回到跟随全局？\n\n' +
                        '会删除版本目录里的 StarLaunch.instance.json，版本文件和存档都不受影响。',
                    danger: true,
                    okLabel: '恢复默认'
                });
                if (!confirmed) return;

                inst.settings = null;
                if (!hasHost()) {
                    delete previewStore[inst.id];
                    writeStore(STORE.instancePrefs, previewStore);
                } else {
                    hostMod().hostPost({
                        type: 'reset-instance-settings',
                        id: inst.path,
                        path: inst.path
                    });
                    // 清掉的可能正好是隔离覆盖值，重扫一次才准
                    isolationDirty = true;
                }
                applyToInstance(inst);
                fill(inst);
                renderMods(inst);
                syncViews(inst);
                toast('已恢复默认设置', 'i-refresh');
            });
        }

        const rescan = $('#isetRescan');
        if (rescan) {
            rescan.addEventListener('click', async () => {
                const id = currentId;
                toast('正在重新扫描…', 'i-refresh');
                await versionsMod().loadInstances({ force: true });
                const inst = findInstance(id);
                if (inst) {
                    currentId = inst.id;
                    fill(inst);
                    renderMods(inst);
                } else {
                    toast('这个版本已经不在列表里了', 'i-info');
                }
            });
        }

        /* 设置：启动选项 */
        bindSelect('#isetIsolation', 'isolation', (inst, value) => {
            // 隔离策略一变，工作目录就变了：让宿主重扫一遍才算得对 mods / 存档
            isolationDirty = true;
            fill(inst);
            syncViews(inst);
            if (!hasHost()) {
                // 预览里没有宿主重扫，直接按选择改一下「实际工作目录」的显示
                if (value === 'on') inst.isolatedByPolicy = true;
                else if (value === 'off') inst.isolatedByPolicy = false;
                versionsMod().selectInstance(inst.id);
            }
        });

        bindText('#isetWindowTitle', 'windowTitle');
        bindText('#isetCustomInfo', 'customInfo');

        const javaSelect = $('#isetJava');
        if (javaSelect) {
            javaSelect.addEventListener('change', () => {
                const inst = currentFromUi();
                if (!inst) return;
                const value = javaSelect.value;
                const row = $('#isetJavaPathRow');
                const pathInput = $('#isetJavaPath');

                if (value === 'custom') {
                    // 先只把输入框露出来；用户填了路径才真正写进设置文件
                    javaManual = true;
                    if (row) row.hidden = false;
                    if (pathInput) pathInput.focus({ preventScroll: true });
                    return;
                }

                javaManual = false;
                if (row) row.hidden = true;
                updateSettings(inst, { java: value === 'auto' ? 'auto' : null }, { delay: 0 });
                fill(inst);
                syncViews(inst);
            });
        }
        bindText('#isetJavaPath', 'java', { java: true, keepManual: true });

        /* 设置：内存 */
        $$('input[name="isetMemMode"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                const inst = currentFromUi();
                if (!inst) return;

                if (radio.value === 'custom') {
                    const gb = memoryOf(inst);
                    updateSettings(inst, { memoryMode: 'custom', memoryMb: gb * MB_PER_GB }, { delay: 0 });
                } else if (radio.value === 'auto') {
                    updateSettings(inst, { memoryMode: 'auto', memoryMb: null }, { delay: 0 });
                } else {
                    updateSettings(inst, { memoryMode: null, memoryMb: null }, { delay: 0 });
                }
                fill(inst);
                homeMod().syncMem(inst);
                paintMemory(inst);
            });
        });

        const memRange = $('#isetMemRange');
        if (memRange) {
            memRange.addEventListener('input', () => {
                const inst = currentFromUi();
                if (!inst) return;
                updateSettings(inst, {
                    memoryMode: 'custom',
                    memoryMb: Number(memRange.value) * MB_PER_GB
                }, { delay: SAVE_DELAY });
                paintMemory(inst);
                homeMod().syncMem(inst);
            });
            memRange.addEventListener('change', () => {
                const inst = currentFromUi();
                if (!inst) return;
                updateSettings(inst, {
                    memoryMode: 'custom',
                    memoryMb: Number(memRange.value) * MB_PER_GB
                }, { delay: 0 });
                toast('已为「' + inst.name + '」分配 ' + memoryOf(inst) + ' GB 内存', 'i-chip');
            });
        }

        bindSelect('#isetMemOptimize', 'memoryOptimize');

        /* 设置：高级 */
        bindText('#isetJvmArgs', 'jvmArgs');
        bindText('#isetGameArgs', 'gameArgs');
        bindText('#isetPreCommand', 'preCommand');
        bindOnOffSelect('#isetDisableWrapper', 'disableWrapper');
        bindOnOffSelect('#isetHighPerfGpu', 'highPerfGpu');

        const advancedToggle = $('#isetAdvancedToggle');
        if (advancedToggle) {
            advancedToggle.addEventListener('click', () => {
                advancedOpen = !advancedOpen;
                const block = $('#isetAdvancedBlock');
                if (block) block.classList.toggle('is-collapsed', !advancedOpen);
                advancedToggle.setAttribute('aria-expanded', String(advancedOpen));
            });
        }

        const noteClose = $('#isetNoteClose');
        if (noteClose) {
            noteClose.addEventListener('click', () => {
                const note = $('#isetNote');
                if (note) note.hidden = true;
                ui.instNoteHidden = true;
                writeStore(STORE.uiPrefs, ui);
            });
        }

        /* 资源管理：三个页面各有一根搜索框，输入时只重画自己那一页 */
        ASSET_LIST.forEach((kind) => {
            const input = $(ASSET_KINDS[kind].search);
            if (input) input.addEventListener('input', () => renderAsset(kind, currentFromUi()));
        });

        /* 导出 */
        const exportBtn = $('#isetExportStart');
        if (exportBtn) exportBtn.addEventListener('click', startExport);

        /* 入口：版本详情里的「实例设置」 */
        const detailBtn = $('#instSettingsBtn');
        if (detailBtn) {
            detailBtn.addEventListener('click', () => openInstanceSettings(ui.activeId));
        }

        /* 键盘：Esc 关掉整个浮层（下拉自己会先吃掉 Esc，这里再兜一层） */
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const el = $('#instSettings');
            if (!el || el.hidden) return;

            const menu = $('#slSelectMenu');
            if (menu && !menu.hidden) {
                event.preventDefault();
                event.stopPropagation();
                if (SL.select && typeof SL.select.close === 'function') SL.select.close();
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            closeInstanceSettings();
        });

        /* 宿主回包：自己监听，不抢 03-host 已有的那套 */
        if (window.chrome && window.chrome.webview &&
            typeof window.chrome.webview.addEventListener === 'function') {
            window.chrome.webview.addEventListener('message', (event) => {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (err) { return; }
                }
                onHostMessage(data);
            });
        }
    }


    /* -----------------------------------------------------------------
       「修改」页：查看 / 更换已经装好的加载器
       -----------------------------------------------------------------
       宿主两步：
         loader-options → reply { mc, options: [LoaderChoice…] }  列可选加载器
         loader-change  → 下载队列里装一个新版本，装完推 loader-changed
       换加载器不会动原来的实例（新加载器 = 新版本目录），所以这里只负责
       把「装了个新的」这件事说清楚，不假装是原地升级。
       ----------------------------------------------------------------- */
    let loaderOptions = [];
    let loaderRequested = false;

    function setLoaderStatus(text, kind) {
        const el = $('#isetLoaderStatus');
        if (!el) return;
        if (!text) {
            el.hidden = true;
            el.textContent = '';
            el.classList.remove('is-error');
            return;
        }
        el.hidden = false;
        el.textContent = text;
        el.classList.toggle('is-error', kind === 'error');
    }

    /** 这一页的「现在是哪个加载器」。 */
    function renderLoaderNow(inst) {
        if (!inst) return;
        setText('#isetLoaderNow', inst.loaderName || inst.loader || 'Vanilla');
        setText('#isetLoaderMc', 'Minecraft ' + (inst.mc || '—'));

        // 已安装的加载器版本列表：同一个游戏文件夹里所有带加载器的实例
        const list = $('#isetLoaderList');
        const empty = $('#isetLoaderEmpty');
        if (!list) return;

        const rows = (SL.state.instances || []).filter((item) =>
            item.id !== inst.id &&
            item.dirPath === inst.dirPath &&
            item.loader && item.loader !== 'Vanilla');

        list.innerHTML = rows.map((item) =>
            '<div class="iset-mod-row" role="option" aria-selected="false" tabindex="0"' +
                ' data-loader-switch="' + escapeHtml(item.id) + '"' +
                ' title="' + escapeHtml(item.path || '') + '">' +
                '<span class="iset-mod-icon" aria-hidden="true"><svg class="icon"><use href="#i-chip"/></svg></span>' +
                '<span class="iset-mod-name">' + escapeHtml(item.loaderName || item.loader) + '</span>' +
                '<span class="iso-chip is-on">' + escapeHtml(item.mc || '') + '</span>' +
            '</div>').join('');

        if (empty) empty.hidden = rows.length > 0;
    }

    /** 拉这个原版版本的加载器清单。 */
    function loadLoaderOptions(force) {
        const inst = currentInstance();
        if (!inst || !inst.mc) return;
        if (loaderRequested && !force) return;

        const hostMod = SL.core.mod('host');
        if (!hostMod || typeof hostMod.request !== 'function' || !hostMod.hasHost()) {
            const pick = $('#isetLoaderPick');
            if (pick) pick.innerHTML = '<option value="">浏览器预览里读不到加载器列表</option>';
            return;
        }

        loaderRequested = true;
        setLoaderStatus('正在读取 ' + inst.mc + ' 可用的加载器…');

        hostMod.request('loader-options', { mc: inst.mc }, 30000)
            .then((data) => {
                loaderOptions = Array.isArray(data && data.options) ? data.options : [];
                fillLoaderPick(inst);
                setLoaderStatus('');
            })
            .catch((err) => {
                loaderRequested = false;
                setLoaderStatus(String(err && err.message ? err.message : err), 'error');
            });
    }

    function fillLoaderPick(inst) {
        const pick = $('#isetLoaderPick');
        const versionPick = $('#isetLoaderVersion');
        if (!pick) return;

        const usable = loaderOptions.filter((item) => !item.manual && item.versions && item.versions.length);
        if (!usable.length) {
            pick.innerHTML = '<option value="">这个版本没有可安装的加载器</option>';
            if (versionPick) versionPick.innerHTML = '<option value="">—</option>';
            return;
        }

        const previous = pick.value;
        pick.innerHTML = usable.map((item) =>
            '<option value="' + escapeHtml(item.key) + '">' + escapeHtml(item.name) +
            '（' + item.versions.length + ' 个版本）</option>').join('');

        // 默认停在「换成别的」：和当前加载器不同的第一个
        const currentKey = String(inst.loader || 'Vanilla').toLowerCase();
        const other = usable.find((item) => item.key !== currentKey);
        pick.value = usable.some((item) => item.key === previous) ? previous
            : (other ? other.key : usable[0].key);

        fillLoaderVersions();
    }

    function fillLoaderVersions() {
        const pick = $('#isetLoaderPick');
        const versionPick = $('#isetLoaderVersion');
        if (!pick || !versionPick) return;

        const choice = loaderOptions.find((item) => item.key === pick.value);
        // 只认真的带 version 字符串的条目：宿主字段名变了也不会渲染出一串 "undefined"
        const versions = (choice && Array.isArray(choice.versions) ? choice.versions : [])
            .filter((item) => item && typeof item.version === 'string' && item.version.length > 0);

        if (!versions.length) {
            versionPick.innerHTML = '<option value="">—</option>';
            setText('#isetLoaderVersionHint', choice && choice.note ? choice.note : '这个加载器没有可用版本');
            return;
        }

        versionPick.innerHTML = versions.map((item) =>
            '<option value="' + escapeHtml(item.version) + '"' +
            (item.recommended ? ' selected' : '') + '>' +
            escapeHtml(item.version) + (item.recommended ? '（推荐）' : '') + '</option>').join('');

        // 推荐版可能不是第一条：没标推荐就选第一条
        if (!versions.some((item) => item.recommended)) versionPick.value = versions[0].version;

        setText('#isetLoaderVersionHint', '共 ' + versions.length + ' 个版本，装完会新建一个版本目录');
    }

    /** 安装选中的加载器（走下载队列，宿主那边有进度）。 */
    function installLoader() {
        const inst = currentInstance();
        if (!inst) return;

        const pick = $('#isetLoaderPick');
        const versionPick = $('#isetLoaderVersion');
        const loader = pick ? pick.value : '';
        const loaderVersion = versionPick ? versionPick.value : '';

        if (!loader) {
            setLoaderStatus('先选一个加载器', 'error');
            return;
        }

        const hostMod = SL.core.mod('host');
        if (!hostMod || typeof hostMod.hostPost !== 'function' || !hostMod.hasHost()) {
            setLoaderStatus('只有启动器里才能安装加载器', 'error');
            return;
        }

        const btn = $('#isetLoaderInstall');
        if (btn) btn.disabled = true;

        setLoaderStatus('已经加进下载队列，装完会新建一个版本目录…');
        hostMod.hostPost({
            type: 'loader-change',
            id: 'loader' + Date.now().toString(36),
            mc: inst.mc,
            dir: inst.dirPath || '',
            loader: loader,
            loaderVersion: loaderVersion
        });
    }

    function bindLoaderPage() {
        const pick = $('#isetLoaderPick');
        if (pick) {
            pick.addEventListener('change', () => {
                fillLoaderVersions();
                setLoaderStatus('');
            });
        }

        const reload = $('#isetLoaderReload');
        if (reload) {
            reload.addEventListener('click', () => loadLoaderOptions(true));
        }

        const install = $('#isetLoaderInstall');
        if (install) install.addEventListener('click', installLoader);

        // 点已安装列表里的一行 = 切到那个版本
        const list = $('#isetLoaderList');
        if (list) {
            list.addEventListener('click', (event) => {
                const row = event.target.closest('[data-loader-switch]');
                if (!row) return;
                const id = row.dataset.loaderSwitch;
                const versions = SL.core.mod('versions');
                closeInstanceSettings();
                if (versions && typeof versions.selectInstance === 'function') versions.selectInstance(id);
            });
        }
    }

    /* 导出成功/失败的按钮恢复：抽出来给 onHostMessage 用 */
    function resetExportButton() {
        const btn = $('#isetExportStart');
        if (btn) btn.disabled = false;
    }

    SL.instance = Object.assign(SL.instance || {}, {
        TABS,
        renderLoaderNow,
        loadLoaderOptions,
        bindLoaderPage,
        settingsOf,
        applyToInstance,
        memoryOf,
        refreshMemory,
        resolve,
        updateSettings,
        openInstanceSettings,
        closeInstanceSettings,
        fill,
        renderMods,
        renderAsset,
        renderAssets,
        renderSelectionBar,
        runBarAction,
        applyAssets,
        deleteAssets,
        onHostMessage,
        bindInstanceSettings
    });
})(window);
