/* =====================================================================
   StarLaunch · 下载中心
   ---------------------------------------------------------------------
   原版版本浏览、Catalog 搜索、下载队列。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, escapeHtml, writeStore } = SL.core;
    const { ui } = SL.state;
    const { CATALOG, CATALOG_META, CATALOG_PAGE_SIZE, LATEST_VERSION_IDS, MODPACKS, MODS, QUEUE_SEED, RESOURCES, SHADERS, VERSIONS, VERSION_GROUPS } = SL.data;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);

    const downloadState = new Map();
    const queue = QUEUE_SEED.slice();
    const versionOpen = new Set(['release']);
    const versionTotal = VERSIONS.length;
    const catalogState = {
        mod: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        modpack: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        resource: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        shader: { name: '', source: 'all', version: '', type: 'all', page: 1 }
    };
    let catalogPageCount = 1;

    /* -----------------------------------------------------------------
       下载
       ----------------------------------------------------------------- */
    function findDownloadItem(id) {
        return VERSIONS.find((entry) => entry.id === id) ||
            MODS.find((entry) => entry.id === id) ||
            MODPACKS.find((entry) => entry.id === id) ||
            RESOURCES.find((entry) => entry.id === id) ||
            SHADERS.find((entry) => entry.id === id);
    }

    function downloadStateLabel(cat, state) {
        if (state === 'done') return (cat === 'resource' || cat === 'shader') ? '已下载' : '已安装';
        if (state === 'running') return (cat === 'resource' || cat === 'shader') ? '下载中' : '安装中';
        if (state === 'queued') return '队列中';
        if (cat === 'version') return '安装';
        return (CATALOG_META[cat] && CATALOG_META[cat].action) || '安装';
    }

    function renderDownloads() {
        const cat = ui.dlCat;
        const isVersion = cat === 'version';
        const isCatalog = Boolean(CATALOG_META[cat]);

        const searchField = $('#dlSearchField');
        if (searchField) searchField.hidden = isCatalog;
        const searchInput = $('#dlSearch');
        if (searchInput) searchInput.placeholder = '搜索版本号';

        const versions = $('#dlVersions');
        if (versions) versions.hidden = !isVersion;
        const catalogSearch = $('#catalogSearch');
        if (catalogSearch) catalogSearch.hidden = !isCatalog;
        const catalogList = $('#catalogList');
        if (catalogList) catalogList.hidden = !isCatalog;
        const empty = $('#catalogEmpty');
        if (empty) empty.hidden = true;
        const pager = $('#catalogPager');
        if (pager) pager.hidden = true;

        if (isVersion) {
            renderVersionBrowser();
            return;
        }
        if (isCatalog) renderCatalog();
    }

    function versionRow(v, isLatest) {
        const state = downloadState.get(v.id) || 'idle';
        const disabled = state === 'idle' ? '' : ' disabled';
        const label = downloadStateLabel('version', state);
        const tone = v.tone || { release: 'a', snapshot: 'b', old: 'c', april: 'd' }[v.group] || 'a';
        const meta = isLatest
            ? (v.group === 'release' ? '最新正式版' : '最新预览版') + '，发布于 ' + v.date
            : '发布于 ' + v.date;
        return '<button class="version-row" type="button" data-download="' + v.id + '"' + disabled + '>' +
            '<span class="version-ico tone-' + tone + '" aria-hidden="true"><svg class="icon"><use href="#i-cube"/></svg></span>' +
            '<span class="version-main"><b class="num">' + escapeHtml(v.version) + '</b><small>' + escapeHtml(meta) + '</small></span>' +
            (!isLatest && v.tag ? '<span class="version-tag">' + escapeHtml(v.tag) + '</span>' : '') +
            '<span class="version-size num">' + escapeHtml(v.size) + '</span>' +
            '<span class="version-action' + (state !== 'idle' ? ' is-' + state : '') + '">' + label + '</span>' +
        '</button>';
    }

    function renderVersionBrowser() {
        const query = (($('#dlSearch') && $('#dlSearch').value) || '').trim().toLowerCase();

        const latestHost = $('#dlLatestList');
        if (latestHost) {
            latestHost.innerHTML = LATEST_VERSION_IDS
                .map((id) => VERSIONS.find((v) => v.id === id))
                .filter(Boolean)
                .map((v) => versionRow(v, true))
                .join('');
        }

        let total = 0;
        const groupsHost = $('#dlVersionGroups');
        if (groupsHost) {
            groupsHost.innerHTML = VERSION_GROUPS.map((group) => {
                const items = group.items.filter((v) => !query || v.version.toLowerCase().indexOf(query) !== -1);
                if (!items.length) return '';
                total += items.length;
                const open = query ? true : versionOpen.has(group.key);
                return '<section class="version-group' + (open ? '' : ' is-collapsed') + '" data-vgroup="' + group.key + '">' +
                    '<button class="version-group-head" type="button" aria-expanded="' + open + '">' +
                        '<span class="vg-label">' + escapeHtml(group.label) + '</span>' +
                        '<span class="vg-note">' + escapeHtml(group.note) + '</span>' +
                        '<span class="vg-count">' + items.length + ' 个版本</span>' +
                        '<svg class="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
                    '</button>' +
                    '<div class="version-group-body">' +
                        items.map((v) => versionRow(v, false)).join('') +
                    '</div>' +
                '</section>';
            }).join('');
        }

        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + (query ? total : versionTotal) + ' 个版本';

        const latestPanel = $('.dl-latest');
        if (latestPanel) latestPanel.hidden = Boolean(query);
    }

    function catalogSupportsVersion(item, query) {
        const value = String(query || '').trim();
        if (!value) return true;
        const versions = item.versions || '';
        if (versions.indexOf(value) !== -1) return true;
        // 只有带 + 的范围才按“最低版本”比较，精确版本不接受更高的小版本
        if (versions.indexOf('+') === -1) return false;
        const min = (versions.match(/\d+(\.\d+)?/) || [])[0];
        const target = parseFloat(value);
        return min !== undefined && !Number.isNaN(target) && target >= parseFloat(min);
    }

    function catalogTypes(item) {
        if (item.types) return item.types;
        if (item.loaders) return item.loaders;
        return item.cat ? [item.cat] : [];
    }

    function catalogMatches(item, filter) {
        const query = (filter.name || '').trim().toLowerCase();
        if (query) {
            const haystack = [item.name, item.en || '', item.cat || '', item.desc || ''].join(' ').toLowerCase();
            if (haystack.indexOf(query) === -1) return false;
        }
        if (filter.source && filter.source !== 'all' && item.source !== filter.source) return false;
        if (filter.type && filter.type !== 'all' && catalogTypes(item).indexOf(filter.type) === -1) return false;
        return catalogSupportsVersion(item, filter.version);
    }

    function catalogRow(item, cat) {
        const state = downloadState.get(item.id) || 'idle';
        const disabled = state === 'idle' ? '' : ' disabled';
        const label = downloadStateLabel(cat, state);
        const progress = state === 'running' ? '<span class="dl-progress"><i></i></span>' : '';
        const meta = item.meta || ((item.loaders ? item.loaders.join(' / ') + ' · ' : '') + (item.versions || ''));
        return '<article class="mod-row' + (state !== 'idle' ? ' is-' + state : '') + '">' +
            '<span class="mod-row-tile tone-' + (item.tone || 'a') + '" aria-hidden="true">' + escapeHtml(item.tile) + '</span>' +
            '<div class="mod-row-main">' +
                '<div class="mod-row-title">' +
                    '<b>' + escapeHtml(item.name) + '</b>' +
                    (item.en ? '<span class="mod-en">' + escapeHtml(item.en) + '</span>' : '') +
                    '<span class="mod-cat">' + escapeHtml(item.cat) + '</span>' +
                '</div>' +
                '<div class="mod-row-desc">' + escapeHtml(item.desc) + '</div>' +
                '<div class="mod-row-meta">' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-layers"/></svg>' + escapeHtml(meta) + '</span>' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>' + escapeHtml(item.downloads) + '</span>' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>' + escapeHtml(item.updated) + '</span>' +
                    '<span class="mod-source"><svg class="icon" aria-hidden="true"><use href="#i-cloud"/></svg>' + escapeHtml(item.source) + '</span>' +
                '</div>' +
                progress +
            '</div>' +
            '<div class="mod-row-side">' +
                '<button class="btn btn-tonal btn-sm" type="button" data-download="' + item.id + '"' + disabled + '>' + label + '</button>' +
            '</div>' +
        '</article>';
    }

    function syncCatalogForm() {
        const cat = ui.dlCat;
        const meta = CATALOG_META[cat];
        if (!meta) return;
        const state = catalogState[cat];

        const title = $('#catalogTitle');
        if (title) title.textContent = meta.title;
        const name = $('#catalogName');
        if (name) {
            name.placeholder = meta.placeholder;
            name.value = state.name || '';
        }
        const source = $('#catalogSource');
        if (source) source.value = state.source || 'all';
        const version = $('#catalogVersion');
        if (version) version.value = state.version || '';
        const type = $('#catalogType');
        if (type) {
            type.innerHTML = meta.types
                .map(([value, label]) => '<option value="' + value + '">' + escapeHtml(label) + '</option>')
                .join('');
            type.value = state.type || 'all';
        }
    }

    function pagerHtml(totalPages, current) {
        const pages = [];
        for (let p = 1; p <= totalPages; p += 1) {
            pages.push('<button class="pager-page' + (p === current ? ' is-active' : '') + '" type="button" data-page="' + p + '"' +
                (p === current ? ' aria-current="page"' : '') + '>' + p + '</button>');
        }
        return '<button class="pager-btn" type="button" data-page="prev"' + (current <= 1 ? ' disabled' : '') + '>上一页</button>' +
            '<span class="pager-pages">' + pages.join('') + '</span>' +
            '<button class="pager-btn" type="button" data-page="next"' + (current >= totalPages ? ' disabled' : '') + '>下一页</button>';
    }

    function renderCatalog() {
        const cat = ui.dlCat;
        const meta = CATALOG_META[cat];
        if (!meta) return;
        const state = catalogState[cat];
        const items = (CATALOG[cat] || []).filter((item) => catalogMatches(item, state));
        const totalPages = Math.max(1, Math.ceil(items.length / CATALOG_PAGE_SIZE));
        state.page = Math.min(Math.max(1, state.page), totalPages);
        catalogPageCount = totalPages;

        const start = (state.page - 1) * CATALOG_PAGE_SIZE;
        const pageItems = items.slice(start, start + CATALOG_PAGE_SIZE);

        const host = $('#catalogList');
        if (host) host.innerHTML = pageItems.map((item) => catalogRow(item, cat)).join('');

        const empty = $('#catalogEmpty');
        if (empty) empty.hidden = items.length > 0;

        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + items.length + ' 个 ' + meta.noun;

        const pager = $('#catalogPager');
        if (pager) {
            if (items.length > CATALOG_PAGE_SIZE) {
                pager.hidden = false;
                pager.innerHTML = pagerHtml(totalPages, state.page);
            } else {
                pager.hidden = true;
                pager.innerHTML = '';
            }
        }
    }

    function applyCatalogFilter() {
        const cat = ui.dlCat;
        const state = catalogState[cat];
        if (!state) return;
        state.name = ($('#catalogName') && $('#catalogName').value) || '';
        state.source = ($('#catalogSource') && $('#catalogSource').value) || 'all';
        state.version = ($('#catalogVersion') && $('#catalogVersion').value) || '';
        state.type = ($('#catalogType') && $('#catalogType').value) || 'all';
        state.page = 1;
        renderCatalog();
    }

    function resetCatalogFilter() {
        const cat = ui.dlCat;
        const state = catalogState[cat];
        if (!state) return;
        state.name = '';
        state.source = 'all';
        state.version = '';
        state.type = 'all';
        state.page = 1;
        syncCatalogForm();
        renderCatalog();
        toast('搜索条件已重置', 'i-refresh');
    }

    function renderQueue() {
        const host = $('#dlQueue');
        if (!host) return;
        host.innerHTML = queue.map((item) => {
            const value = item.progress;
            const pctText = item.state === 'queued' ? '等待中' : value + '%';
            return '<div class="queue-item">' +
                '<div class="queue-top"><b>' + escapeHtml(item.name) + '</b><span class="num">' + pctText + '</span></div>' +
                '<div class="queue-bar"><i style="width:' + (item.state === 'queued' ? 0 : value) + '%"></i></div>' +
                '<div class="queue-meta"><span>' + escapeHtml(item.phase) + '</span><span>' + escapeHtml(item.eta) + '</span></div>' +
            '</div>';
        }).join('');
        const count = $('#queueCount');
        if (count) count.textContent = queue.length + ' 项';
    }

    function startDownload(id) {
        const item = findDownloadItem(id);
        if (!item) return;
        const state = downloadState.get(id);
        if (state === 'queued' || state === 'running') return;
        if (state === 'done') downloadState.delete(id);

        downloadState.set(id, 'queued');
        renderDownloads();
        toast('已加入安装队列：' + item.name, 'i-download');

        queue.push({ id: 'q-' + id, name: item.name, phase: '排队中 · 0 B/s', eta: '—', progress: 0, state: 'queued' });
        renderQueue();

        window.setTimeout(() => {
            if (downloadState.get(id) !== 'queued') return;
            downloadState.set(id, 'running');
            renderDownloads();
            const entry = queue.find((q) => q.id === 'q-' + id);
            if (entry) { entry.state = 'running'; entry.phase = 'assets · 11.8 MB/s'; entry.eta = '约 1 分钟'; entry.progress = 34; renderQueue(); }
        }, 520);
        window.setTimeout(() => {
            if (downloadState.get(id) !== 'running') return;
            downloadState.set(id, 'done');
            renderDownloads();
            const entry = queue.find((q) => q.id === 'q-' + id);
            if (entry) { entry.progress = 100; entry.phase = '下载完成 · 正在解压'; entry.eta = '已完成'; renderQueue(); }
            toast('安装完成：' + item.name, 'i-check');
        }, 2400);
    }

    function setDownloadCategory(category) {
        ui.dlCat = category;
        writeStore(STORE.uiPrefs, ui);
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === category;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        if (CATALOG_META[category]) syncCatalogForm();
        renderDownloads();
    }

    function selectSource(name) {
        ui.source = name;
        writeStore(STORE.uiPrefs, ui);
        $$('.source').forEach((btn) => {
            const active = btn.dataset.source === name;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('[data-dl-source]').forEach((btn) => {
            const active = btn.dataset.dlSource === name;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
    }


    /* 事件绑定 */
    function bindDownload() {
        /* 下载 */
        $$('[data-dl-tab]').forEach((btn) => btn.addEventListener('click', () => setDownloadCategory(btn.dataset.dlTab)));
        const dlSearch = $('#dlSearch');
        if (dlSearch) dlSearch.addEventListener('input', renderDownloads);

        /* 版本分组折叠 */
        const versionGroups = $('#dlVersionGroups');
        if (versionGroups) {
            versionGroups.addEventListener('click', (event) => {
                const head = event.target.closest('.version-group-head');
                if (!head) return;
                const group = head.closest('.version-group');
                if (!group) return;
                const collapsed = group.classList.toggle('is-collapsed');
                head.setAttribute('aria-expanded', String(!collapsed));
                const key = group.dataset.vgroup;
                if (collapsed) versionOpen.delete(key);
                else versionOpen.add(key);
            });
    }

    /* 社区资源搜索 */
    const catalogSearchBtn = $('#catalogSearchBtn');
    if (catalogSearchBtn) catalogSearchBtn.addEventListener('click', applyCatalogFilter);
    const catalogResetBtn = $('#catalogResetBtn');
    if (catalogResetBtn) catalogResetBtn.addEventListener('click', resetCatalogFilter);
    ['#catalogName', '#catalogVersion'].forEach((sel) => {
        const input = $(sel);
        if (!input) return;
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            applyCatalogFilter();
        });
    });

    const catalogPager = $('#catalogPager');
    if (catalogPager) {
        catalogPager.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-page]');
            if (!btn) return;
            const state = catalogState[ui.dlCat];
            if (!state) return;
            const value = btn.dataset.page;
            if (value === 'prev') state.page = Math.max(1, state.page - 1);
            else if (value === 'next') state.page = Math.min(catalogPageCount, state.page + 1);
            else state.page = Number(value) || 1;
            renderCatalog();
        });
    }

    $$('.source').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.source)));
    $$('[data-dl-source]').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.dlSource)));

    }

    SL.download = Object.assign(SL.download || {}, { downloadState, queue, versionOpen, catalogState, findDownloadItem, downloadStateLabel, renderDownloads, versionRow, renderVersionBrowser, catalogSupportsVersion, catalogTypes, catalogMatches, catalogRow, syncCatalogForm, pagerHtml, renderCatalog, applyCatalogFilter, resetCatalogFilter, renderQueue, startDownload, setDownloadCategory, selectSource, bindDownload });
})(window);
