/* =====================================================================
   StarLaunch · 交互脚本
   ---------------------------------------------------------------------
   · 零依赖，file:// / WebView2 / Electron 都能直接打开
   · 配色全部交给 theme.js（Material Color Utilities），这里只读不写色值
   · 窗口按钮优先调用宿主 API，其次 postMessage，最后发 DOM 事件：
       window.starLaunch.window.minimize / maximize / close
       window.chrome.webview.postMessage({ type: 'window-control', action })
       window.dispatchEvent(new CustomEvent('starlaunch:window-control', { detail:{ action } }))
   ===================================================================== */
(function () {
    'use strict';

    /* -----------------------------------------------------------------
       基础工具
       ----------------------------------------------------------------- */
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const pad2 = (n) => String(n).padStart(2, '0');
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

    const STORE = {
        launchPrefs: 'starlaunch.launch.v3',
        uiPrefs: 'starlaunch.ui.v3'
    };

    function readStore(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? Object.assign({}, fallback, parsed) : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) { /* 本地存储不可用时静默 */ }
    }

    /* -----------------------------------------------------------------
       数据
       ----------------------------------------------------------------- */
    const INSTANCES = [
        {
            id: 'winter', name: '冬夜生存', loader: 'NeoForge', loaderName: 'NeoForge 20.4.237',
            mc: '1.20.4', mods: 82, mem: 8, java: '21.0.8', kind: 'modded', tone: 'winter',
            last: '2 小时前', path: 'D:\\Games\\.minecraft\\versions\\winter-night',
            modPreview: ['Create', 'JEI', 'Iris']
        },
        {
            id: 'sky', name: '天空工厂', loader: 'Fabric', loaderName: 'Fabric 0.16.5',
            mc: '1.21.1', mods: 46, mem: 6, java: '21.0.8', kind: 'modded', tone: 'sky',
            last: '昨天 21:04', path: 'D:\\Games\\.minecraft\\versions\\sky-factory',
            modPreview: ['Sodium', 'Lithium', 'Iris']
        },
        {
            id: 'vanilla', name: '原版 1.21.4', loader: 'Vanilla', loaderName: 'Vanilla',
            mc: '1.21.4', mods: 0, mem: 4, java: '21.0.8', kind: 'vanilla', tone: 'plain',
            last: '3 天前', path: 'D:\\Games\\.minecraft\\versions\\1.21.4',
            modPreview: []
        },
        {
            id: 'beta', name: '星辉旅人', loader: 'Forge', loaderName: 'Forge 43.4.0',
            mc: '1.19.2', mods: 128, mem: 10, java: '17.0.13', kind: 'modded', tone: 'violet',
            last: '尚未启动', path: 'D:\\Games\\.minecraft\\versions\\star-traveler',
            modPreview: ['Twilight Forest', 'Botania', 'JEI']
        },
        {
            id: 'depth', name: '深岩之下', loader: 'Fabric', loaderName: 'Fabric 0.15.11',
            mc: '1.20.6', mods: 37, mem: 6, java: '21.0.8', kind: 'modded', tone: 'deep',
            last: '5 天前', path: 'D:\\Games\\.minecraft\\versions\\deep-rock',
            modPreview: ['Create', "Farmer's Delight", 'Jade']
        },
        {
            id: 'diner', name: '像素餐厅', loader: 'Forge', loaderName: 'Forge 40.2.21',
            mc: '1.18.2', mods: 210, mem: 12, java: '17.0.13', kind: 'modded', tone: 'sunset',
            last: '上周', path: 'D:\\Games\\.minecraft\\versions\\pixel-diner',
            modPreview: ['Create', "Farmer's Delight", 'MineMenu']
        },
        {
            id: 'end', name: '末地远征', loader: 'Fabric', loaderName: 'Fabric 0.16.5',
            mc: '1.21.1', mods: 64, mem: 8, java: '21.0.8', kind: 'modded', tone: 'sky',
            last: '3 周前', path: 'D:\\Games\\.minecraft\\versions\\end-expedition',
            modPreview: ['End Remastered', 'Trinkets', 'Cloth Config']
        },
        {
            id: 'redstone', name: '红石工坊', loader: 'Forge', loaderName: 'Forge 36.2.39',
            mc: '1.16.5', mods: 96, mem: 8, java: '11.0.22', kind: 'modded', tone: 'ember',
            last: '1 个月前', path: 'D:\\Games\\.minecraft\\versions\\redstone-workshop',
            modPreview: ['Create', 'Immersive Engineering', 'ProjectE']
        },
        {
            id: 'creative', name: '创造沙盒', loader: 'Vanilla', loaderName: 'Vanilla',
            mc: '1.21.1', mods: 0, mem: 4, java: '21.0.8', kind: 'vanilla', tone: 'plain',
            last: '2 周前', path: 'D:\\Games\\.minecraft\\versions\\creative-sandbox',
            modPreview: []
        }
    ];

    const QUOTES = [
        '方块堆成星海，夜晚就有了归处。',
        '先挖三块木头，再去想远方。',
        '把家建在出生点，把梦建在云端。',
        '世界没有存档，但今天可以重来。',
        '一间木屋，一盏南瓜灯，就够了。'
    ];

    const ROUTES = {
        home: { crumb: '启动', title: 'StarLaunch' },
        versions: { crumb: '版本', title: '版本 · StarLaunch' },
        download: { crumb: '下载', title: '下载 · StarLaunch' },
        settings: { crumb: '设置', title: '设置 · StarLaunch' }
    };

    const DL_LABELS = {
        version: ['个版本', '安装'],
        modpack: ['个整合包', '安装'],
        mod: ['个模组', '添加'],
        resource: ['个资源包', '下载']
    };

    const DOWNLOADS = [
        { id: 'mc-1214', cat: 'version', name: 'Minecraft 1.21.4', sub: '冬季更新 · 正式版 · 2024-12-03 · Java 21', size: '386 MB', tile: '1.21.4', tone: 'a', badge: '最新' },
        { id: 'mc-1211', cat: 'version', name: 'Minecraft 1.21.1', sub: '正式版 · 2024-08-08 · Java 21', size: '372 MB', tile: '1.21.1', tone: 'b' },
        { id: 'mc-1206', cat: 'version', name: 'Minecraft 1.20.6', sub: '正式版 · 2024-04-29 · Java 21', size: '358 MB', tile: '1.20.6', tone: 'c' },
        { id: 'mc-1201', cat: 'version', name: 'Minecraft 1.20.1', sub: '模组黄金版 · 2023-06-12 · Java 17', size: '312 MB', tile: '1.20.1', tone: 'd', badge: '热门' },
        { id: 'mc-1192', cat: 'version', name: 'Minecraft 1.19.2', sub: '稳定版 · 2022-08-05 · Java 17', size: '298 MB', tile: '1.19.2', tone: 'e' },
        { id: 'mc-1165', cat: 'version', name: 'Minecraft 1.16.5', sub: '经典版 · 2021-01-15 · Java 11', size: '264 MB', tile: '1.16.5', tone: 'f' },
        { id: 'pack-winter', cat: 'modpack', name: '冬夜生存', sub: 'NeoForge 1.20.4 · 82 个模组', size: '1.8 GB', tile: '冬夜', tone: 'a', badge: '推荐' },
        { id: 'pack-sky', cat: 'modpack', name: '天空工厂', sub: 'Fabric 1.21.1 · 空岛整合 · 46 个模组', size: '960 MB', tile: '天空', tone: 'b' },
        { id: 'pack-star', cat: 'modpack', name: '星辉旅人', sub: 'Forge 1.19.2 · 冒险整合 · 128 个模组', size: '2.4 GB', tile: '星辉', tone: 'd' },
        { id: 'mod-sodium', cat: 'mod', name: 'Sodium 钠', sub: 'Fabric 1.21.x · 渲染优化', size: '1.2 MB', tile: 'Na', tone: 'c' },
        { id: 'mod-iris', cat: 'mod', name: 'Iris Shaders', sub: 'Fabric 1.21.x · 光影加载', size: '6.8 MB', tile: 'Iris', tone: 'e' },
        { id: 'mod-jei', cat: 'mod', name: 'JEI 物品管理器', sub: 'Forge 1.20.x · 实用工具', size: '3.4 MB', tile: 'JEI', tone: 'a' },
        { id: 'mod-create', cat: 'mod', name: 'Create 机械动力', sub: 'Forge 1.20.1 · 科技模组', size: '18.6 MB', tile: 'C+', tone: 'f' },
        { id: 'rp-dawn', cat: 'resource', name: '晨曦 128×', sub: '通用 · 1.20+ · 清新光影向', size: '64 MB', tile: '晨', tone: 'e' },
        { id: 'rp-mint', cat: 'resource', name: '薄荷 64×', sub: '通用 · 1.20+ · 清爽低配向', size: '28 MB', tile: '薄荷', tone: 'c' }
    ];

    const QUEUE_SEED = [
        { id: 'q-1214', name: 'Minecraft 1.21.4', phase: 'assets · 12.4 MB/s', eta: '约 2 分钟', progress: 68, state: 'running' },
        { id: 'q-neo', name: 'NeoForge 20.4.237', phase: '排队中 · 0 B/s', eta: '—', progress: 0, state: 'queued' }
    ];

    /* -----------------------------------------------------------------
       运行时状态
       ----------------------------------------------------------------- */
    const ui = readStore(STORE.uiPrefs, { activeId: 'winter', instFilter: 'all', dlCat: 'version', source: 'BMCLAPI', setTab: 'appearance' });
    const launchPrefs = readStore(STORE.launchPrefs, { mem: 8, updater: true, minimize: false, concurrency: 8, cleanCache: true, launcherUpdate: true, rememberWindow: true, tray: false, winStyle: 'right' });
    const downloadState = new Map();
    const queue = QUEUE_SEED.slice();

    let launchTimers = [];
    let launchState = 'idle';
    let lastFocus = null;
    let quoteIndex = 0;

    const getInstance = (id) => INSTANCES.find((item) => item.id === id) || INSTANCES[0];
    const activeInstance = () => getInstance(ui.activeId);
    const modsLabel = (inst) => (inst.mods > 0 ? inst.mods + ' 个模组' : '无模组');

    /* -----------------------------------------------------------------
       Toast
       ----------------------------------------------------------------- */
    function toast(message, icon) {
        const host = $('#toasts');
        if (!host) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + escapeHtml(message) + '</span>';
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-in'));
        while (host.children.length > 3) host.firstElementChild.remove();
        window.setTimeout(() => {
            el.classList.remove('is-in');
            window.setTimeout(() => el.remove(), 220);
        }, 2600);
    }

    /* -----------------------------------------------------------------
       时间 / 问候
       ----------------------------------------------------------------- */
    function tickClock() {
        const now = new Date();
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
        const dateEl = $('#heroDate');
        const clockEl = $('#heroClock');
        const greetEl = $('#heroGreeting');
        if (dateEl) dateEl.textContent = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 ' + week;
        if (clockEl) clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        if (greetEl) {
            const h = now.getHours();
            greetEl.textContent = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
        }
        const acctLast = $('#acctLast');
        if (acctLast) acctLast.textContent = '今天 ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    }

    /* -----------------------------------------------------------------
       标题栏 / 宿主桥接
       ----------------------------------------------------------------- */
    function handleWindowControl(action) {
        const labels = { minimize: '最小化', maximize: '最大化', close: '关闭' };
        const api = window.starLaunch && window.starLaunch.window;
        if (api && typeof api[action] === 'function') {
            api[action]();
            return;
        }
        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
            window.chrome.webview.postMessage({ type: 'window-control', action: action });
            return;
        }
        const event = new CustomEvent('starlaunch:window-control', { cancelable: true, detail: { action: action } });
        const handled = !window.dispatchEvent(event);
        if (!handled) toast('已发送「' + labels[action] + '」窗口指令', 'i-info');
    }

    function detectHost() {
        const ua = navigator.userAgent;
        const host = $('#heroHost');
        if (!host) return;
        let label = 'Windows 11';
        if (/Windows NT 10/.test(ua)) label = 'Windows 11';
        else if (/Windows NT 6\.3/.test(ua)) label = 'Windows 8.1';
        else if (/Mac OS X/.test(ua)) label = 'macOS';
        else if (/Linux/.test(ua)) label = 'Linux';
        if (/Edg\//.test(ua)) label += ' · Edge WebView2';
        host.textContent = label;

        const engine = $('#engineInfo');
        if (engine) {
            const match = ua.match(/Chrom(e|ium)\/(\d+)/);
            engine.textContent = match ? 'Chromium ' + match[2] : 'Chromium';
        }
    }

    /* -----------------------------------------------------------------
       路由
       ----------------------------------------------------------------- */
    function routeName() {
        const hash = (location.hash || '').replace(/^#\/?/, '');
        return Object.prototype.hasOwnProperty.call(ROUTES, hash) ? hash : 'home';
    }

    function applyRoute() {
        const name = routeName();
        const route = ROUTES[name];
        $$('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === name));
        $$('.rail-item[data-nav]').forEach((btn) => {
            const active = btn.dataset.nav === name;
            btn.classList.toggle('is-active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        const crumb = $('#tbCrumb');
        if (crumb) crumb.textContent = route.crumb;
        document.title = route.title;
        const stage = $('#stage');
        if (stage) stage.scrollTop = 0;
        closePopovers();
    }

    function go(view) {
        if (!ROUTES[view]) return;
        if (location.hash === '#' + view) applyRoute();
        else location.hash = view;
    }

    /* -----------------------------------------------------------------
       主页：实例
       ----------------------------------------------------------------- */
    function renderInstanceOptions() {
        const host = $('#instOptions');
        if (!host) return;
        host.innerHTML = INSTANCES.map((inst) => {
            const active = inst.id === ui.activeId;
            return '<button class="inst-option' + (active ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + active + '" data-pick="' + inst.id + '">' +
                '<span class="inst-option-tile tile--' + inst.tone + '" aria-hidden="true"><svg class="cube"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-option-copy">' +
                    '<span class="inst-option-name">' + escapeHtml(inst.name) + '</span>' +
                    '<span class="inst-option-meta">' + escapeHtml(inst.loader) + ' · ' + escapeHtml(inst.mc) + ' · ' + escapeHtml(modsLabel(inst)) + '</span>' +
                '</span>' +
                '<svg class="icon inst-option-check" aria-hidden="true"><use href="#i-check"/></svg>' +
            '</button>';
        }).join('');
        const count = $('#instCount');
        if (count) count.textContent = INSTANCES.length + ' 个';
    }

    function paintRange(input) {
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value || 0);
        const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--p', pct.toFixed(2) + '%');
    }

    function syncMem(inst) {
        const homeRange = $('#homeMemRange');
        const vRange = $('#vMemRange');
        const curText = $('#curMemText');
        const vLabel = $('#vMemLabel');
        if (curText) curText.textContent = inst.mem + ' / 32 GB';
        if (homeRange && inst.id === ui.activeId) { homeRange.value = String(inst.mem); paintRange(homeRange); }
        if (vRange && inst.id === ui.activeId) { vRange.value = String(inst.mem); paintRange(vRange); }
        if (vLabel) vLabel.textContent = inst.mem + ' GB';
        const row = $('[data-instance-row="' + inst.id + '"] .inst-row-side');
        if (row) row.textContent = inst.mem + ' GB';
    }

    function renderInstanceList() {
        const host = $('#instList');
        if (!host) return;
        host.innerHTML = INSTANCES.map((inst) => {
            const active = inst.id === ui.activeId;
            return '<article class="inst-row' + (active ? ' is-active' : '') + '" data-instance-row="' + inst.id + '" data-kind="' + inst.kind + '" tabindex="0" role="button" aria-pressed="' + active + '">' +
                '<span class="inst-row-tile tile--' + inst.tone + '" aria-hidden="true"><svg class="cube"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-row-main">' +
                    '<span class="inst-row-name">' + escapeHtml(inst.name) + '<span class="badge">' + escapeHtml(inst.loader) + '</span></span>' +
                    '<span class="inst-row-meta">' + escapeHtml(inst.mc) + ' · ' + escapeHtml(modsLabel(inst)) + ' · ' + escapeHtml(inst.last) + '</span>' +
                '</span>' +
                '<span class="inst-row-side num">' + inst.mem + ' GB</span>' +
                '<button class="icon-btn inst-row-more" type="button" data-toast="实例操作：设为默认 / 打开目录 / 删除" aria-label="更多操作">' +
                    '<svg class="icon"><use href="#i-more"/></svg>' +
                '</button>' +
            '</article>';
        }).join('');
        filterInstances();
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
        setText('#vJava', inst.java + ' · Microsoft');
        setText('#vLast', inst.last);
        setText('#vModsCount', inst.mods > 0 ? inst.mods + ' 个' : '无模组');

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
        let visible = 0;
        $$('[data-instance-row]').forEach((row) => {
            const inst = getInstance(row.dataset.instanceRow);
            const kindOk = ui.instFilter === 'all' || inst.kind === ui.instFilter;
            const text = (inst.name + ' ' + inst.mc + ' ' + inst.loader + ' ' + inst.loaderName).toLowerCase();
            const show = kindOk && (!query || text.indexOf(query) !== -1);
            row.hidden = !show;
            if (show) visible += 1;
        });
        const empty = $('#instEmpty');
        if (empty) empty.hidden = visible > 0;
    }

    /* -----------------------------------------------------------------
       浮层
       ----------------------------------------------------------------- */
    function closePopovers() {
        const instPop = $('#instPop');
        const instTrigger = $('#instPicker');
        if (instPop) instPop.hidden = true;
        if (instTrigger) instTrigger.setAttribute('aria-expanded', 'false');
        const slab = $('.slab--launch');
        if (slab) slab.classList.remove('is-expanded');
        const accountPop = $('#accountPop');
        const accountTrigger = $('#railAvatar');
        if (accountPop) accountPop.hidden = true;
        if (accountTrigger) accountTrigger.setAttribute('aria-expanded', 'false');
    }

    function positionAccountPop() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = pop.offsetWidth || 288;
        const left = Math.min(window.innerWidth - width - 14, rect.right + 12);
        pop.style.left = Math.max(14, left) + 'px';
        pop.style.bottom = Math.max(14, window.innerHeight - rect.bottom - 6) + 'px';
        pop.style.top = 'auto';
    }

    function toggleInstancePicker() {
        const pop = $('#instPop');
        const trigger = $('#instPicker');
        const slab = $('.slab--launch');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            renderInstanceOptions();
            const accountPop = $('#accountPop');
            if (accountPop) accountPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (slab) slab.classList.toggle('is-expanded', willOpen);
    }

    function toggleAccountPopover() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            const instPop = $('#instPop');
            if (instPop) instPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) positionAccountPop();
    }

    /* -----------------------------------------------------------------
       启动流程
       ----------------------------------------------------------------- */
    function clearLaunchTimers() {
        launchTimers.forEach((timer) => window.clearTimeout(timer));
        launchTimers = [];
    }

    function appendLaunchLog(line) {
        const log = $('#launchLog');
        if (!log) return;
        const p = document.createElement('p');
        p.textContent = line;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
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

    /* -----------------------------------------------------------------
       下载
       ----------------------------------------------------------------- */
    function renderDownloads() {
        const list = $('#dlList');
        if (!list) return;
        const query = (($('#dlSearch') && $('#dlSearch').value) || '').trim().toLowerCase();
        const items = DOWNLOADS.filter((item) => {
            if (item.cat !== ui.dlCat) return false;
            if (!query) return true;
            return (item.name + ' ' + item.sub + ' ' + item.size + ' ' + (item.badge || '')).toLowerCase().indexOf(query) !== -1;
        });

        list.innerHTML = items.map((item, index) => {
            const state = downloadState.get(item.id) || 'idle';
            const label = state === 'done' ? '已安装' : state === 'running' ? '安装中' : state === 'queued' ? '队列中' : DL_LABELS[item.cat][1];
            const disabled = state === 'idle' ? '' : ' disabled';
            const progress = state === 'running' ? '<span class="dl-progress"><i></i></span>' : '';
            return '<article class="dl-row' + (state !== 'idle' ? ' is-' + state : '') + '" style="--i:' + index + '">' +
                '<span class="dl-row-tile tone-' + item.tone + ' num">' + escapeHtml(item.tile) + '</span>' +
                '<div class="dl-row-main">' +
                    '<div class="dl-row-name">' + escapeHtml(item.name) +
                        (item.badge ? '<span class="pill pill--accent">' + escapeHtml(item.badge) + '</span>' : '') +
                    '</div>' +
                    '<div class="dl-row-sub">' + escapeHtml(item.sub) + '</div>' +
                    progress +
                '</div>' +
                '<div class="dl-row-side">' +
                    '<span class="dl-row-size num">' + escapeHtml(item.size) + '</span>' +
                    '<button class="btn btn-tonal btn-sm" type="button" data-download="' + item.id + '"' + disabled + '>' + label + '</button>' +
                '</div>' +
            '</article>';
        }).join('');

        const empty = $('#dlEmpty');
        if (empty) empty.hidden = items.length > 0;
        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + items.length + ' ' + DL_LABELS[ui.dlCat][0];
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
        const item = DOWNLOADS.find((entry) => entry.id === id);
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

    /* -----------------------------------------------------------------
       设置：外观
       ----------------------------------------------------------------- */
    function renderPalette() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;
        const tokens = theme.tokens;

        const strip = $('#paletteStrip');
        if (strip) {
            const ramp = tokens ? tokens.ramp : null;
            const groups = ramp
                ? [['primary', ramp.primary], ['secondary', ramp.secondary], ['tertiary', ramp.tertiary], ['neutral', ramp.neutral]]
                : [];
            strip.innerHTML = groups.map(([name, tones]) =>
                '<div class="palette-lane" data-lane="' + name + '">' +
                    tones.map((hex) => '<span style="background:' + hex + '" title="' + name + ' ' + hex + '"></span>').join('') +
                '</div>'
            ).join('');
        }

        const seedLabel = $('#seedLabel');
        if (seedLabel) {
            const variantLabel = (theme.variants.find((v) => v.id === state.variant) || { label: '' }).label;
            seedLabel.textContent = '源色 ' + state.seed.toUpperCase() + ' · ' + variantLabel + '变体 · ' + (theme.mode === 'dark' ? '深色' : '浅色');
        }

        const swatches = $('#seedSwatches');
        if (swatches) {
            swatches.innerHTML = theme.seeds.map((seed) =>
                '<button class="swatch' + (seed.value === state.seed ? ' is-active' : '') + '" type="button" role="radio" aria-checked="' + (seed.value === state.seed) + '" data-seed="' + seed.value + '" title="' + seed.label + '" style="--swatch:' + seed.value + '"></button>'
            ).join('');
        }

        const chips = $('#variantChips');
        if (chips) {
            chips.innerHTML = theme.variants.map((variant) =>
                '<button class="chip-toggle' + (variant.id === state.variant ? ' is-active' : '') + '" type="button" role="radio" aria-checked="' + (variant.id === state.variant) + '" data-variant="' + variant.id + '">' + variant.label + '</button>'
            ).join('');
        }

        const seedPick = $('#seedPick');
        if (seedPick) seedPick.value = state.seed;

        $$('#modeSeg [data-mode]').forEach((btn) => {
            const active = btn.dataset.mode === state.mode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('#rolePicker .role-row').forEach((row) => {
            const slot = row.dataset.role;
            $$('[data-role-value]', row).forEach((btn) => {
                const active = btn.dataset.roleValue === (state.roles[slot] || 'primary');
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', String(active));
            });
        });

        const paint = (inputSel, valueSel, value, format) => {
            const input = $(inputSel);
            const label = $(valueSel);
            if (input) { input.value = String(value); paintRange(input); }
            if (label) label.textContent = format(value);
        };
        paint('#glassRange', '#glassValue', state.glass, (v) => v + '%');
        paint('#blurRange', '#blurValue', state.blur, (v) => v + ' px');
        paint('#scrimRange', '#scrimValue', state.scrim, (v) => v + '%');
        paint('#glowRange', '#glowValue', state.glow, (v) => v + '%');
        paint('#contrastRange', '#contrastValue', state.contrast, (v) => (v > 0 ? '+' : '') + v);

        const perf = $('#perfSwitch');
        if (perf) perf.setAttribute('aria-checked', String(Boolean(state.performance)));
        const blurInput = $('#blurRange');
        if (blurInput) blurInput.disabled = Boolean(state.performance);
        const glowInput = $('#glowRange');
        if (glowInput) glowInput.disabled = Boolean(state.performance);
    }

    function bindAppearanceRange(inputSel, key, format) {
        const input = $(inputSel);
        if (!input) return;
        paintRange(input);
        input.addEventListener('input', () => {
            const value = Number(input.value);
            window.StarTheme.update({ [key]: value }, { silent: true });
            const label = $(inputSel.replace('Range', 'Value'));
            if (label && format) label.textContent = format(value);
            paintRange(input);
            renderPalette();
        });
        input.addEventListener('change', () => toast('已保存：' + input.getAttribute('aria-label'), 'i-check'));
    }

    /* -----------------------------------------------------------------
       设置：分组切换
       ----------------------------------------------------------------- */
    function setSettingsTab(tab) {
        ui.setTab = tab;
        writeStore(STORE.uiPrefs, ui);
        $$('#setNav [data-set-nav]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.setNav === tab));
        $$('[data-set-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.setPanel === tab));
        const stage = $('#stage');
        if (stage) stage.scrollTop = 0;
    }

    /* -----------------------------------------------------------------
       绑定
       ----------------------------------------------------------------- */
    function bind() {
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
                const code = $('#jvmCode');
                const text = code ? code.textContent.trim() : '';
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

        window.addEventListener('hashchange', applyRoute);
        window.addEventListener('resize', () => {
            const pop = $('#accountPop');
            if (pop && !pop.hidden) positionAccountPop();
        });

        /* 时钟 */
        tickClock();
        window.setInterval(tickClock, 20000);
        detectHost();

        /* 标题栏 */
        $$('.tb-btn[data-win]').forEach((btn) => {
            btn.addEventListener('click', () => handleWindowControl(btn.dataset.win));
        });

        /* 实例选择器 */
        const instPicker = $('#instPicker');
        if (instPicker) {
            instPicker.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleInstancePicker();
            });
        }

        /* 账户浮层 */
        const railAvatar = $('#railAvatar');
        if (railAvatar) {
            railAvatar.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleAccountPopover();
            });
        }
        const accountPop = $('#accountPop');
        if (accountPop) {
            accountPop.addEventListener('click', (event) => {
                if (event.target.closest('.pop-item, .link')) closePopovers();
            });
        }

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

        /* 内存滑杆（主页 + 详情页同一份数据） */
        ['#homeMemRange', '#vMemRange'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            paintRange(input);
            input.addEventListener('input', () => {
                const inst = activeInstance();
                inst.mem = Number(input.value);
                syncMem(inst);
                paintRange(input);
            });
            input.addEventListener('change', () => {
                toast('已为「' + activeInstance().name + '」分配 ' + activeInstance().mem + ' GB 内存', 'i-chip');
            });
        });

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

        /* 下载 */
        $$('[data-dl-tab]').forEach((btn) => btn.addEventListener('click', () => setDownloadCategory(btn.dataset.dlTab)));
        const dlSearch = $('#dlSearch');
        if (dlSearch) dlSearch.addEventListener('input', renderDownloads);
        $$('.source').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.source)));
        $$('[data-dl-source]').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.dlSource)));

        /* 设置：通用开关 */
        $$('.switch:not(#perfSwitch)').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('aria-checked') !== 'true';
                btn.setAttribute('aria-checked', String(next));
                const label = btn.getAttribute('aria-label') || '选项';
                toast(label + (next ? ' 已开启' : ' 已关闭'), next ? 'i-check' : 'i-info');
            });
        });

        /* 设置：性能模式 */
        const perfSwitch = $('#perfSwitch');
        if (perfSwitch) {
            perfSwitch.addEventListener('click', () => {
                const next = !window.StarTheme.state.performance;
                window.StarTheme.update({ performance: next });
                renderPalette();
                toast(next ? '性能模式已开启：模糊与泛光已关闭' : '性能模式已关闭', 'i-palette');
            });
        }

        /* 设置：外观滑杆 */
        bindAppearanceRange('#glassRange', 'glass', (v) => v + '%');
        bindAppearanceRange('#blurRange', 'blur', (v) => v + ' px');
        bindAppearanceRange('#scrimRange', 'scrim', (v) => v + '%');
        bindAppearanceRange('#glowRange', 'glow', (v) => v + '%');
        bindAppearanceRange('#contrastRange', 'contrast', (v) => (v > 0 ? '+' : '') + v);

        /* 设置：全局内存 */
        const memRange = $('#memRange');
        if (memRange) {
            paintRange(memRange);
            const updateMem = () => {
                const label = $('#memValue');
                if (label) label.textContent = memRange.value + ' GB';
                paintRange(memRange);
                launchPrefs.mem = Number(memRange.value);
                writeStore(STORE.launchPrefs, launchPrefs);
            };
            memRange.addEventListener('input', updateMem);
            updateMem();
        }

        /* 设置：并发数 */
        const concurrency = $('#concurrency');
        if (concurrency) {
            concurrency.value = String(launchPrefs.concurrency);
            paintRange(concurrency);
            const update = () => {
                const label = $('#concurrencyValue');
                if (label) label.textContent = concurrency.value;
                paintRange(concurrency);
                launchPrefs.concurrency = Number(concurrency.value);
                writeStore(STORE.launchPrefs, launchPrefs);
            };
            concurrency.addEventListener('input', update);
            update();
        }

        /* 设置：标题栏按钮位置 */
        $$('[data-win-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const center = btn.dataset.winStyle === 'center';
                const titlebar = $('#titlebar');
                if (titlebar) titlebar.classList.toggle('controls-center', center);
                $$('[data-win-style]').forEach((item) => {
                    const active = item === btn;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
            });
        });

        /* 设置：分组 */
        $$('#setNav [data-set-nav]').forEach((btn) => {
            btn.addEventListener('click', () => setSettingsTab(btn.dataset.setNav));
        });

        /* 设置：恢复默认 */
        const resetAll = $('#resetAll');
        if (resetAll) {
            resetAll.addEventListener('click', () => {
                window.StarTheme.update({
                    seed: '#7c6ce6', variant: 'tonalSpot', mode: 'auto', contrast: 0,
                    roles: { accent: 'primary', selected: 'primary', hero: 'primary' },
                    glass: 55, blur: 18, scrim: 24, glow: 18, performance: false
                });
                renderPalette();
                toast('已恢复默认外观', 'i-refresh');
            });
        }

        /* 设置：壁纸 */
        const bgPick = $('#bgPick');
        const bgInput = $('#bgInput');
        const bgReset = $('#bgReset');
        if (bgPick && bgInput) {
            bgPick.addEventListener('click', () => bgInput.click());
            bgInput.addEventListener('change', () => {
                const file = bgInput.files && bgInput.files[0];
                if (file) {
                    window.StarTheme.setWallpaper(file).then(() => {
                        renderPalette();
                        toast('壁纸已更新，配色已重新派生', 'i-palette');
                    }).catch((err) => toast(err.message || '壁纸设置失败', 'i-info'));
                }
                bgInput.value = '';
            });
        }
        if (bgReset) {
            bgReset.addEventListener('click', () => {
                window.StarTheme.setWallpaper(null);
                toast('已恢复默认背景', 'i-refresh');
            });
        }

        /* 从壁纸重新取色 */
        const seedFromWallpaper = $('#seedFromWallpaper');
        if (seedFromWallpaper) {
            seedFromWallpaper.addEventListener('click', () => {
                const theme = window.StarTheme;
                if (!theme.state.wallpaper) {
                    toast('还没有设置壁纸', 'i-info');
                    return;
                }
                toast('正在从壁纸取色…', 'i-palette');
                theme.setWallpaper(theme.state.wallpaper, { name: theme.state.wallpaperName }).then(() => renderPalette());
            });
        }

        /* 自定义源色 */
        const seedPick = $('#seedPick');
        if (seedPick) {
            seedPick.addEventListener('input', () => window.StarTheme.update({ seed: seedPick.value }, { silent: true }));
            seedPick.addEventListener('change', () => {
                renderPalette();
                toast('源色已更新为 ' + seedPick.value.toUpperCase(), 'i-palette');
            });
        }

        /* 公告已读 */
        const readAll = $('#readAllBtn');
        if (readAll) {
            readAll.addEventListener('click', () => {
                $$('.notice-item.is-unread').forEach((item) => item.classList.remove('is-unread'));
                const count = $('#unreadCount');
                if (count) count.textContent = '0 条未读';
                toast('全部公告已标记为已读');
            });
        }

        /* 换一句 */
        const quoteBtn = $('#quoteBtn');
        if (quoteBtn) {
            quoteBtn.addEventListener('click', () => {
                quoteIndex = (quoteIndex + 1) % QUOTES.length;
                const el = $('#heroQuote');
                if (el) el.textContent = QUOTES[quoteIndex];
                quoteBtn.classList.remove('is-spin');
                void quoteBtn.offsetWidth;
                quoteBtn.classList.add('is-spin');
            });
        }

        /* 重新检测硬件 */
        const refreshSys = $('#refreshSys');
        if (refreshSys) {
            refreshSys.addEventListener('click', () => {
                const now = new Date();
                const el = $('#sysTime');
                if (el) el.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
                toast('硬件信息已重新检测');
            });
        }

        /* 后台时暂停装饰动画 */
        document.addEventListener('visibilitychange', () => {
            document.documentElement.classList.toggle('is-idle', document.hidden);
        });

        /* 拖放壁纸 */
        let dragDepth = 0;
        const dropOverlay = $('#dropOverlay');
        const showDrop = (show) => { if (dropOverlay) dropOverlay.hidden = !show; };
        const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types || []).indexOf('Files') !== -1;
        window.addEventListener('dragenter', (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth += 1;
            showDrop(true);
        });
        window.addEventListener('dragover', (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });
        window.addEventListener('dragleave', () => {
            if (dragDepth > 0) dragDepth -= 1;
            if (dragDepth === 0) showDrop(false);
        });
        window.addEventListener('drop', (event) => {
            event.preventDefault();
            dragDepth = 0;
            showDrop(false);
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file) return;
            window.StarTheme.setWallpaper(file).then(() => {
                renderPalette();
                toast('壁纸已更换，配色已重新派生', 'i-palette');
            }).catch((err) => toast(err.message || '壁纸设置失败', 'i-info'));
        });

        /* 键盘 */
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const modal = $('#launchModal');
            if (modal && !modal.hidden) {
                closeLaunch();
                return;
            }
            closePopovers();
        });
    }

    /* -----------------------------------------------------------------
       初始化
       ----------------------------------------------------------------- */
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
        setSettingsTab(ui.setTab || 'appearance');
    }

    function init() {
        bind();
        initUiState();
        renderInstanceList();
        selectInstance(ui.activeId);
        renderDownloads();
        renderQueue();
        renderPalette();

        if (window.StarTheme) window.StarTheme.onChange(() => renderPalette());

        if (!location.hash) {
            try { history.replaceState(null, '', '#home'); } catch (err) { /* file:// 下可能被限制 */ }
        }
        applyRoute();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
