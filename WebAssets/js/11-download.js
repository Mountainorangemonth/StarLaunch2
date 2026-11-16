/* =====================================================================
   StarLaunch · 下载中心
   ---------------------------------------------------------------------
   三块内容：
     · 原版游戏：/api/download/versions 拿 Mojang 版本清单，分组浏览；
     · 社区资源：Modrinth 搜索 → 项目详情（选游戏版本 / 加载器 / 实例）→ 下载；
     · 安装队列：宿主下载器推上来的进度（download-state / download-finished）。

   所有「安装」按钮都是 data-download="<key>"，真正的动作存在 state.actions 里，
   点击由 15-events.js 的全局委托转发到 startDownload(key)。

   浏览器预览（没有宿主）时退回 01-data.js 里的示例数据，界面不至于空着，
   但点安装只会提示「只有启动器里才能下载」。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, escapeHtml } = SL.core;
    const { ui } = SL.state;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const hostMod = SL.core.mod('host');
    const hasHost = () => (typeof hostMod.hasHost === 'function' ? hostMod.hasHost() : false);
    const hostPost = (message) => (typeof hostMod.hostPost === 'function' ? hostMod.hostPost(message) : false);

    const DATA = SL.data || {};
    const PAGE_SIZE = 9;

    /* tab（version / mod / modpack / resource / shader）→ 接口用的类型 */
    const KIND_OF_TAB = { mod: 'mod', modpack: 'modpack', resource: 'resourcepack', shader: 'shader' };

    const KIND_META = {
        mod: {
            noun: 'Mod', title: '搜索 Mod', placeholder: '中文名 / 英文名 / 关键词',
            loaders: [['all', '全部加载器'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt']],
            folder: 'mods'
        },
        modpack: {
            noun: '整合包', title: '搜索整合包', placeholder: '整合包名字 / 关键词',
            loaders: [['all', '全部加载器'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt']],
            folder: ''
        },
        resource: {
            noun: '资源包', title: '搜索资源包', placeholder: '资源包名字 / 关键词',
            loaders: [['all', '全部分辨率'], ['8x', '8x'], ['16x', '16x'], ['32x', '32x'], ['64x', '64x'], ['128x', '128x'], ['256x', '256x'], ['512x', '512x']],
            folder: 'resourcepacks'
        },
        shader: {
            noun: '光影包', title: '搜索光影', placeholder: '光影名字 / 关键词',
            loaders: [['all', '全部类型'], ['iris', 'Iris'], ['optifine', 'OptiFine'], ['vanilla', 'Vanilla'], ['canvas', 'Canvas']],
            folder: 'shaderpacks'
        }
    };

    const state = {
        manifest: { loaded: false, loading: false, latest: {}, versions: [], error: '', source: '' },
        source: 'bmclapi',
        /* 社区资源（Mod / 整合包 / 资源包 / 光影）的取件地址，和原版文件分开 */
        modrinthSource: 'auto',
        modrinthFallback: false,
        jobs: [],
        history: [],
        openGroups: new Set(['release', 'snapshot']),
        search: {
            mod: { name: '', game: '', loader: 'all', sort: 'relevance', page: 1 },
            modpack: { name: '', game: '', loader: 'all', sort: 'relevance', page: 1 },
            resource: { name: '', game: '', loader: 'all', sort: 'relevance', page: 1 },
            shader: { name: '', game: '', loader: 'all', sort: 'relevance', page: 1 }
        },
        catalog: { loading: false, loaded: false, hits: [], total: 0, page: 1, pageCount: 1, error: '', kind: 'mod' },
        detail: {
            open: false, loading: false, kind: 'mod', project: null, versions: [],
            game: '', loader: 'all', instanceId: '', error: '', installed: []
        },
        actions: new Map(),
        actionSeq: 0,
        installer: {
            open: false, mc: '', loading: false, error: '',
            loaders: [], choice: 'vanilla', version: '', installed: {},
            /* 实例名称：nameTouched 为真之后就完全听用户的，不再跟着加载器改 */
            name: '', nameTouched: false
        }
    };

    /* -----------------------------------------------------------------
       小工具
       ----------------------------------------------------------------- */
    function currentTab() {
        return ui.dlCat === 'version' ? 'version' : (KIND_OF_TAB[ui.dlCat] ? ui.dlCat : 'mod');
    }

    function currentKind() {
        return KIND_OF_TAB[currentTab()] || 'mod';
    }

    /**
     * 登记一个「点了要做什么」。key 是稳定的（同一个版本 / 文件每次渲染都一样），
     * 这样重画列表不会让 Map 越堆越大；内容直接覆盖，后渲染的条件最新。
     */
    function registerAction(key, action) {
        const id = key || ('a' + (state.actionSeq += 1));
        state.actions.set(id, action);
        return id;
    }

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        const pad = (n) => String(n).padStart(2, '0');
        return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
    }

    function formatCount(value) {
        const number = Number(value) || 0;
        if (number >= 1e8) return (number / 1e8).toFixed(1) + ' 亿';
        if (number >= 1e4) return (number / 1e4).toFixed(1) + ' 万';
        return String(number);
    }

    function formatSize(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
        if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
        if (value >= 1024) return Math.round(value / 1024) + ' KB';
        return value + ' B';
    }

    function formatSpeed(bytes) {
        const value = Number(bytes) || 0;
        if (value <= 0) return '';
        if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB/s';
        if (value >= 1024) return Math.round(value / 1024) + ' KB/s';
        return value + ' B/s';
    }

    function installedVersions() {
        const set = new Set();
        (SL.state.instances || []).forEach((inst) => {
            if (inst && inst.mc) set.add(String(inst.mc));
        });
        return set;
    }

    function instanceOptions() {
        return (SL.state.instances || []).filter((inst) => inst && inst.gameDir);
    }

    /** 版本任务的状态签名：只有它变了才需要重画版本列表（900 多个版本，别按帧重画）。 */
    let lastVersionSignature = '';
    let lastVersionRender = 0;

    function versionSignature() {
        return (state.jobs || [])
            .filter((job) => job.kind === 'version')
            .map((job) => job.name + ':' + job.status + ':' + Math.round(Number(job.progress) || 0))
            .join('|');
    }

    function jobForVersion(versionId) {
        // 装了加载器时任务名是「Minecraft 1.20.1 + Fabric」，也要能对上
        const name = 'Minecraft ' + versionId;
        return state.jobs.find((job) => job.kind === 'version' &&
            (job.name === name || String(job.name || '').indexOf(name + ' + ') === 0)) || null;
    }

    /* -----------------------------------------------------------------
       原版游戏
       ----------------------------------------------------------------- */
    function loadManifest(force) {
        if (state.manifest.loading) return Promise.resolve();
        if (state.manifest.loaded && !force) return Promise.resolve();
        if (!hasHost()) {
            // 浏览器预览：用示例数据凑出清单的形状
            const versions = (DATA.VERSIONS || []).map((item) => ({
                id: item.version, type: item.group === 'release' ? 'release' : (item.group === 'old' ? 'old_beta' : 'snapshot'),
                releaseTime: item.date
            }));
            state.manifest = {
                loaded: true, loading: false, error: '',
                latest: { release: (DATA.VERSIONS || [])[0] ? DATA.VERSIONS[0].version : '', snapshot: '' },
                versions, source: 'preview'
            };
            return Promise.resolve();
        }

        state.manifest.loading = true;
        renderVersions();
        return fetch('/api/download/versions')
            .then((response) => response.json())
            .then((payload) => {
                if (!payload || payload.ok === false) throw new Error((payload && payload.error) || '读取失败');
                state.manifest = {
                    loaded: true, loading: false, error: '',
                    latest: payload.latest || {},
                    versions: Array.isArray(payload.versions) ? payload.versions : [],
                    source: payload.source || 'bmclapi'
                };
                state.source = payload.source || state.source;
                renderSource();
                renderVersions();
            })
            .catch((err) => {
                state.manifest.loading = false;
                state.manifest.error = err && err.message ? err.message : '读取版本清单失败';
                renderVersions();
            });
    }

    /* -----------------------------------------------------------------
       版本分类（和 PCL 的 PageDownloadInstall 一套规则）
       -----------------------------------------------------------------
       Mojang 的清单里只有 release / snapshot / old_*，愚人节版本混在 snapshot 里，
       所以要么认得它的 id，要么看它是不是 4 月 1 日发的。
       另外 Mojang 偶尔把 1.x 正式版标成 snapshot，这里顺手纠正。
       ----------------------------------------------------------------- */

    /** 已知的愚人节版本 id（小写）→ 当年那句宣传语。 */
    const FOOL_VERSIONS = {
        '2.0': '2013 | 这个秘密计划了两年的更新将游戏推向了一个新高度！',
        '15w14a': '2015 | 作为一款全年龄向的游戏，我们需要和平，需要爱与拥抱。',
        '1.rv-pre1': '2016 | 是时候将现代科技带入 Minecraft 了！',
        '3d shareware v1.34': '2019 | 我们从地下室的废墟里找到了这个开发于 1994 年的杰作！',
        '20w14infinite': '2020 | 我们加入了 20 亿个新的维度，让无限的想象变成了现实！',
        '20w14∞': '2020 | 我们加入了 20 亿个新的维度，让无限的想象变成了现实！',
        '22w13oneblockatatime': '2022 | 一次一个方块更新！迎接全新的挖掘、合成与骑乘玩法吧！',
        '23w13a_or_b': '2023 | 研究表明：玩家喜欢作出选择——越多越好！',
        '24w14potato': '2024 | 毒马铃薯一直都被大家忽视和低估，于是我们超级加强了它！',
        '25w14craftmine': '2025 | 你可以合成任何东西——包括合成你的世界！',
        '26w14a': '2026 | 为什么需要物品栏？让方块们跟着你走吧！'
    };

    /** 4 月 1 日（按 UTC+2 判，Mojang 的发布时间总在这个时区附近）。 */
    function isAprilFools(dateText) {
        const date = new Date(dateText);
        if (Number.isNaN(date.getTime())) return false;
        const shifted = new Date(date.getTime() + 2 * 3600 * 1000);
        return shifted.getUTCMonth() === 3 && shifted.getUTCDate() === 1;
    }

    /** 返回 'release' / 'snapshot' / 'old' / 'fool'。 */
    function classifyVersion(version) {
        const id = String(version.id || '').toLowerCase();
        const type = String(version.type || '');

        if (type === 'special') return 'fool';
        if (FOOL_VERSIONS[id]) return 'fool';

        if (type === 'release') return 'release';

        if (type === 'snapshot') {
            // Mojang 误分类：1.14.4 这种被标成 snapshot
            if (/^1\./.test(id) && !/combat|rc|experimental|pre/.test(id)) return 'release';
            if (isAprilFools(version.releaseTime)) return 'fool';
            return 'snapshot';
        }

        return 'old';
    }

    function versionGroups() {
        const groups = [
            { key: 'release', label: '正式版', note: '稳定版本，适合日常游玩', items: [] },
            { key: 'snapshot', label: '预览版', note: '新内容尝鲜，可能有 bug', items: [] },
            { key: 'old', label: '远古版本', note: 'Alpha / Beta 时代的老版本', items: [] },
            { key: 'fool', label: '愚人节版', note: '每年 4 月 1 日的整活版本', items: [] }
        ];
        const byKey = {};
        groups.forEach((group) => { byKey[group.key] = group; });

        state.manifest.versions.forEach((version) => {
            byKey[classifyVersion(version)].items.push(version);
        });
        return groups.filter((group) => group.items.length > 0);
    }

    function versionRow(version, isLatest) {
        const installed = installedVersions();
        const job = jobForVersion(version.id);
        const key = registerAction('v:' + version.id, { type: 'version', id: version.id, name: 'Minecraft ' + version.id });
        const kind = classifyVersion(version);

        let actionClass = '';
        let actionLabel = installed.has(version.id) ? '重新安装' : '安装';
        if (job) {
            actionClass = ' is-' + job.status;
            actionLabel = job.status === 'running' ? Math.round(job.progress) + '%'
                : (job.status === 'failed' ? '重试'
                    : (job.status === 'done' ? '已安装'
                        : (job.status === 'paused' ? '已暂停' : '排队中')));
        }

        const meta = kind === 'fool'
            ? (FOOL_VERSIONS[String(version.id).toLowerCase()] || '愚人节版本') + ' · ' + formatDate(version.releaseTime)
            : (isLatest
                ? (kind === 'release' ? '最新正式版' : '最新预览版') + ' · 发布于 ' + formatDate(version.releaseTime)
                : '发布于 ' + formatDate(version.releaseTime));

        const tone = kind === 'release' ? 'a' : (kind === 'snapshot' ? 'b' : (kind === 'fool' ? 'd' : 'c'));

        return '<button class="version-row" type="button" data-download="' + key + '">' +
            '<span class="version-ico tone-' + tone + '" aria-hidden="true"><svg class="icon"><use href="#i-cube"/></svg></span>' +
            '<span class="version-main"><b class="num">' + escapeHtml(version.id) + '</b><small>' + escapeHtml(meta) + '</small></span>' +
            (installed.has(version.id) ? '<span class="version-tag">已安装</span>' : '') +
            (kind === 'fool' ? '<span class="version-size">愚人节</span>' : (kind === 'snapshot' ? '<span class="version-size">预览</span>' : '')) +
            '<span class="version-action' + actionClass + '">' + escapeHtml(actionLabel) + '</span>' +
        '</button>';
    }

    function renderVersions() {
        const latestHost = $('#dlLatestList');
        const groupsHost = $('#dlVersionGroups');
        const empty = $('#dlVersionEmpty');
        const count = $('#dlCount');
        const note = $('#dlSourceNote');
        const query = (($('#dlSearch') && $('#dlSearch').value) || '').trim().toLowerCase();

        if (note) {
            note.textContent = state.manifest.loading
                ? '正在读取版本清单…'
                : (state.manifest.error
                    ? state.manifest.error
                    : '来源 ' + (state.source === 'official' ? 'Mojang 官方' : 'BMCLAPI 镜像') + ' · 自动补全运行库');
        }

        if (state.manifest.loading && !state.manifest.loaded) {
            if (latestHost) latestHost.innerHTML = '<div class="dl-loading"><i class="spin"></i>正在读取版本清单…</div>';
            if (groupsHost) groupsHost.innerHTML = '';
            if (count) count.textContent = '正在加载';
            if (empty) empty.hidden = true;
            return;
        }

        const versions = state.manifest.versions || [];
        const latest = state.manifest.latest || {};

        /* 最新版本：正式版 + 预览版各一行 */
        if (latestHost) {
            const picks = [];
            if (latest.release) picks.push(versions.find((item) => item.id === latest.release));
            if (latest.snapshot) picks.push(versions.find((item) => item.id === latest.snapshot));
            const html = picks.filter(Boolean).map((item) => versionRow(item, true)).join('');
            latestHost.innerHTML = html || '<div class="dl-loading">没有读到最新版本信息</div>';
        }

        /* 分组列表 */
        let total = 0;
        if (groupsHost) {
            groupsHost.innerHTML = versionGroups().map((group) => {
                const items = group.items.filter((item) => !query || item.id.toLowerCase().indexOf(query) !== -1);
                if (!items.length) return '';
                total += items.length;
                const open = query ? true : state.openGroups.has(group.key);
                return '<section class="version-group' + (open ? '' : ' is-collapsed') + '" data-vgroup="' + group.key + '">' +
                    '<button class="version-group-head" type="button" aria-expanded="' + open + '">' +
                        '<span class="vg-label">' + escapeHtml(group.label) + '</span>' +
                        '<span class="vg-note">' + escapeHtml(group.note) + '</span>' +
                        '<span class="vg-count">' + items.length + ' 个版本</span>' +
                        '<svg class="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
                    '</button>' +
                    '<div class="version-group-body">' +
                        items.map((item) => versionRow(item, false)).join('') +
                    '</div>' +
                '</section>';
            }).join('');
        }

        const latestPanel = $('.dl-latest');
        if (latestPanel) latestPanel.hidden = Boolean(query);

        if (count) count.textContent = versions.length ? '共 ' + (query ? total : versions.length) + ' 个版本' : '没有版本数据';
        if (empty) empty.hidden = !(versions.length > 0 && total === 0);
    }

    /* -----------------------------------------------------------------
       社区资源：搜索
       ----------------------------------------------------------------- */
    function syncCatalogForm() {
        // 原版游戏没有这排搜索条件：用 Mod 的文案把表单撑起来（隐藏状态下看不见）
        const tab = KIND_OF_TAB[currentTab()] ? currentTab() : 'mod';
        const meta = KIND_META[tab] || KIND_META.mod;
        const form = state.search[tab] || state.search.mod;

        const title = $('#catalogTitle');
        if (title) title.textContent = meta.title;
        const name = $('#catalogName');
        if (name) {
            name.placeholder = meta.placeholder;
            if (document.activeElement !== name) name.value = form.name || '';
        }
        const game = $('#catalogVersion');
        if (game && document.activeElement !== game) game.value = form.game || '';

        const type = $('#catalogType');
        if (type) {
            const wanted = meta.loaders.map(([value, label]) => '<option value="' + value + '">' + escapeHtml(label) + '</option>').join('');
            if (type.innerHTML.trim() !== wanted.trim()) {
                type.innerHTML = wanted;
            }
            type.value = form.loader || 'all';
        }

        const sort = $('#catalogSort');
        if (sort) sort.value = form.sort || 'relevance';

        /* 游戏版本候选：清单里的正式版 + 本机已有的版本 */
        const list = $('#catalogVersionOptions');
        if (list && state.manifest.versions.length) {
            const options = [];
            const seen = new Set();
            installedVersions().forEach((id) => {
                if (seen.has(id)) return;
                seen.add(id);
                options.push(id);
            });
            state.manifest.versions.forEach((version) => {
                if (version.type !== 'release' || seen.has(version.id)) return;
                seen.add(version.id);
                options.push(version.id);
            });
            list.innerHTML = options.slice(0, 60).map((id) => '<option value="' + escapeHtml(id) + '"></option>').join('');
        }
    }

    function mockHits(kind) {
        const catalog = (DATA.CATALOG && DATA.CATALOG[kind]) || [];
        return catalog.map((item) => ({
            id: item.id,
            slug: item.id,
            title: item.name,
            description: item.desc,
            author: item.source || 'Modrinth',
            icon: '',
            downloads: 0,
            follows: 0,
            categories: item.cat ? [item.cat] : [],
            versions: [],
            updated: '',
            type: kind,
            mock: true
        }));
    }

    function searchCatalog() {
        const tab = currentTab();
        const kind = KIND_OF_TAB[tab] || 'mod';
        const form = state.search[tab];
        const meta = KIND_META[tab] || KIND_META.mod;

        if (!hasHost()) {
            const hits = mockHits(kind).filter((hit) => {
                const query = (form.name || '').toLowerCase();
                if (query && (hit.title + ' ' + (hit.description || '')).toLowerCase().indexOf(query) === -1) return false;
                return true;
            });
            state.catalog = {
                loading: false, loaded: true, hits, total: hits.length, page: 1,
                pageCount: Math.max(1, Math.ceil(hits.length / PAGE_SIZE)), error: '', kind
            };
            renderCatalog();
            toast('浏览器预览里只显示示例数据，真实搜索要在启动器里用', 'i-info');
            return;
        }

        state.catalog.loading = true;
        state.catalog.error = '';
        state.catalog.kind = kind;
        renderCatalog();

        const params = new URLSearchParams({
            kind: kind,
            /* 中文关键词先补上英文 slug，Modrinth 只认英文标题 */
            query: expandSearchQuery(form.name),
            game: form.game || '',
            loader: form.loader === 'all' ? '' : form.loader,
            sort: form.sort || 'relevance',
            page: String(form.page || 1),
            limit: String(PAGE_SIZE)
        });

        fetch('/api/download/search?' + params.toString())
            .then((response) => response.json())
            .then((payload) => {
                if (!payload || payload.ok === false) throw new Error((payload && payload.error) || '搜索失败');
                const hits = Array.isArray(payload.hits) ? payload.hits : [];
                const total = Number(payload.total) || 0;
                state.catalog = {
                    loading: false, loaded: true, hits, total, page: Number(payload.page) || 1,
                    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), error: '', kind
                };
                renderCatalog();
            })
            .catch((err) => {
                state.catalog.loading = false;
                state.catalog.loaded = true;
                state.catalog.error = err && err.message ? err.message : '搜索失败';
                state.catalog.hits = [];
                renderCatalog();
                toast(state.catalog.error, 'i-info');
            });
    }

    /* -----------------------------------------------------------------
       中文名
       -----------------------------------------------------------------
       Modrinth 的标题只有英文，01-data.js 里有一份手写译名表。
       没收录的返回空串，调用方照原样显示英文。
       ----------------------------------------------------------------- */
    const ZH_NAMES = (DATA && DATA.MOD_NAMES_ZH) || {};

    function zhNameOf(item) {
        if (!item) return '';
        const keys = [item.slug, item.id].filter(Boolean).map((value) => String(value).toLowerCase());
        for (let i = 0; i < keys.length; i += 1) {
            if (ZH_NAMES[keys[i]]) return ZH_NAMES[keys[i]];
        }
        return '';
    }

    /** 搜中文时补上对应的英文 slug：Modrinth 只认英文，不补就搜不到东西。 */
    function expandSearchQuery(text) {
        const query = String(text || '').trim();
        if (!query || !/[一-龥]/.test(query)) return query;

        const extra = [];
        Object.keys(ZH_NAMES).forEach((slug) => {
            if (extra.length >= 3) return;
            const zh = ZH_NAMES[slug];
            if (!zh || zh.indexOf(query) === -1) return;
            const english = slug.replace(/-/g, ' ');
            if (extra.indexOf(english) === -1) extra.push(english);
        });

        return extra.length ? query + ' ' + extra.join(' ') : query;
    }

    function catalogRow(hit, kind) {
        const key = registerAction('p:' + kind + ':' + hit.id, { type: 'project', kind: kind, id: hit.id, name: hit.title });
        const icon = hit.icon
            ? '<span class="mod-row-tile has-icon"><img src="' + escapeHtml(hit.icon) + '" alt="" loading="lazy"></span>'
            : '<span class="mod-row-tile tone-a">' + escapeHtml((hit.title || '?').slice(0, 1).toUpperCase()) + '</span>';
        const categories = (hit.categories || []).slice(0, 3)
            .map((cat) => '<span class="mod-cat">' + escapeHtml(cat) + '</span>').join('');
        const meta = (hit.categories || []).join(' / ');
        const zh = zhNameOf(hit);

        return '<article class="mod-row" data-project="' + key + '">' +
            icon +
            '<div class="mod-row-main">' +
                '<div class="mod-row-title">' +
                    '<b>' + escapeHtml(zh || hit.title) + '</b>' +
                    (zh ? '<span class="mod-en">' + escapeHtml(hit.title) + '</span>' : '') +
                    categories +
                '</div>' +
                '<div class="mod-row-desc">' + escapeHtml(hit.description || '') + '</div>' +
                '<div class="mod-row-meta">' +
                    (meta ? '<span><svg class="icon" aria-hidden="true"><use href="#i-layers"/></svg>' + escapeHtml(meta) + '</span>' : '') +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>' + formatCount(hit.downloads) + '</span>' +
                    (hit.updated ? '<span><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>' + formatDate(hit.updated) + '</span>' : '') +
                    '<span class="mod-source"><svg class="icon" aria-hidden="true"><use href="#i-cloud"/></svg>Modrinth</span>' +
                '</div>' +
            '</div>' +
            '<div class="mod-row-side">' +
                '<button class="btn btn-tonal btn-sm" type="button" data-download="' + key + '">查看</button>' +
            '</div>' +
        '</article>';
    }

    /**
     * 页码只画「一窗」：首页、末页、当前页前后各 1 页，中间用省略号。
     * Modrinth 一个分类动辄几百页，把每页都画成按钮会把整条分页栏撑成几屏，
     * 也会让列表被推到看不见的地方（以前就是这样）。
     */
    function pagerHtml(totalPages, current) {
        const total = Math.max(1, Math.floor(totalPages) || 1);
        const active = Math.min(total, Math.max(1, Math.floor(current) || 1));
        const wanted = new Set([1, total]);
        for (let p = active - 1; p <= active + 1; p += 1) {
            if (p >= 1 && p <= total) wanted.add(p);
        }
        /* 当前页贴着两端时，多补一个内侧页，窗口看起来才是对称的 */
        if (active <= 2) wanted.add(3);
        if (active >= total - 1) wanted.add(total - 2);

        const nums = Array.from(wanted).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
        const items = [];
        let previous = 0;
        nums.forEach((p) => {
            if (previous && p - previous > 1) {
                items.push('<span class="pager-gap" aria-hidden="true">…</span>');
            }
            items.push('<button class="pager-page' + (p === active ? ' is-active' : '') + '" type="button" data-page="' + p + '"' +
                (p === active ? ' aria-current="page"' : '') + ' aria-label="第 ' + p + ' 页">' + p + '</button>');
            previous = p;
        });

        return '<button class="pager-btn" type="button" data-page="prev"' + (active <= 1 ? ' disabled' : '') + '>上一页</button>' +
            '<span class="pager-pages">' + items.join('') + '</span>' +
            '<span class="pager-total num" id="pagerTotal">' + active + ' / ' + total + '</span>' +
            '<button class="pager-btn" type="button" data-page="next"' + (active >= total ? ' disabled' : '') + '>下一页</button>' +
            '<label class="pager-jump">' +
                '<span>跳至</span>' +
                '<input class="pager-input" type="number" min="1" max="' + total + '" step="1" value="' + active + '"' +
                    ' inputmode="numeric" autocomplete="off" aria-label="跳至第几页">' +
                '<span>页</span>' +
            '</label>';
    }

    function renderCatalog() {
        const host = $('#catalogList');
        const empty = $('#catalogEmpty');
        const pager = $('#catalogPager');
        const count = $('#dlCount');
        const tab = currentTab();
        const meta = KIND_META[tab] || KIND_META.mod;

        if (state.catalog.loading) {
            if (host) host.innerHTML = '<div class="dl-loading"><i class="spin"></i>正在向 Modrinth 搜索…</div>';
            if (empty) empty.hidden = true;
            if (pager) pager.hidden = true;
            if (count) count.textContent = '搜索中';
            return;
        }

        const hits = state.catalog.hits || [];
        if (host) host.innerHTML = hits.map((hit) => catalogRow(hit, state.catalog.kind)).join('');
        if (empty) {
            empty.hidden = hits.length > 0;
            empty.textContent = state.catalog.error
                ? state.catalog.error
                : '没有匹配的内容，换个关键词或筛选条件试试。';
        }
        if (count) count.textContent = state.catalog.total > 0
            ? '共 ' + formatCount(state.catalog.total) + ' 个' + meta.noun
            : (hits.length ? '共 ' + hits.length + ' 个' + meta.noun : '没有结果');

        if (pager) {
            if (hits.length > 0 && state.catalog.pageCount > 1) {
                pager.hidden = false;
                pager.innerHTML = pagerHtml(state.catalog.pageCount, state.catalog.page);
            } else {
                pager.hidden = true;
                pager.innerHTML = '';
            }
        }
    }

    /* -----------------------------------------------------------------
       项目详情（选版本 + 选实例）
       ----------------------------------------------------------------- */
    function openProject(kind, id, title) {
        const modal = $('#projModal');
        if (!modal) return;

        state.detail = {
            open: true, loading: true, kind: kind, project: null, versions: [],
            game: '', loader: 'all', instanceId: '', error: '', installed: [], id: id, title: title || ''
        };

        /* 默认按「当前实例」的游戏版本 / 加载器过滤 */
        const inst = SL.state.activeInstance();
        if (inst && inst.mc && inst.mc !== '—') state.detail.game = inst.mc;
        if (inst && inst.loader) {
            const loader = String(inst.loader).toLowerCase();
            const options = (KIND_META[KIND_OF_TAB[currentTab()] || 'mod'] || KIND_META.mod).loaders;
            if (options.some(([value]) => value === loader)) state.detail.loader = loader;
        }
        state.detail.instanceId = inst && inst.gameDir ? inst.gameDir : '';

        modal.hidden = false;
        renderProject();

        if (!hasHost()) {
            state.detail.loading = false;
            state.detail.error = '浏览器预览里没有网络代理，请在启动器里打开项目详情。';
            renderProject();
            return;
        }

        fetchProject(id);
    }

    function fetchProject(id) {
        const detail = state.detail;
        const params = new URLSearchParams({
            id: id,
            game: detail.game || '',
            loader: detail.loader === 'all' ? '' : detail.loader
        });

        detail.loading = true;
        renderProject();

        fetch('/api/download/project?' + params.toString())
            .then((response) => response.json())
            .then((payload) => {
                if (!payload || payload.ok === false) throw new Error((payload && payload.error) || '读取项目失败');
                detail.project = payload.project || null;
                detail.versions = Array.isArray(payload.versions) ? payload.versions : [];
                detail.loading = false;
                detail.error = '';
                renderProject();
            })
            .catch((err) => {
                detail.loading = false;
                detail.error = err && err.message ? err.message : '读取项目失败';
                renderProject();
            });
    }

    function renderProject() {
        const detail = state.detail;
        const modal = $('#projModal');
        if (!modal) return;

        const currentTabKind = KIND_OF_TAB[currentTab()] || 'mod';
        const meta = KIND_META[currentTabKind] || KIND_META.mod;
        const project = detail.project;
        const title = $('#projTitle');
        const metaEl = $('#projMeta');
        const desc = $('#projDesc');
        const icon = $('#projIcon');

        if (title) {
            const zh = zhNameOf(project || {});
            title.textContent = project
                ? (zh ? zh + '（' + project.title + '）' : project.title)
                : (detail.loading ? '正在读取…' : (detail.title || '—'));
        }
        if (metaEl) {
            metaEl.textContent = project
                ? 'Modrinth · ' + formatCount(project.downloads) + ' 次下载 · 最近更新 ' + formatDate(project.updated)
                : '';
        }
        if (desc) desc.textContent = project ? (project.description || '') : (detail.error || '');
        if (icon) {
            icon.innerHTML = project && project.icon
                ? '<img src="' + escapeHtml(project.icon) + '" alt="">'
                : '<svg class="icon"><use href="#i-box"/></svg>';
        }

        /* 游戏版本候选：项目支持的版本 */
        const gameList = $('#projGameOptions');
        if (gameList) {
            const versions = (project && project.gameVersions && project.gameVersions.length)
                ? project.gameVersions.slice().reverse()
                : (state.manifest.versions || []).filter((item) => item.type === 'release').map((item) => item.id);
            gameList.innerHTML = versions.slice(0, 80)
                .map((id) => '<option value="' + escapeHtml(id) + '"></option>').join('');
        }
        const gameInput = $('#projGame');
        if (gameInput && document.activeElement !== gameInput) gameInput.value = detail.game || '';

        /* 加载器候选：项目支持的 + 全部 */
        const loaderSelect = $('#projLoader');
        if (loaderSelect) {
            const supported = (project && project.loaders && project.loaders.length) ? project.loaders : null;
            const options = [['all', '全部加载器']].concat(
                meta.loaders.filter(([value]) => value !== 'all')
                    .filter(([value]) => !supported || supported.indexOf(value) !== -1)
            );
            const html = options.map(([value, label]) => '<option value="' + value + '">' + escapeHtml(label) + '</option>').join('');
            if (loaderSelect.innerHTML.trim() !== html.trim()) loaderSelect.innerHTML = html;
            loaderSelect.value = detail.loader || 'all';
        }

        /* 目标实例 */
        const instanceSelect = $('#projInstance');
        if (instanceSelect) {
            const options = instanceOptions();
            const html = '<option value="">当前游戏目录</option>' + options.map((inst) =>
                '<option value="' + escapeHtml(inst.gameDir) + '">' + escapeHtml(inst.name) + ' · ' + escapeHtml(inst.mc || '') + '</option>'
            ).join('');
            if (instanceSelect.innerHTML.trim() !== html.trim()) instanceSelect.innerHTML = html;
            instanceSelect.value = detail.instanceId || '';
        }

        /* 文件列表 */
        const list = $('#projFiles');
        const hint = $('#projHint');
        if (list) {
            if (detail.loading) {
                list.innerHTML = '<div class="dl-loading"><i class="spin"></i>正在读取文件列表…</div>';
            } else if (detail.error) {
                list.innerHTML = '<p class="proj-empty">' + escapeHtml(detail.error) + '</p>';
            } else if (!detail.versions.length) {
                list.innerHTML = '<p class="proj-empty">没有适配当前游戏版本 / 加载器的文件，换个条件再试。</p>';
            } else {
                list.innerHTML = detail.versions.map((version) => versionFileRow(version, detail)).join('');
            }
        }
        if (hint) {
            hint.textContent = detail.versions.length
                ? '共 ' + detail.versions.length + ' 个文件 · 会一并补齐它依赖的必需文件'
                : '';
        }
    }

    function versionFileRow(version, detail) {
        const channel = (version.channel || 'release').toLowerCase();
        const channelLabel = channel === 'beta' ? 'Beta' : (channel === 'alpha' ? 'Alpha' : '正式');
        const channelClass = channel === 'beta' ? ' is-beta' : (channel === 'alpha' ? ' is-alpha' : '');
        const primary = (version.files || []).find((file) => file.primary) || (version.files || [])[0] || {};
        const key = registerAction('f:' + version.id, {
            type: 'file',
            kind: detail.kind,
            projectId: detail.project ? detail.project.id : '',
            versionId: version.id,
            name: (detail.project ? detail.project.title : '项目') + ' ' + (version.versionNumber || version.name || ''),
            game: detail.game || '',
            loader: detail.loader === 'all' ? '' : detail.loader,
            instancePath: detail.instanceId || ''
        });

        const loaders = (version.loaders || []).slice(0, 2).join(' / ');
        const games = (version.gameVersions || []).slice(0, 3).join(' ');

        return '<div class="proj-file">' +
            '<div class="proj-file-main">' +
                '<b>' + escapeHtml(version.name || version.versionNumber || '—') + '</b>' +
                '<small>' + escapeHtml([games, loaders, primary.filename || '', formatSize(primary.size)].filter(Boolean).join(' · ')) + '</small>' +
            '</div>' +
            '<div class="proj-file-tags">' +
                '<span class="proj-file-tag' + channelClass + '">' + channelLabel + '</span>' +
                '<span class="proj-file-tag">' + formatDate(version.published) + '</span>' +
            '</div>' +
            '<button class="btn btn-tonal btn-sm" type="button" data-download="' + key + '">安装</button>' +
        '</div>';
    }

    function closeProject() {
        const modal = $('#projModal');
        if (modal) modal.hidden = true;
        state.detail.open = false;
    }

    function reloadProjectFiles() {
        const detail = state.detail;
        if (!detail.project) return;
        const id = detail.project.id || detail.project.slug;
        const params = new URLSearchParams({
            id: id,
            game: detail.game || '',
            loader: detail.loader === 'all' ? '' : detail.loader
        });

        detail.loading = true;
        renderProject();

        fetch('/api/download/files?' + params.toString())
            .then((response) => response.json())
            .then((payload) => {
                if (!payload || payload.ok === false) throw new Error((payload && payload.error) || '读取失败');
                detail.versions = Array.isArray(payload.versions) ? payload.versions : [];
                detail.loading = false;
                detail.error = '';
                renderProject();
            })
            .catch((err) => {
                detail.loading = false;
                detail.error = err && err.message ? err.message : '读取失败';
                renderProject();
            });
    }

    /* -----------------------------------------------------------------
       安装
       ----------------------------------------------------------------- */
    function startDownload(key) {
        const action = state.actions.get(key);
        if (!action) return;

        if (!hasHost()) {
            toast('只有启动器里才能真正下载文件', 'i-info');
            return;
        }

        if (action.type === 'version') {
            // PCL 那样先选加载器，再决定下什么
            openInstaller(action.id);
            return;
        }

        if (action.type === 'project') {
            const projectTitle = (state.catalog.hits.find((hit) => hit.id === action.id) || {}).title || action.name;
            openProject(action.kind, action.id, projectTitle);
            return;
        }

        if (action.type === 'file') {
            if (action.kind === 'modpack') {
                hostPost({
                    type: 'download-modpack',
                    projectId: action.projectId,
                    versionId: action.versionId,
                    name: action.name,
                    game: action.game
                });
            } else {
                hostPost({
                    type: 'download-modrinth',
                    kind: action.kind,
                    projectId: action.projectId,
                    versionId: action.versionId,
                    name: action.name,
                    game: action.game,
                    loader: action.loader,
                    instancePath: action.instancePath
                });
            }
            toast('已加入队列：' + action.name, 'i-download');
        }
    }

    /* -----------------------------------------------------------------
       安装原版：先选加载器（对应 PCL 的安装页）
       ----------------------------------------------------------------- */
    function installedLoadersFor(mc) {
        const map = {};
        (SL.state.instances || []).forEach((inst) => {
            if (!inst || inst.mc !== mc) return;
            const key = String(inst.loader || '').toLowerCase();
            if (!key || key === 'vanilla') return;
            map[key] = inst.loaderName || inst.loader;
        });
        return map;
    }

    /** 默认实例名：原版就是版本号，带加载器时把加载器和版本也写进去（PCL 也这么叫）。 */
    function defaultInstallName(mc, loaderKey, loaderVersion) {
        if (!loaderKey || loaderKey === 'vanilla') return 'Minecraft ' + mc;
        const loader = (state.installer.loaders || []).find((item) => item.key === loaderKey);
        const loaderName = loader ? loader.name : loaderKey;
        return 'Minecraft ' + mc + ' + ' + loaderName + (loaderVersion ? ' ' + loaderVersion : '');
    }

    /** 用户没手动改过名字时，跟着所选的加载器/版本自动更新。 */
    function refreshInstallName() {
        const data = state.installer;
        if (data.nameTouched) return;
        data.name = defaultInstallName(data.mc, data.choice, data.version);
        const input = $('#installName');
        if (input && document.activeElement !== input) input.value = data.name;
    }

    function openInstaller(mc) {
        const modal = $('#installModal');
        if (!modal || !mc) return;

        state.installer = {
            open: true, mc: mc, loading: hasHost(), error: '',
            loaders: [], choice: 'vanilla', version: '',
            installed: installedLoadersFor(mc),
            name: 'Minecraft ' + mc, nameTouched: false
        };
        modal.hidden = false;
        renderInstaller();

        if (!hasHost()) {
            state.installer.loading = false;
            state.installer.error = '浏览器预览里读不到加载器清单，请在启动器里试。';
            renderInstaller();
            return;
        }

        fetch('/api/download/loaders?mc=' + encodeURIComponent(mc))
            .then((response) => response.json())
            .then((payload) => {
                if (!payload || payload.ok === false) {
                    throw new Error((payload && payload.error) || '读取加载器清单失败');
                }
                state.installer.loaders = Array.isArray(payload.loaders) ? payload.loaders : [];
                state.installer.loading = false;
                state.installer.error = '';
                renderInstaller();
            })
            .catch((err) => {
                state.installer.loading = false;
                state.installer.error = err && err.message ? err.message : '读取加载器清单失败';
                renderInstaller();
            });
    }

    function closeInstaller() {
        const modal = $('#installModal');
        if (modal) modal.hidden = true;
        state.installer.open = false;
    }

    function installerRow(loader, data) {
        const key = loader.key || 'vanilla';
        const versions = loader.versions || [];
        const installed = data.installed[key];
        const selected = data.choice === key;

        let status;
        if (installed) status = '已安装 · ' + installed;
        else if (loader.manual) status = loader.note || '需要手动安装';
        else if (versions.length) status = versions.length + ' 个版本可选';
        else status = loader.note || '无';

        let html = '<button class="install-row' + (selected ? ' is-active' : '') + '" type="button" data-install-choice="' + escapeHtml(key) + '">' +
            '<span class="install-name">' + escapeHtml(loader.name || key) + '</span>' +
            '<span class="install-status">' + escapeHtml(status) + '</span>' +
            '<svg class="icon" aria-hidden="true"><use href="#' + (selected ? 'i-check' : 'i-chevron-right') + '"/></svg>' +
        '</button>';

        if (!selected) return html;

        if (versions.length) {
            html += '<div class="install-versions">' + versions.map((item) => {
                const active = data.version === item.version;
                return '<button class="install-version' + (active ? ' is-active' : '') + '" type="button" data-install-version="' + escapeHtml(item.version) + '">' +
                    '<span class="num">' + escapeHtml(item.version) + '</span>' +
                    (item.recommended ? '<span class="install-tag">推荐</span>' : '') +
                '</button>';
            }).join('') + '</div>';
        } else if (loader.manual) {
            html += '<div class="install-versions install-versions--note">' +
                '<button class="link" type="button" data-open-url="' + escapeHtml(loader.manualUrl || 'https://optifine.net/downloads') + '" data-open-label="OptiFine 下载页">打开 OptiFine 下载页</button>' +
                '<span class="install-note">下载后把 jar 放进 .minecraft 目录再双击安装，装好会在版本列表里出现</span>' +
            '</div>';
        } else if (loader.note) {
            html += '<div class="install-versions install-versions--note"><span class="install-note">' + escapeHtml(loader.note) + '</span></div>';
        }
        return html;
    }

    function renderInstaller() {
        const data = state.installer;
        const title = $('#installTitle');
        if (title) title.textContent = '安装 Minecraft ' + (data.mc || '');

        const list = $('#installList');
        const hint = $('#installHint');
        const start = $('#installStart');

        if (list) {
            if (data.loading) {
                list.innerHTML = '<div class="dl-loading"><i class="spin"></i>正在读取加载器清单…</div>';
            } else {
                const rows = [installerRow({ key: 'vanilla', name: '原版', note: '不带任何加载器' }, data)];
                (data.loaders || []).forEach((loader) => rows.push(installerRow(loader, data)));
                list.innerHTML = rows.join('') +
                    (data.error ? '<p class="install-error">' + escapeHtml(data.error) + '</p>' : '');
            }
        }

        const loader = (data.loaders || []).find((item) => item.key === data.choice);
        if (hint) {
            if (data.choice === 'vanilla') hint.textContent = '只装原版，之后还可以再回来加加载器';
            else if (loader && loader.manual) hint.textContent = 'OptiFine 需要手动安装';
            else if (loader && data.version) hint.textContent = '将安装 ' + loader.name + ' ' + data.version;
            else hint.textContent = '';
        }
        if (start) {
            const blocked = data.loading || (loader && (loader.manual || !(loader.versions || []).length));
            start.disabled = Boolean(blocked);
        }

        refreshInstallName();
    }

    function startInstallerDownload() {
        const data = state.installer;
        if (!data.mc) return;
        if (!hasHost()) {
            toast('只有启动器里才能真正下载文件', 'i-info');
            return;
        }

        if (data.choice === 'vanilla') {
            hostPost({
                type: 'download-install-version',
                versionId: data.mc,
                loader: 'vanilla',
                name: (data.name || '').trim(),
                // 用户自己改过名字 → 宿主直接把版本文件夹也改成这个名字
                nameTouched: Boolean(data.nameTouched)
            });
            toast('已加入队列：' + ((data.name || '').trim() || ('Minecraft ' + data.mc)), 'i-download');
            closeInstaller();
            return;
        }

        const loader = (data.loaders || []).find((item) => item.key === data.choice);
        if (!loader || loader.manual || !(loader.versions || []).length) {
            toast('这个加载器没有可安装的版本', 'i-info');
            return;
        }

        const version = data.version || (loader.versions.find((item) => item.recommended) || loader.versions[0]).version;
        hostPost({
            type: 'download-install-version',
            versionId: data.mc,
            loader: loader.key,
            loaderVersion: version,
            name: (data.name || '').trim(),
            nameTouched: Boolean(data.nameTouched)
        });
        toast('已加入队列：' + ((data.name || '').trim() || ('Minecraft ' + data.mc + ' + ' + loader.name + ' ' + version)), 'i-download');
        closeInstaller();
    }

    /* -----------------------------------------------------------------
       队列 / 记录
       ----------------------------------------------------------------- */
    function renderQueue() {
        const host = $('#dlQueue');
        const count = $('#queueCount');
        const jobs = state.jobs || [];

        if (count) {
            const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
            const paused = jobs.filter((job) => job.status === 'paused').length;
            count.textContent = active + ' 项进行中' + (paused ? ' · ' + paused + ' 项已暂停' : '');
        }

        if (!host) return;
        if (!jobs.length) {
            host.innerHTML = '<p class="queue-empty">队列是空的。安装原版游戏或下载 Mod 时，进度会显示在这里。</p>';
            return;
        }

        host.innerHTML = jobs.slice().reverse().map((job) => {
            const status = job.status || 'queued';
            const progress = status === 'queued' ? 0 : Math.max(0, Math.min(100, Number(job.progress) || 0));
            const right = status === 'running' ? Math.round(progress) + '%'
                : (status === 'queued' ? '排队中'
                    : (status === 'done' ? '已完成'
                        : (status === 'failed' ? '失败'
                            : (status === 'paused' ? '已暂停' : '已取消'))));
            const speed = formatSpeed(job.speed);
            const phase = status === 'failed' && job.error ? job.error : (job.phase || '');
            const meta = [phase, speed].filter(Boolean).join(' · ');
            const id = escapeHtml(job.id);

            /* 进行中给「暂停」，已暂停给「继续」；两个状态都能取消 */
            let actions = '';
            if (status === 'running' || status === 'queued') {
                actions = '<div class="queue-actions">' +
                    '<button class="queue-cancel" type="button" data-queue-pause="' + id + '">暂停</button>' +
                    '<button class="queue-cancel" type="button" data-queue-cancel="' + id + '">取消</button>' +
                '</div>';
            } else if (status === 'paused') {
                actions = '<div class="queue-actions">' +
                    '<button class="queue-cancel queue-resume" type="button" data-queue-resume="' + id + '">继续</button>' +
                    '<button class="queue-cancel" type="button" data-queue-cancel="' + id + '">取消</button>' +
                '</div>';
            }

            return '<div class="queue-item is-' + status + '">' +
                '<div class="queue-top"><b>' + escapeHtml(job.name || '下载任务') + '</b><span class="num">' + right + '</span></div>' +
                '<div class="queue-bar"><i style="width:' + progress + '%"></i></div>' +
                '<div class="queue-meta"><span>' + escapeHtml(meta) + '</span>' +
                    '<span>' + (job.total ? job.done + '/' + job.total : '') + '</span></div>' +
                actions +
            '</div>';
        }).join('');
    }

    function renderHistory() {
        const host = $('#dlHistory');
        if (!host) return;
        if (!state.history.length) {
            host.innerHTML = '<p class="queue-empty" style="padding:6px 0 4px">这一栏记录本次运行期间装好的内容。</p>';
            return;
        }
        host.innerHTML = state.history.slice(0, 12).map((item) => {
            const icon = item.kind === 'version' ? 'i-cube' : (item.kind === 'modpack' ? 'i-package' : 'i-box');
            const chip = item.ok
                ? '<span class="chip-ok"><i aria-hidden="true"></i>已完成</span>'
                : '<span class="chip-plain">失败</span>';
            return '<div class="history-row">' +
                '<span class="history-ico"><svg class="icon"><use href="#' + icon + '"/></svg></span>' +
                '<div class="history-copy"><b>' + escapeHtml(item.name) + '</b><span class="num">' +
                    escapeHtml(item.detail || item.phase || '') + '</span></div>' +
                chip +
            '</div>';
        }).join('');
    }

    const MOD_SOURCE_LABEL = {
        auto: '自动 · 官方优先，失败走镜像',
        mcim: 'MCIM 镜像',
        official: 'Modrinth 官方'
    };

    /* 侧栏小标题只有一行的位置，用短一点的说法 */
    const MOD_SOURCE_SHORT = { auto: '自动', mcim: 'MCIM 镜像', official: '官方' };

    function normalizeModSource(value) {
        const text = String(value || '').trim().toLowerCase();
        if (text === 'mcim' || text === 'mirror') return 'mcim';
        if (text === 'official') return 'official';
        return 'auto';
    }

    function renderSource() {
        const source = state.source || 'bmclapi';
        $$('[data-source], [data-dl-source]').forEach((btn) => {
            const value = btn.dataset.source || btn.dataset.dlSource || '';
            const normalized = value === '官方源' || value === 'official' ? 'official' : 'bmclapi';
            const active = normalized === source;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        const note = $('#dlMirrorNote');
        if (note) note.textContent = source === 'official' ? '官方直连' : '国内镜像';
        const settingsNote = $('#setDownloadSourceNote');
        if (settingsNote) settingsNote.textContent = source === 'official' ? 'Mojang 官方源（国内可能很慢）' : '当前 BMCLAPI 国内镜像';

        /* 社区资源那一组 */
        const modSource = normalizeModSource(state.modrinthSource);
        $$('[data-mod-source], [data-dl-mod-source]').forEach((btn) => {
            const value = normalizeModSource(btn.dataset.modSource || btn.dataset.dlModSource || '');
            const active = value === modSource;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        /* 「自动」档一旦在本次运行里退回镜像，就把状态直接写出来，省得用户以为还是官方 */
        const modText = modSource === 'auto' && state.modrinthFallback
            ? '已切到 MCIM 镜像'
            : MOD_SOURCE_SHORT[modSource];
        const modNote = $('#dlModMirrorNote');
        if (modNote) modNote.textContent = modText;
        const modSettingsNote = $('#setModSourceNote');
        if (modSettingsNote) modSettingsNote.textContent = '当前 ' + MOD_SOURCE_LABEL[modSource];
    }

    /* -----------------------------------------------------------------
       渲染入口
       ----------------------------------------------------------------- */
    function renderDownloads() {
        const tab = currentTab();
        const isVersion = tab === 'version';
        const isCatalog = !isVersion;

        const searchField = $('#dlSearchField');
        if (searchField) searchField.hidden = !isVersion;
        const versions = $('#dlVersions');
        if (versions) versions.hidden = !isVersion;
        const catalogSearch = $('#catalogSearch');
        if (catalogSearch) catalogSearch.hidden = !isCatalog;
        const catalogList = $('#catalogList');
        if (catalogList) catalogList.hidden = !isCatalog;
        /* 分页栏是结果列表的兄弟节点，切回原版游戏时要一起收掉，否则会孤零零留在下面 */
        const catalogPager = $('#catalogPager');
        if (catalogPager && isVersion) {
            catalogPager.hidden = true;
            catalogPager.innerHTML = '';
        }
        const count = $('#dlCount');
        if (count && isVersion) count.textContent = '—';

        if (isVersion) {
            if (!state.manifest.loaded && !state.manifest.loading) loadManifest();
            else renderVersions();
            return;
        }

        syncCatalogForm();
        if (!state.catalog.loaded && !state.catalog.loading) {
            /* 切到某个分类时先按当前条件搜一次，免得页面空着 */
            searchCatalog();
        } else {
            renderCatalog();
        }
    }

    /* -----------------------------------------------------------------
       宿主消息
       ----------------------------------------------------------------- */
    function onHostMessage(data) {
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'download-state') {
            state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
            if (data.source) state.source = data.source;
            if (data.modrinthSource) state.modrinthSource = normalizeModSource(data.modrinthSource);
            state.modrinthFallback = data.modrinthFallback === true;
            renderSource();
            renderQueue();
            if (currentTab() === 'version') {
                const signature = versionSignature();
                const now = Date.now();
                if (signature !== lastVersionSignature && now - lastVersionRender > 500) {
                    lastVersionSignature = signature;
                    lastVersionRender = now;
                    renderVersions();
                }
            }
            return;
        }

        if (data.type === 'download-queued') {
            toast('已加入队列：' + (data.name || '任务'), 'i-download');
            return;
        }

        if (data.type === 'download-finished') {
            state.history.unshift({
                name: data.name || '任务',
                kind: data.kind || '',
                ok: data.status === 'done',
                detail: data.detail || data.error || data.phase || '',
                phase: data.phase || ''
            });
            if (state.history.length > 30) state.history.length = 30;
            renderHistory();

            if (data.status === 'done') {
                toast(data.name + ' 安装完成', 'i-check');
            } else if (data.status === 'failed') {
                toast((data.name || '任务') + ' 失败：' + (data.error || '未知原因'), 'i-info');
            } else if (data.status === 'canceled') {
                toast('已取消 ' + (data.name || '任务'), 'i-info');
            }

            if (data.kind === 'version' || data.kind === 'modpack') {
                /* 装完版本 / 整合包，版本列表要重新扫一遍 */
                const versionsMod = SL.core.mod('versions');
                if (typeof versionsMod.loadInstances === 'function') versionsMod.loadInstances({ force: true });
            }
            return;
        }

        if (data.type === 'download-error') {
            toast(data.error || '下载失败', 'i-info');
            return;
        }
    }

    /* -----------------------------------------------------------------
       事件绑定
       ----------------------------------------------------------------- */
    function bindDownload() {
        /* 分类 tab */
        $$('[data-dl-tab]').forEach((btn) => btn.addEventListener('click', () => setDownloadCategory(btn.dataset.dlTab)));

        /* 版本搜索 */
        const search = $('#dlSearch');
        if (search) {
            search.addEventListener('input', () => {
                if (currentTab() === 'version') renderVersions();
            });
        }

        const refresh = $('#dlRefresh');
        if (refresh) {
            refresh.addEventListener('click', () => {
                if (currentTab() === 'version') loadManifest(true);
                else searchCatalog();
                toast('正在刷新索引…', 'i-refresh');
            });
        }

        /* 版本分组折叠 */
        const groups = $('#dlVersionGroups');
        if (groups) {
            groups.addEventListener('click', (event) => {
                const head = event.target.closest('.version-group-head');
                if (!head) return;
                const group = head.closest('.version-group');
                if (!group) return;
                const collapsed = group.classList.toggle('is-collapsed');
                head.setAttribute('aria-expanded', String(!collapsed));
                if (collapsed) state.openGroups.delete(group.dataset.vgroup);
                else state.openGroups.add(group.dataset.vgroup);
            });
        }

        /* 搜索表单 */
        const searchBtn = $('#catalogSearchBtn');
        if (searchBtn) searchBtn.addEventListener('click', () => {
            const tab = currentTab();
            const form = state.search[tab];
            form.name = ($('#catalogName') && $('#catalogName').value) || '';
            form.game = ($('#catalogVersion') && $('#catalogVersion').value.trim()) || '';
            form.loader = ($('#catalogType') && $('#catalogType').value) || 'all';
            form.sort = ($('#catalogSort') && $('#catalogSort').value) || 'relevance';
            form.page = 1;
            searchCatalog();
        });

        const resetBtn = $('#catalogResetBtn');
        if (resetBtn) resetBtn.addEventListener('click', () => {
            const tab = currentTab();
            state.search[tab] = { name: '', game: '', loader: 'all', sort: 'relevance', page: 1 };
            syncCatalogForm();
            searchCatalog();
            toast('搜索条件已重置', 'i-refresh');
        });

        const typeSelect = $('#catalogType');
        if (typeSelect) typeSelect.addEventListener('change', () => {
            const tab = currentTab();
            state.search[tab].loader = typeSelect.value;
            state.search[tab].page = 1;
            searchCatalog();
        });

        const sortSelect = $('#catalogSort');
        if (sortSelect) sortSelect.addEventListener('change', () => {
            const tab = currentTab();
            state.search[tab].sort = sortSelect.value;
            state.search[tab].page = 1;
            searchCatalog();
        });

        ['#catalogName', '#catalogVersion'].forEach((selector) => {
            const input = $(selector);
            if (!input) return;
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (searchBtn) searchBtn.click();
            });
        });

        /* 翻页 */
        const pager = $('#catalogPager');
        if (pager) {
            pager.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-page]');
                if (!btn) return;
                const tab = currentTab();
                const form = state.search[tab];
                if (!form) return;   // 原版游戏没有分页数据，别在这里崩
                const value = btn.dataset.page;
                if (value === 'prev') form.page = Math.max(1, form.page - 1);
                else if (value === 'next') form.page = Math.min(state.catalog.pageCount, form.page + 1);
                else form.page = Number(value) || 1;
                searchCatalog();
            });

            /* 「跳至 __ 页」：回车和失焦都算，越界自动夹到 1..总页数 */
            const jump = (input) => {
                if (!input) return;
                const tab = currentTab();
                const form = state.search[tab];
                if (!form) return;
                const total = Math.max(1, state.catalog.pageCount || 1);
                const wanted = Math.min(total, Math.max(1, Math.floor(Number(input.value)) || 1));
                if (wanted === form.page) {
                    input.value = String(wanted);
                    return;
                }
                form.page = wanted;
                searchCatalog();
            };

            pager.addEventListener('change', (event) => {
                const input = event.target.closest('.pager-input');
                if (input) jump(input);
            });
            pager.addEventListener('keydown', (event) => {
                const input = event.target.closest('.pager-input');
                if (!input) return;
                if (event.key !== 'Enter') return;
                event.preventDefault();
                event.stopPropagation();
                jump(input);
            });
        }

        /* 安装浮层（选加载器） */
        const installModal = $('#installModal');
        if (installModal) {
            installModal.addEventListener('click', (event) => {
                if (event.target.closest('[data-close-install]') || event.target === installModal) {
                    closeInstaller();
                    return;
                }
                const choice = event.target.closest('[data-install-choice]');
                if (choice) {
                    const key = choice.dataset.installChoice;
                    const data = state.installer;
                    data.choice = key;
                    const entry = (data.loaders || []).find((item) => item.key === key);
                    const versions = (entry && entry.versions) || [];
                    data.version = versions.length
                        ? (versions.find((item) => item.recommended) || versions[0]).version
                        : '';
                    renderInstaller();
                    return;
                }
                const versionBtn = event.target.closest('[data-install-version]');
                if (versionBtn) {
                    state.installer.version = versionBtn.dataset.installVersion;
                    renderInstaller();
                    return;
                }
                if (event.target.closest('#installStart')) {
                    startInstallerDownload();
                }
            });
            installModal.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeInstaller();
            });
        }

        /* 安装浮层里的「实例名称」：一改就锁住，不再跟着加载器自动改名 */
        const installName = $('#installName');
        if (installName) {
            installName.addEventListener('input', () => {
                state.installer.name = installName.value;
                state.installer.nameTouched = true;
            });
        }

        /* 项目详情浮层 */
        const projModal = $('#projModal');
        if (projModal) {
            projModal.addEventListener('click', (event) => {
                if (event.target.closest('[data-close-proj]') || event.target === projModal) {
                    closeProject();
                }
            });
            projModal.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeProject();
                }
            });
        }

        const projGame = $('#projGame');
        if (projGame) projGame.addEventListener('change', () => {
            state.detail.game = projGame.value.trim();
            reloadProjectFiles();
        });

        const projLoader = $('#projLoader');
        if (projLoader) projLoader.addEventListener('change', () => {
            state.detail.loader = projLoader.value;
            reloadProjectFiles();
        });

        const projInstance = $('#projInstance');
        if (projInstance) projInstance.addEventListener('change', () => {
            state.detail.instanceId = projInstance.value;
        });

        const projReload = $('#projReload');
        if (projReload) projReload.addEventListener('click', reloadProjectFiles);

        /* 搜索结果里点一行 = 打开详情（按钮本身也能点） */
        const list = $('#catalogList');
        if (list) {
            list.addEventListener('click', (event) => {
                if (event.target.closest('[data-download]')) return;
                const row = event.target.closest('[data-project]');
                if (!row) return;
                const action = state.actions.get(row.dataset.project);
                if (!action) return;
                startDownload(row.dataset.project);
            });
        }

        /* 队列 */
        const queue = $('#dlQueue');
        if (queue) {
            queue.addEventListener('click', (event) => {
                const cancel = event.target.closest('[data-queue-cancel]');
                if (cancel) {
                    hostPost({ type: 'download-cancel', id: cancel.dataset.queueCancel });
                    toast('正在取消…', 'i-info');
                    return;
                }

                const pause = event.target.closest('[data-queue-pause]');
                if (pause) {
                    hostPost({ type: 'download-pause', id: pause.dataset.queuePause });
                    toast('正在暂停，已下载的部分会保留', 'i-info');
                    return;
                }

                const resume = event.target.closest('[data-queue-resume]');
                if (resume) {
                    hostPost({ type: 'download-resume', id: resume.dataset.queueResume });
                    toast('继续下载…', 'i-download');
                }
            });
        }

        const clearQueue = $('#dlQueueClear');
        if (clearQueue) clearQueue.addEventListener('click', () => {
            hostPost({ type: 'download-clear' });
            toast('已清空已完成的任务', 'i-refresh');
        });

        const clearHistory = $('#dlHistoryClear');
        if (clearHistory) clearHistory.addEventListener('click', () => {
            state.history = [];
            renderHistory();
            toast('下载记录已清空', 'i-refresh');
        });

        /* 下载源 */
        $$('[data-source], [data-dl-source]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const raw = btn.dataset.source || btn.dataset.dlSource || '';
                const source = (raw === 'official' || raw === '官方源') ? 'official' : 'bmclapi';
                state.source = source;
                renderSource();
                if (hasHost()) hostPost({ type: 'download-mirror', source: source });
                toast(source === 'official' ? '下载源：Mojang 官方（国内可能很慢）' : '下载源：BMCLAPI 镜像', 'i-cloud');
            });
        });

        /* 社区资源下载源（Mod / 整合包 / 资源包 / 光影） */
        $$('[data-mod-source], [data-dl-mod-source]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const source = normalizeModSource(btn.dataset.modSource || btn.dataset.dlModSource || '');
                state.modrinthSource = source;
                state.modrinthFallback = false;
                renderSource();
                if (hasHost()) hostPost({ type: 'download-modrinth-source', source: source });
                toast('社区资源下载源：' + MOD_SOURCE_LABEL[source], 'i-cloud');
            });
        });

        /* 宿主消息 */
        const webview = window.chrome && window.chrome.webview;
        if (webview && typeof webview.addEventListener === 'function') {
            webview.addEventListener('message', (event) => {
                let payload = event.data;
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); } catch (err) { return; }
                }
                onHostMessage(payload);
            });
        }

        /* 先按默认值把两组源的选中态、说明文字画一遍；宿主随后会用 download-state 覆盖 */
        renderSource();
    }

    function setDownloadCategory(category) {
        const previousKind = KIND_OF_TAB[currentTab()];
        const nextKind = KIND_OF_TAB[category];
        if (nextKind && nextKind !== previousKind) {
            /* 换分类 = 换搜索条件，结果列表要清空重搜 */
            state.catalog = {
                loading: false, loaded: false, hits: [], total: 0,
                page: 1, pageCount: 1, error: '', kind: nextKind
            };
            if (state.search[category]) state.search[category].page = 1;
        }
        ui.dlCat = category;
        try { SL.core.writeStore(SL.core.STORE.uiPrefs, ui); } catch (err) { /* 忽略 */ }
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === category;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        renderDownloads();
    }

    /** 设置页的「并发下载数」：告诉宿主一次开几个下载。announce=false 时静默同步。 */
    function setConcurrency(value, announce) {
        const concurrency = Math.max(1, Math.min(16, Number(value) || 6));
        state.concurrency = concurrency;
        if (hasHost()) hostPost({ type: 'download-concurrency', concurrency: concurrency });
        if (announce !== false) toast('并发下载数：' + concurrency, 'i-download');
    }

    /* 兼容旧调用点（13-settings / app.js 还在用这个名字） */
    function selectSource(name) {
        state.source = (name === 'official' || name === '官方源') ? 'official' : 'bmclapi';
        renderSource();
        if (hasHost()) hostPost({ type: 'download-mirror', source: state.source });
    }

    function renderDownloadsLegacy() {
        renderDownloads();
    }

    SL.download = Object.assign(SL.download || {}, {
        state,
        setConcurrency,
        renderDownloads,
        renderDownloadsLegacy,
        renderQueue,
        renderHistory,
        renderVersions,
        renderCatalog,
        renderSource,
        syncCatalogForm,
        loadManifest,
        searchCatalog,
        openProject,
        closeProject,
        openInstaller,
        closeInstaller,
        renderInstaller,
        startDownload,
        setDownloadCategory,
        selectSource,
        bindDownload,
        onHostMessage,
        formatSize,
        formatSpeed
    });
})(window);
