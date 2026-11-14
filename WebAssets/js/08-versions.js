/* =====================================================================
   StarLaunch · 版本管理
   ---------------------------------------------------------------------
   从宿主读 .minecraft/versions、渲染列表与详情、隔离状态联动。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, escapeHtml, pad2, writeStore } = SL.core;
    const { EMPTY_INSTANCE, activeInstance, getInstance, launchPrefs, modsLabel, ui } = SL.state;
    const hostMod = SL.core.mod('host');
    const hasHost = (...args) => hostMod.hasHost(...args);
    const hostPost = (...args) => hostMod.hostPost(...args);
    const openLocation = (...args) => hostMod.openLocation(...args);
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const homeMod = SL.core.mod('home');
    const renderInstanceOptions = (...args) => homeMod.renderInstanceOptions(...args);
    const syncMem = (...args) => homeMod.syncMem(...args);

    function renderInstanceList() {
        const host = $('#instList');
        if (!host) return;

        if (!SL.state.instances.length) {
            host.innerHTML = '';
            filterInstances();
            refreshFolderView();
            return;
        }

        host.innerHTML = SL.state.instances.map((inst) => {
            const active = inst.id === ui.activeId;
            const iso = isolationState(inst);
            const chip = SL.state.scanState.loaded
                ? '<span class="iso-chip ' + iso.tone + '">' + iso.label + '</span>'
                : '';
            const meta = inst.broken
                ? escapeHtml(inst.error || '无法识别')
                : escapeHtml(inst.mc + ' · ' + modsLabel(inst) + ' · ' + inst.last);
            // 合并列表里标出所属 .minecraft；按文件夹筛选时由 CSS 收起来
            const folderTag = inst.dirName
                ? '<span class="inst-row-dir" title="' + escapeHtml(inst.dirPath) + '">' + escapeHtml(inst.dirName) + '</span>'
                : '';

            return '<article class="inst-row' + (active ? ' is-active' : '') + (inst.broken ? ' is-broken' : '') + '" data-instance-row="' + escapeHtml(inst.id) + '" data-kind="' + inst.kind + '" tabindex="0" role="button" aria-pressed="' + active + '" title="' + escapeHtml(inst.path) + '">' +
                '<span class="inst-row-tile tile--' + inst.tone + '" aria-hidden="true"><svg class="cube"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-row-main">' +
                    '<span class="inst-row-name"><span class="inst-row-name-text">' + escapeHtml(inst.name) + '</span><span class="badge">' + escapeHtml(inst.loader) + '</span>' + chip + folderTag + '</span>' +
                    '<span class="inst-row-meta">' + meta + '</span>' +
                '</span>' +
                '<span class="inst-row-side num">' + inst.mem + ' GB</span>' +
                '<button class="icon-btn inst-row-more" type="button" data-toast="实例操作：设为默认 / 打开目录 / 删除" aria-label="更多操作">' +
                    '<svg class="icon"><use href="#i-more"/></svg>' +
                '</button>' +
            '</article>';
        }).join('');
        filterInstances();
        refreshFolderView();
    }

    /** 侧栏高亮 / 版本行文件夹标签的显隐由 folders 模块统一处理（懒解析，避免循环引用）。 */
    function refreshFolderView() {
        const mod = SL.core.mod('folders');
        if (typeof mod.syncFolderView === 'function') mod.syncFolderView();
    }

    function selectInstance(id, options) {
        const inst = getInstance(id);
        ui.activeId = inst.id;
        writeStore(STORE.uiPrefs, ui);

        const nameEl = $('#curInstName');
        if (nameEl) nameEl.textContent = inst.name;
        const metaEl = $('#curInstMeta');
        if (metaEl) metaEl.textContent = inst.loader + ' · ' + inst.mc + ' · ' + modsLabel(inst);
        const tile = $('#curInstTile');
        if (tile) tile.className = 'inst-tile tile--' + inst.tone;

        $$('[data-instance-row]').forEach((row) => {
            const active = row.dataset.instanceRow === ui.activeId;
            row.classList.toggle('is-active', active);
            row.setAttribute('aria-pressed', String(active));
        });

        const hero = $('#detailHero');
        if (hero) hero.dataset.tone = inst.tone;
        const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
        setText('#vHeroMc', 'MINECRAFT ' + inst.mc);
        setText('#vHeroName', inst.name);
        setText('#vPath', inst.path);
        setText('#vMc', 'Minecraft ' + inst.mc);
        setText('#vLoader', inst.loaderName);
        setText('#vMods', inst.mods > 0 ? inst.mods + ' 个' : '无模组');
        setText('#vJava', inst.java || '—');
        setText('#vLast', inst.last);
        setText('#vModsCount', inst.mods > 0 ? inst.mods + ' 个' : '无模组');

        // 版本隔离：设置要求 vs 目录里实际有的东西
        const iso = isolationState(inst);
        const isoEl = $('#vIsolation');
        if (isoEl) {
            isoEl.textContent = iso.label;
            isoEl.className = 'iso-chip ' + iso.tone;
            isoEl.title = inst.gameDir ? '实际工作目录：' + inst.gameDir : '';
        }
        setText('#vGameDir', inst.gameDir || '—');
        const folderEl = $('#vFolder');
        if (folderEl) {
            folderEl.textContent = inst.dirName || '—';
            folderEl.title = inst.dirPath || '';
        }
        setText('#vSize', formatSize(inst.size));
        const typeLabel = inst.broken
            ? '无法识别'
            : inst.type === 'snapshot' ? '预览版'
                : inst.type === 'release' ? '正式版'
                    : (inst.type || '—');
        setText('#vType', typeLabel);

        const chips = $('#vModChips');
        if (chips) {
            if (inst.mods > 0) {
                const preview = inst.modPreview.slice(0, 3);
                const rest = inst.mods - preview.length;
                chips.innerHTML = preview.map((n) => '<span>' + escapeHtml(n) + '</span>').join('') +
                    (rest > 0 ? '<span class="is-more">+' + rest + '</span>' : '');
            } else {
                chips.innerHTML = '<span class="is-empty">纯净原版 · 未安装模组</span>';
            }
        }

        syncMem(inst);
        renderInstanceOptions();

        if (options && options.toast) toast('已切换到「' + inst.name + '」');
    }

    function filterInstances() {
        const query = (($('#instSearch') && $('#instSearch').value) || '').trim().toLowerCase();
        const folderId = ui.folderFilter || 'all';
        let visible = 0;
        $$('[data-instance-row]').forEach((row) => {
            const inst = getInstance(row.dataset.instanceRow);
            const kindOk = ui.instFilter === 'all' || inst.kind === ui.instFilter;
            const folderOk = folderId === 'all' || inst.dirId === folderId;
            const text = (inst.name + ' ' + inst.mc + ' ' + inst.loader + ' ' + inst.loaderName).toLowerCase();
            const show = kindOk && folderOk && (!query || text.indexOf(query) !== -1);
            row.hidden = !show;
            if (show) visible += 1;
        });
        const empty = $('#instEmpty');
        if (empty) {
            empty.hidden = visible > 0;
            if (visible === 0) {
                if (!SL.state.instances.length) {
                    empty.textContent = '还没有扫描到版本。' + emptyHint();
                } else if (folderId !== 'all') {
                    empty.textContent = '这个文件夹里没有匹配的版本，换个文件夹或清掉筛选试试。';
                } else {
                    empty.textContent = '没有匹配的实例，换个关键词试试。';
                }
            }
        }
    }

    /* -----------------------------------------------------------------
       版本管理：从宿主读 .minecraft/versions
       -----------------------------------------------------------------
       数据由宿主扫磁盘得出（GET /api/versions），网页只负责展示。
       隔离策略跟着设置里的「默认版本隔离」走，改设置就重新扫一遍，
       这样每个版本会立刻显示「按当前设置实际会用哪个目录」。 */

    const LOADER_TONE = {
        Vanilla: 'plain', NeoForge: 'sunset', Forge: 'ember',
        Fabric: 'sky', Quilt: 'violet', OptiFine: 'deep', LiteLoader: 'violet'
    };
    const TONE_CYCLE = ['winter', 'sky', 'violet', 'deep', 'sunset', 'ember', 'plain'];

    function toneFor(version, index) {
        return LOADER_TONE[version.loader] || TONE_CYCLE[index % TONE_CYCLE.length];
    }

    function formatSize(bytes) {
        let value = Number(bytes) || 0;
        if (value <= 0) return '—';
        const units = ['B', 'KB', 'MB', 'GB'];
        let index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        return (value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index];
    }

    function formatLastPlayed(iso) {
        if (!iso) return '尚未启动';
        const when = new Date(iso);
        if (isNaN(when.getTime())) return '尚未启动';
        const diff = Date.now() - when.getTime();
        if (diff < 0) return '刚刚';
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
        if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
        const days = Math.floor(diff / 86400000);
        if (days === 1) return '昨天 ' + pad2(when.getHours()) + ':' + pad2(when.getMinutes());
        if (days < 30) return days + ' 天前';
        return (when.getMonth() + 1) + '-' + pad2(when.getDate());
    }

    /** 宿主的一条版本记录 → 页面一直用的实例结构。 */
    function toInstance(version, index) {
        const dirId = version.dirId || '';
        return {
            // 多文件夹合并列表：不同文件夹里可能有同名版本，key 必须带上文件夹
            id: dirId ? dirId + '::' + version.id : version.id,
            versionId: version.id,
            name: version.name || version.id,
            loader: version.loader || 'Vanilla',
            loaderName: version.loaderName || version.loader || 'Vanilla',
            mc: version.mc || '未知',
            mods: Number(version.mods) || 0,
            mem: instanceMem(dirId ? dirId + '::' + version.id : version.id),
            java: version.java ? 'Java ' + version.java : '未知',
            kind: version.kind === 'modded' ? 'modded' : 'vanilla',
            tone: toneFor(version, index),
            last: formatLastPlayed(version.lastPlayed),
            path: version.path || '',
            modPreview: Array.isArray(version.modPreview) ? version.modPreview : [],
            isolated: Boolean(version.isolated),
            isolatedByPolicy: Boolean(version.isolatedByPolicy),
            mismatch: Boolean(version.mismatch),
            modsShared: Boolean(version.modsShared),
            gameDir: version.gameDir || '',
            size: Number(version.size) || 0,
            type: version.type || 'release',
            hasJar: Boolean(version.hasJar),
            broken: Boolean(version.error),
            error: version.error || '',
            dirId,
            dirPath: version.dirPath || '',
            dirName: version.dirName || '',
            dirIsolation: version.dirIsolation || 'all'
        };
    }

    function instanceMem(id) {
        const table = ui.instanceMem || {};
        const saved = Number(table[id]);
        if (saved > 0) return saved;
        return Number(launchPrefs.mem) || 8;
    }

    /** 隔离状态 → 徽标文案与配色。 */
    function isolationState(inst) {
        if (!inst || !inst.id) return { label: '未选择', tone: 'is-off' };
        if (inst.isolated === undefined) return { label: '示例数据', tone: 'is-off' };
        if (inst.broken) return { label: '无法识别', tone: 'is-bad' };
        if (inst.mismatch) return { label: '设置不隔离', tone: 'is-warn' };
        if (inst.isolatedByPolicy) {
            return inst.isolated ? { label: '已隔离', tone: 'is-on' } : { label: '待隔离', tone: 'is-pending' };
        }
        return inst.isolated ? { label: '自定义隔离', tone: 'is-custom' } : { label: '共享目录', tone: 'is-off' };
    }

    /** 没有版本可展示时给一句能照做的提示。 */
    function emptyHint() {
        if (SL.state.scanState.error) return '读取游戏目录失败：' + SL.state.scanState.error;
        if (!SL.state.scanState.loaded) return '在启动器里运行才能读取 .minecraft/versions。';
        const dir = SL.state.scanState.gameDir ? SL.state.scanState.gameDir + '\\versions' : '.minecraft\\versions';
        return '把版本文件夹（含同名 .json）放进 ' + dir + '，再点「重新扫描」；也可以在左侧添加别的 .minecraft。';
    }

    /** 一个版本都没有时，把详情面板和主页的「当前实例」清空，别留上一次的假数据。 */
    function clearDetail() {
        const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

        const hero = $('#detailHero');
        if (hero) hero.dataset.tone = 'plain';

        setText('#vHeroMc', 'MINECRAFT —');
        setText('#vHeroName', '未选择实例');
        setText('#vPath', SL.state.scanState.gameDir || '—');
        setText('#vMc', '—');
        setText('#vLoader', '—');
        setText('#vMods', '—');
        setText('#vJava', '—');
        setText('#vLast', '—');
        setText('#vModsCount', '—');
        setText('#vGameDir', '—');
        setText('#vFolder', '—');
        setText('#vSize', '—');
        setText('#vType', '—');

        const isoEl = $('#vIsolation');
        if (isoEl) {
            const state = isolationState(EMPTY_INSTANCE);
            isoEl.textContent = state.label;
            isoEl.className = 'iso-chip ' + state.tone;
            isoEl.title = '';
        }

        const chips = $('#vModChips');
        if (chips) chips.innerHTML = '<span class="is-empty">' + escapeHtml(emptyHint()) + '</span>';

        // 主页「当前实例」
        setText('#curInstName', '未选择实例');
        setText('#curInstMeta', '选择一个版本后在这里启动');
        const tile = $('#curInstTile');
        if (tile) tile.className = 'inst-tile tile--plain';
        const count = $('#instCount');
        if (count) count.textContent = '0 个';
        const memText = $('#curMemText');
        if (memText) memText.textContent = (Number(launchPrefs.mem) || 8) + ' / 32 GB';
    }

    function isolationLabel() {
        const labels = { all: '隔离所有版本', modded: '只隔离带模组的版本', none: '不隔离' };
        return labels[launchPrefs.isolation] || labels.all;
    }

    /** 把扫描结果画到设置页 / 版本页的固定文本上。 */
    function applyScanState() {
        const folders = SL.state.folders || [];

        const pathEl = $('#gameDirPath');
        if (pathEl) {
            pathEl.textContent = folders.length
                ? (SL.state.scanState.gameDir || folders[0].path)
                : (SL.state.scanState.loaded ? '未找到游戏文件夹' : '仅宿主可用');
        }

        const badge = $('#gameDirBadge');
        if (badge) {
            badge.textContent = folders.length ? folders.length + ' 个' : '—';
            badge.className = 'iso-chip ' + (folders.length > 1 ? 'is-custom' : 'is-on');
        }

        const summary = $('#instSummary');
        if (summary) {
            if (SL.state.scanState.error) {
                summary.textContent = '扫描失败：' + SL.state.scanState.error;
            } else if (!SL.state.scanState.loaded) {
                summary.textContent = '浏览器预览 · 示例数据';
            } else {
                const counts = SL.state.scanState.counts || {};
                const folderText = folders.length > 1 ? folders.length + ' 个文件夹 · ' : '';
                summary.textContent = (counts.total || 0) === 0
                    ? '还没有扫描到版本'
                    : folderText + (counts.total || 0) + ' 个版本 · ' +
                        (counts.modded || 0) + ' 个带模组 · ' +
                        (counts.isolated || 0) + ' 个已隔离' +
                        (counts.mismatch ? ' · ' + counts.mismatch + ' 个需要留意' : '');
            }
        }

        const isolation = $('#isoSummary');
        if (isolation) {
            isolation.textContent = '新文件夹默认：' + isolationLabel() +
                (SL.state.scanState.loaded && SL.state.scanState.counts
                    ? '（已登记 ' + folders.length + ' 个文件夹）'
                    : '');
        }
    }

    /**
     * 从宿主读真实版本列表。宿主不存在（浏览器预览）时保留 mock 数据。
     * 合并列表 + 文件夹摘要一次拿回来，左侧文件夹栏和右侧列表由同一份数据驱动。
     * @param {{force?: boolean}} [options]
     */
    async function loadInstances(options) {
        const opts = options || {};

        if (!hasHost() && !opts.force) {
            SL.state.folders = [];
            SL.state.scanState = { ok: false, loaded: false, gameDir: '', custom: false, counts: null, error: '' };
            applyScanState();
            SL.core.mod('folders').renderFolderList();
            return false;
        }

        try {
            const response = await fetch('/api/versions', { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);

            const data = await response.json();
            const list = Array.isArray(data.versions) ? data.versions : [];
            const folders = Array.isArray(data.folders) ? data.folders : [];

            SL.state.instances = list.map(toInstance);
            SL.state.folders = folders;
            SL.state.scanState = {
                ok: data.ok !== false && !data.error,
                loaded: true,
                gameDir: data.gameDir || '',
                custom: Boolean(data.custom),
                counts: data.counts || null,
                error: data.error || ''
            };

            // 之前选中的文件夹可能已经被移除
            if (ui.folderFilter && ui.folderFilter !== 'all' &&
                !folders.some((item) => item.id === ui.folderFilter)) {
                ui.folderFilter = 'all';
                writeStore(STORE.uiPrefs, ui);
            }

            const pool = ui.folderFilter === 'all'
                ? SL.state.instances
                : SL.state.instances.filter((item) => item.dirId === ui.folderFilter);

            // 之前选中的版本可能已经被删掉 / 不在当前文件夹里
            if (!pool.some((item) => item.id === ui.activeId)) {
                ui.activeId = pool.length ? pool[0].id : '';
                writeStore(STORE.uiPrefs, ui);
            }

            applyScanState();
            renderInstanceList();
            SL.core.mod('folders').renderFolderList();
            renderInstanceOptions();
            if (ui.activeId) selectInstance(ui.activeId);
            else clearDetail();
            return true;
        } catch (err) {
            SL.state.folders = [];
            SL.state.scanState = {
                ok: false,
                loaded: true,
                gameDir: '',
                custom: false,
                counts: null,
                error: (err && err.message) ? err.message : '扫描失败'
            };
            applyScanState();
            SL.core.mod('folders').renderFolderList();
            return false;
        }
    }


    /* 事件绑定 */
    function bindVersionList() {
        /* 版本列表：事件委托，列表是动态渲染的 */
        const instList = $('#instList');
        if (instList) {
            instList.addEventListener('click', (event) => {
                if (event.target.closest('[data-toast]')) return;
                const row = event.target.closest('[data-instance-row]');
                if (row) selectInstance(row.dataset.instanceRow);
            });
            instList.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const row = event.target.closest('[data-instance-row]');
                if (!row) return;
                event.preventDefault();
                selectInstance(row.dataset.instanceRow);
            });
    }

    const instSearch = $('#instSearch');
    if (instSearch) instSearch.addEventListener('input', filterInstances);
    $$('[data-inst-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            ui.instFilter = btn.dataset.instFilter;
            writeStore(STORE.uiPrefs, ui);
            $$('[data-inst-filter]').forEach((item) => {
                const active = item === btn;
                item.classList.toggle('is-active', active);
                item.setAttribute('aria-pressed', String(active));
            });
            filterInstances();
        });
    });

    }

    /* 事件绑定 */
    function bindGameDir() {
        /* 设置页：添加文件夹 / 跳到版本管理去管理 */
        const pickGameDir = $('#gameDirPick');
        if (pickGameDir) {
            pickGameDir.addEventListener('click', () => {
                if (!hasHost()) {
                    toast('浏览器预览里加不了文件夹，跑在启动器里才有这个能力', 'i-folder');
                    return;
                }
                hostPost({ type: 'add-game-dirs', isolation: launchPrefs.isolation || 'all' });
            });
        }

        const manageGameDir = $('#gameDirManage');
        if (manageGameDir) {
            manageGameDir.addEventListener('click', () => SL.core.mod('router').go('versions'));
        }

        const rescanBtn = $('#rescanBtn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', async () => {
                const ok = await loadInstances({ force: true });
                toast(ok
                    ? '已重新扫描，共 ' + SL.state.instances.length + ' 个版本'
                    : '扫描失败：' + (SL.state.scanState.error || '未知错误'), ok ? 'i-refresh' : 'i-info');
            });
        }
        const openInstDir = $('#openInstDir');
        if (openInstDir) {
            openInstDir.addEventListener('click', () => {
                const inst = activeInstance();
                if (!inst.path) {
                    toast('这个版本还没有目录可以打开', 'i-info');
                    return;
                }
                openLocation('open-instance-dir', { path: inst.path }, '版本文件夹');
            });
        }
        $$('[data-host-action="open-game-dir"]').forEach((btn) => {
            btn.addEventListener('click', () => openLocation('open-game-dir', null, '游戏文件夹'));
        });

    }

    SL.versions = Object.assign(SL.versions || {}, { renderInstanceList, selectInstance, filterInstances, LOADER_TONE, TONE_CYCLE, toneFor, formatSize, formatLastPlayed, toInstance, instanceMem, isolationState, emptyHint, clearDetail, isolationLabel, applyScanState, loadInstances, bindVersionList, bindGameDir });
})(window);
