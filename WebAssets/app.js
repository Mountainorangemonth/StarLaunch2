/* =====================================================================
   StarLaunch · 交互脚本
   ---------------------------------------------------------------------
   · 无任何外部依赖，直接以 file:// 或 WebView2 / Electron 打开即可
   · 标题栏按钮会优先调用宿主 API：
       window.starLaunch.window.minimize / maximize / close
     也可以通过事件接管（宿主调用 event.preventDefault() 即可）：
       window.addEventListener('starlaunch:window-control', e => { ... })
     WebView2 下会自动 postMessage({ type: 'window-control', action })
   ===================================================================== */
(function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

    /* -----------------------------------------------------------------
       数据
       ----------------------------------------------------------------- */
    const INSTANCES = [
        {
            id: 'winter', name: '冬夜生存', tag: 'NeoForge', mc: '1.20.4', mods: 82,
            last: '2 小时前', mem: 8, java: '21.0.8', loader: 'NeoForge 20.4.237',
            path: 'D:\\Games\\.minecraft\\versions\\winter-night', tone: 'winter', kind: 'modded',
            modPreview: ['Create', 'JEI', 'Iris']
        },
        {
            id: 'sky', name: '天空工厂', tag: 'Fabric', mc: '1.21.1', mods: 46,
            last: '昨天 21:04', mem: 6, java: '21.0.8', loader: 'Fabric 0.16.5',
            path: 'D:\\Games\\.minecraft\\versions\\sky-factory', tone: 'sky', kind: 'modded',
            modPreview: ['Sodium', 'Lithium', 'Iris']
        },
        {
            id: 'vanilla', name: '原版 1.21.4', tag: 'Vanilla', mc: '1.21.4', mods: 0,
            last: '3 天前', mem: 4, java: '21.0.8', loader: 'Vanilla',
            path: 'D:\\Games\\.minecraft\\versions\\1.21.4', tone: 'vanilla', kind: 'vanilla',
            modPreview: []
        },
        {
            id: 'beta', name: '星辉旅人', tag: 'Forge', mc: '1.19.2', mods: 128,
            last: '尚未启动', mem: 10, java: '17.0.13', loader: 'Forge 43.4.0',
            path: 'D:\\Games\\.minecraft\\versions\\star-traveler', tone: 'beta', kind: 'modded',
            modPreview: ['Twilight Forest', 'Botania', 'JEI']
        },
        {
            id: 'depth', name: '深岩之下', tag: 'Fabric', mc: '1.20.6', mods: 37,
            last: '5 天前', mem: 6, java: '21.0.8', loader: 'Fabric 0.15.11',
            path: 'D:\\Games\\.minecraft\\versions\\deep-rock', tone: 'violet', kind: 'modded',
            modPreview: ['Create', "Farmer's Delight", 'Jade']
        },
        {
            id: 'diner', name: '像素餐厅', tag: 'Forge', mc: '1.18.2', mods: 210,
            last: '上周', mem: 12, java: '17.0.13', loader: 'Forge 40.2.21',
            path: 'D:\\Games\\.minecraft\\versions\\pixel-diner', tone: 'sunset', kind: 'modded',
            modPreview: ['Create', "Farmer's Delight", 'MineMenu']
        },
        {
            id: 'end', name: '末地远征', tag: 'Fabric', mc: '1.21.1', mods: 64,
            last: '3 周前', mem: 8, java: '21.0.8', loader: 'Fabric 0.16.5',
            path: 'D:\\Games\\.minecraft\\versions\\end-expedition', tone: 'sky', kind: 'modded',
            modPreview: ['End Remastered', 'Trinkets', 'Cloth Config']
        },
        {
            id: 'redstone', name: '红石工坊', tag: 'Forge', mc: '1.16.5', mods: 96,
            last: '1 个月前', mem: 8, java: '11.0.22', loader: 'Forge 36.2.39',
            path: 'D:\\Games\\.minecraft\\versions\\redstone-workshop', tone: 'beta', kind: 'modded',
            modPreview: ['Create', 'Immersive Engineering', 'ProjectE']
        },
        {
            id: 'creative', name: '创造沙盒', tag: 'Vanilla', mc: '1.21.1', mods: 0,
            last: '2 周前', mem: 4, java: '21.0.8', loader: 'Vanilla',
            path: 'D:\\Games\\.minecraft\\versions\\creative-sandbox', tone: 'vanilla', kind: 'vanilla',
            modPreview: []
        }
    ];

    const QUOTES = [
        ['「方块堆成星海，夜晚就有了归处。」', '—— 星语'],
        ['「先挖三块木头，再去想远方。」', '—— 老玩家'],
        ['「把家建在出生点，把梦建在云端。」', '—— 建筑师'],
        ['「世界没有存档，但今天可以重来。」', '—— 陌生旅人']
    ];

    const ROUTES = {
        home: { crumb: '启动', title: 'StarLaunch' },
        versions: { crumb: '版本管理', title: '版本管理 · StarLaunch' },
        download: { crumb: '下载', title: '下载中心 · StarLaunch' },
        settings: { crumb: '设置', title: '设置 · StarLaunch' }
    };

    const DEFAULT_APPEARANCE = { accent: 'blue', blur: 18, glass: 72, veil: 66, performance: false };
    const appearance = Object.assign({}, DEFAULT_APPEARANCE);

    let activeId = 'winter';
    let instFilter = 'all';
    let downloadCategory = 'version';
    let launchState = 'idle';
    let launchTimers = [];
    let lastFocus = null;
    let customWallpaperUrl = null;

    const getInstance = (id) => INSTANCES.find((item) => item.id === id) || INSTANCES[0];
    const modsLabel = (inst) => (inst.mods > 0 ? inst.mods + ' 个模组' : '无模组');
    const instCount = $('#instCount');
    if (instCount) instCount.textContent = INSTANCES.length + ' 个可用';

    /* -----------------------------------------------------------------
       Toast
       ----------------------------------------------------------------- */
    function showToast(message, icon) {
        const host = $('#toasts');
        if (!host) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + escapeHtml(message) + '</span>';
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-in'));
        while (host.children.length > 4) host.firstElementChild.remove();
        window.setTimeout(() => {
            el.classList.add('is-out');
            window.setTimeout(() => el.remove(), 280);
        }, 2600);
    }

    /* -----------------------------------------------------------------
       标题栏 / 时间 / 问候
       ----------------------------------------------------------------- */
    function pad2(n) { return String(n).padStart(2, '0'); }

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
            greetEl.textContent =
                h < 5 ? '夜深了' :
                h < 11 ? '早上好' :
                h < 13 ? '中午好' :
                h < 18 ? '下午好' : '晚上好';
        }
    }

    function handleWindowControl(action) {
        const api = window.starLaunch && window.starLaunch.window;
        if (api && typeof api[action] === 'function') {
            api[action]();
            return;
        }
        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
            window.chrome.webview.postMessage({ type: 'window-control', action: action });
            return;
        }
        const event = new CustomEvent('starlaunch:window-control', {
            cancelable: true,
            detail: { action: action }
        });
        const handled = !window.dispatchEvent(event);
        if (!handled) {
            const labels = { minimize: '最小化', maximize: '最大化', close: '关闭' };
            showToast('已发送「' + labels[action] + '」窗口指令', 'i-info');
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
        $$('.view').forEach((view) => {
            view.classList.toggle('is-active', view.dataset.view === name);
        });
        $$('.rail-btn[data-nav]').forEach((btn) => {
            const active = btn.dataset.nav === name;
            btn.classList.toggle('is-active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        const crumb = $('#tbCrumb');
        if (crumb) crumb.textContent = route.crumb;
        document.title = route.title;
        const main = $('#main');
        if (main) main.scrollTop = 0;
        closePopovers();
    }

    function go(view) {
        if (!ROUTES[view]) return;
        if (location.hash === '#' + view) applyRoute();
        else location.hash = view;
    }

    /* -----------------------------------------------------------------
       主页实例选择
       ----------------------------------------------------------------- */
    function renderInstanceOptions() {
        const host = $('#instOptions');
        if (!host) return;
        host.innerHTML = INSTANCES.map((inst) => {
            const active = inst.id === activeId;
            return '<button class="inst-option' + (active ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + active + '" data-pick="' + inst.id + '">' +
                '<span class="tile tile--' + inst.tone + '"><svg class="cube" aria-hidden="true"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-option-copy">' +
                    '<span class="inst-option-title">' + escapeHtml(inst.name) + ' <span class="badge">' + escapeHtml(inst.tag) + '</span></span>' +
                    '<span class="inst-option-meta">' + escapeHtml(inst.mc) + ' · ' + escapeHtml(modsLabel(inst)) + ' · ' + escapeHtml(inst.last) + '</span>' +
                '</span>' +
                '<svg class="icon inst-option-check" aria-hidden="true"><use href="#i-check"/></svg>' +
            '</button>';
        }).join('');
    }

    function paintRange(input) {
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value || 0);
        const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--p', pct.toFixed(2) + '%');
    }

    function syncInstanceMem(inst) {
        const rowSide = document.querySelector('[data-instance-row="' + inst.id + '"] .inst-row-side');
        if (rowSide) rowSide.textContent = inst.mem + ' GB 内存';
        const range = $('#vMemRange');
        const label = $('#vMemLabel');
        if (inst.id === activeId) {
            if (range) {
                range.value = String(inst.mem);
                paintRange(range);
            }
            if (label) label.textContent = inst.mem + ' GB';
        }
    }

    function selectInstance(id, options) {
        const inst = getInstance(id);
        activeId = inst.id;

        const nameEl = $('#curInstName');
        if (nameEl) nameEl.innerHTML = escapeHtml(inst.name) + ' <em>' + escapeHtml(inst.tag) + '</em>';
        const metaEl = $('#curInstMeta');
        if (metaEl) metaEl.textContent = inst.mc + ' · ' + modsLabel(inst) + ' · 上次启动 ' + inst.last;
        const memText = $('#curMemText');
        if (memText) memText.textContent = inst.mem + ' / 16 GB';
        const memFill = $('#curMemFill');
        if (memFill) memFill.style.width = clamp((inst.mem / 16) * 100, 4, 100).toFixed(1) + '%';
        const tile = $('#curInstTile');
        if (tile) tile.className = 'tile tile--' + inst.tone;

        $$('[data-instance-row]').forEach((row) => {
            row.classList.toggle('is-active', row.dataset.instanceRow === activeId);
        });

        const hero = $('#detailHero');
        if (hero) hero.dataset.tone = inst.tone;
        const setText = (sel, text) => {
            const el = $(sel);
            if (el) el.textContent = text;
        };
        setText('#vHeroMc', 'MINECRAFT ' + inst.mc.toUpperCase());
        setText('#vHeroName', inst.name);
        setText('#vName', inst.name);
        setText('#vPath', inst.path);
        setText('#vMc', 'Minecraft ' + inst.mc);
        setText('#vLoader', inst.loader);
        setText('#vMods', inst.mods > 0 ? inst.mods + ' 个' : '无模组');
        setText('#vJava', inst.java + ' · Microsoft');
        setText('#vLast', inst.last);
        setText('#vModsCount', inst.mods > 0 ? inst.mods + ' 个模组' : '无模组');

        const chips = $('#vModChips');
        if (chips) {
            if (inst.mods > 0) {
                const preview = (inst.modPreview || []).slice(0, 3);
                const rest = inst.mods - preview.length;
                chips.innerHTML = preview.map((name) => '<span>' + escapeHtml(name) + '</span>').join('') +
                    (rest > 0 ? '<span>+' + rest + '</span>' : '');
            } else {
                chips.innerHTML = '<span class="is-empty">纯净原版 · 未安装模组</span>';
            }
        }

        const range = $('#vMemRange');
        if (range) {
            range.value = String(inst.mem);
            paintRange(range);
        }
        setText('#vMemLabel', inst.mem + ' GB');
        syncInstanceMem(inst);
        renderInstanceOptions();

        if (options && options.toast) {
            showToast('已切换到「' + inst.name + '」');
        }
    }

    function filterInstances() {
        const query = ($('#instSearch') && $('#instSearch').value.trim().toLowerCase()) || '';
        let visible = 0;
        $$('[data-instance-row]').forEach((row) => {
            const inst = getInstance(row.dataset.instanceRow);
            const kindOk = instFilter === 'all' || row.dataset.kind === instFilter;
            const text = (inst.name + ' ' + inst.mc + ' ' + inst.tag + ' ' + inst.loader).toLowerCase();
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
    function setPopoverOpen(pop, trigger, open) {
        if (!pop) return;
        pop.hidden = !open;
        if (trigger) trigger.setAttribute('aria-expanded', String(open));
        if (open && pop.id === 'accountPop') positionAccountPop();
    }

    function closePopovers() {
        const instPop = $('#instPop');
        const instTrigger = $('#instPicker');
        if (instPop) instPop.hidden = true;
        if (instTrigger) instTrigger.setAttribute('aria-expanded', 'false');
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
        const width = pop.offsetWidth || 280;
        const left = Math.min(window.innerWidth - width - 12, rect.right + 14);
        pop.style.left = Math.max(12, left) + 'px';
        pop.style.bottom = Math.max(12, window.innerHeight - rect.bottom - 4) + 'px';
    }

    function toggleInstancePicker() {
        const pop = $('#instPop');
        const trigger = $('#instPicker');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) renderInstanceOptions();
        setPopoverOpen(pop, trigger, willOpen);
        if (willOpen) {
            const accountPop = $('#accountPop');
            if (accountPop) accountPop.hidden = true;
            const first = pop.querySelector('.inst-option');
            if (first) first.focus({ preventScroll: true });
        }
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
        setPopoverOpen(pop, trigger, willOpen);
    }

    /* -----------------------------------------------------------------
       启动流程
       ----------------------------------------------------------------- */
    function clearLaunchTimers() {
        launchTimers.forEach((timer) => window.clearTimeout(timer));
        launchTimers = [];
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
        if (wasRunning) showToast('已取消启动', 'i-info');
        if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
            lastFocus.focus({ preventScroll: true });
        }
        lastFocus = null;
    }

    function appendLaunchLog(line) {
        const log = $('#launchLog');
        if (!log) return;
        const p = document.createElement('p');
        p.textContent = line;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
    }

    function startLaunch() {
        const inst = getInstance(activeId);
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
        const go = $('#launchGo');
        const cancel = $('#launchCancel');

        if (title) title.textContent = '正在启动 ' + inst.name;
        if (meta) meta.textContent = inst.loader + ' · Minecraft ' + inst.mc + ' · ' + inst.mem + ' GB · Java ' + inst.java;
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            void bar.offsetWidth;
            bar.style.transition = '';
        }
        if (status) status.textContent = '正在准备启动…';
        if (pct) pct.textContent = '0%';
        if (log) log.innerHTML = '';
        if (go) go.hidden = true;
        if (cancel) cancel.textContent = '取消';

        const steps = [
            { p: 18, label: '正在校验游戏文件…', log: '· 校验 ' + (inst.mods > 0 ? '1,284' : '684') + ' 个文件' },
            { p: 44, label: '正在加载加载器与模组…', log: '· ' + inst.loader + ' · ' + modsLabel(inst) },
            { p: 68, label: '正在分配内存…', log: '· 分配 ' + inst.mem + ' GB 堆内存 · Java ' + inst.java },
            { p: 90, label: '正在启动 Java 进程…', log: '· ' + inst.path },
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
                    if (go) go.hidden = false;
                    if (cancel) cancel.textContent = '关闭';
                    if (go) go.focus({ preventScroll: true });
                }
            }, 520 * (index + 1));
            launchTimers.push(timer);
        });

        const cancelBtn = $('#launchCancel');
        if (cancelBtn) cancelBtn.focus({ preventScroll: true });
    }

    /* -----------------------------------------------------------------
       下载
       ----------------------------------------------------------------- */
    const DOWNLOAD_LABELS = {
        version: '个版本',
        modpack: '个整合包',
        mod: '个模组',
        resource: '个资源包'
    };

    const DOWNLOAD_DATA = [
        { id: 'mc-1214', cat: 'version', name: 'Minecraft 1.21.4', sub: '冬季更新 · 正式版 · 2024-12-03 · Java 21', size: '386 MB', tile: '1.21.4', tone: 'tone-a', action: '安装', badge: '最新' },
        { id: 'mc-1211', cat: 'version', name: 'Minecraft 1.21.1', sub: '正式版 · 2024-08-08 · Java 21', size: '372 MB', tile: '1.21.1', tone: 'tone-e', action: '安装' },
        { id: 'mc-1206', cat: 'version', name: 'Minecraft 1.20.6', sub: '正式版 · 2024-04-29 · Java 21', size: '358 MB', tile: '1.20.6', tone: 'tone-b', action: '安装' },
        { id: 'mc-1201', cat: 'version', name: 'Minecraft 1.20.1', sub: '模组黄金版 · 2023-06-12 · Java 17', size: '312 MB', tile: '1.20.1', tone: 'tone-d', action: '安装', badge: '热门' },
        { id: 'mc-1192', cat: 'version', name: 'Minecraft 1.19.2', sub: '稳定版 · 2022-08-05 · Java 17', size: '298 MB', tile: '1.19.2', tone: 'tone-f', action: '安装' },
        { id: 'mc-1165', cat: 'version', name: 'Minecraft 1.16.5', sub: '经典版 · 2021-01-15 · Java 11', size: '264 MB', tile: '1.16.5', tone: 'tone-c', action: '安装' },
        { id: 'pack-winter', cat: 'modpack', name: '冬夜生存', sub: 'NeoForge 1.20.4 · 82 个模组', size: '1.8 GB', tile: '冬夜', tone: 'tone-dark', action: '安装', badge: '推荐' },
        { id: 'pack-sky', cat: 'modpack', name: '天空工厂', sub: 'Fabric 1.21.1 · 空岛整合 · 46 个模组', size: '960 MB', tile: '天空', tone: 'tone-sky', action: '安装' },
        { id: 'pack-star', cat: 'modpack', name: '星辉旅人', sub: 'Forge 1.19.2 · 冒险整合 · 128 个模组', size: '2.4 GB', tile: '星辉', tone: 'tone-violet', action: '安装' },
        { id: 'mod-sodium', cat: 'mod', name: 'Sodium 钠', sub: 'Fabric 1.21.x · 渲染优化', size: '1.2 MB', tile: 'Na', tone: 'tone-mint', action: '添加' },
        { id: 'mod-iris', cat: 'mod', name: 'Iris Shaders', sub: 'Fabric 1.21.x · 光影加载', size: '6.8 MB', tile: 'Iris', tone: 'tone-sunset', action: '添加' },
        { id: 'mod-jei', cat: 'mod', name: 'JEI 物品管理器', sub: 'Forge 1.20.x · 实用工具', size: '3.4 MB', tile: 'JEI', tone: 'tone-a', action: '添加' },
        { id: 'mod-create', cat: 'mod', name: 'Create 机械动力', sub: 'Forge 1.20.1 · 科技模组', size: '18.6 MB', tile: 'C+', tone: 'tone-b', action: '添加' },
        { id: 'rp-dawn', cat: 'resource', name: '晨曦 128×', sub: '通用 · 1.20+ · 清新光影向', size: '64 MB', tile: '晨', tone: 'tone-sunset', action: '下载' },
        { id: 'rp-mint', cat: 'resource', name: '薄荷 64×', sub: '通用 · 1.20+ · 清爽低配向', size: '28 MB', tile: '薄荷', tone: 'tone-mint', action: '下载' }
    ];

    const downloadStates = new Map();

    function renderDownloads() {
        const list = $('#dlList');
        if (!list) return;
        const query = ($('#dlSearch') && $('#dlSearch').value.trim().toLowerCase()) || '';
        const items = DOWNLOAD_DATA.filter((item) => {
            if (item.cat !== downloadCategory) return false;
            if (!query) return true;
            return (item.name + ' ' + item.sub + ' ' + item.size + ' ' + (item.badge || '')).toLowerCase().indexOf(query) !== -1;
        });

        list.innerHTML = items.map((item, index) => {
            const state = downloadStates.get(item.id) || 'idle';
            const action = state === 'done' ? '已安装' : state === 'running' ? '安装中' : state === 'queued' ? '队列中' : item.action;
            const disabled = state !== 'idle' ? ' disabled' : '';
            const progress = state === 'running' ? '<span class="dl-progress"><i></i></span>' : '';
            return '<article class="dl-row' + (state !== 'idle' ? ' is-' + state : '') + '" style="--i:' + index + '">' +
                '<span class="dl-row-tile ' + item.tone + '">' + escapeHtml(item.tile) + '</span>' +
                '<div class="dl-row-main">' +
                    '<div class="dl-row-title">' + escapeHtml(item.name) +
                        (item.badge ? '<span class="tag-pill">' + escapeHtml(item.badge) + '</span>' : '') +
                    '</div>' +
                    '<div class="dl-row-sub">' + escapeHtml(item.sub) + '</div>' +
                    progress +
                '</div>' +
                '<div class="dl-row-side">' +
                    '<span class="dl-size">' + escapeHtml(item.size) + '</span>' +
                    '<button class="btn btn-ghost dl-action' + (state === 'done' ? ' is-done' : '') + '" type="button" data-download="' + item.id + '"' + disabled + '>' + action + '</button>' +
                '</div>' +
            '</article>';
        }).join('');

        const empty = $('#dlEmpty');
        if (empty) empty.hidden = items.length > 0;
        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + items.length + ' ' + DOWNLOAD_LABELS[downloadCategory];
    }

    function startDownload(id) {
        const item = DOWNLOAD_DATA.find((entry) => entry.id === id);
        if (!item) return;
        const state = downloadStates.get(id);
        if (state === 'queued' || state === 'running') return;
        if (state === 'done') downloadStates.delete(id);

        downloadStates.set(id, 'queued');
        renderDownloads();
        showToast('已加入安装队列：' + item.name, 'i-download');

        const timer1 = window.setTimeout(() => {
            if (downloadStates.get(id) !== 'queued') return;
            downloadStates.set(id, 'running');
            renderDownloads();
        }, 480);
        const timer2 = window.setTimeout(() => {
            if (downloadStates.get(id) !== 'running') return;
            downloadStates.set(id, 'done');
            renderDownloads();
            showToast('安装完成：' + item.name, 'i-check');
        }, 2300);
    }

    function setDownloadCategory(category) {
        downloadCategory = category;
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === category;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        renderDownloads();
    }

    function selectDownloadSource(name) {
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
       设置 / 外观
       ----------------------------------------------------------------- */
    function loadAppearance() {
        try {
            const raw = localStorage.getItem('starlaunch.appearance.v2');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                if (['blue', 'sakura', 'mint'].indexOf(parsed.accent) !== -1) appearance.accent = parsed.accent;
                if (Number.isFinite(parsed.blur)) appearance.blur = clamp(parsed.blur, 0, 40);
                if (Number.isFinite(parsed.glass)) appearance.glass = clamp(parsed.glass, 40, 92);
                if (Number.isFinite(parsed.veil)) appearance.veil = clamp(parsed.veil, 0, 100);
                appearance.performance = parsed.performance === true;
            }
        } catch (err) { /* 本地存储不可用时静默使用默认值 */ }
    }

    function saveAppearance() {
        try {
            localStorage.setItem('starlaunch.appearance.v2', JSON.stringify(appearance));
        } catch (err) { /* 忽略 */ }
    }

    function applyAppearance(persist) {
        const root = document.documentElement;
        root.dataset.accent = appearance.accent;
        root.dataset.performance = appearance.performance ? 'on' : 'off';
        root.style.setProperty('--blur', appearance.blur + 'px');
        root.style.setProperty('--glass-a', (appearance.glass / 100).toFixed(2));
        root.style.setProperty('--veil-a', (appearance.veil / 100).toFixed(2));

        const bind = (inputSel, labelSel, value, format) => {
            const input = $(inputSel);
            const label = $(labelSel);
            if (input) {
                input.value = String(value);
                paintRange(input);
            }
            if (label) label.textContent = format(value);
        };
        bind('#blurRange', '#blurValue', appearance.blur, (v) => v + ' px');
        bind('#glassRange', '#glassValue', appearance.glass, (v) => v + '%');
        bind('#veilRange', '#veilValue', appearance.veil, (v) => v + '%');
        const blurInput = $('#blurRange');
        if (blurInput) blurInput.disabled = Boolean(appearance.performance);
        const perfSwitch = $('#perfSwitch');
        if (perfSwitch) perfSwitch.setAttribute('aria-checked', String(Boolean(appearance.performance)));
        $$('.swatch[data-accent]').forEach((btn) => {
            btn.setAttribute('aria-checked', String(btn.dataset.accent === appearance.accent));
        });
        if (persist) saveAppearance();
    }

    function setWallpaper(src) {
        const layer = $('#wallpaperLayer');
        const img = $('#wallpaperImg');
        if (!img) return;
        if (layer) layer.classList.remove('is-photo');
        img.src = src;
        if (img.complete && img.naturalWidth > 0 && layer) layer.classList.add('is-photo');
    }

    function initWallpaper() {
        const layer = $('#wallpaperLayer');
        const img = $('#wallpaperImg');
        if (!img) return;
        img.addEventListener('load', () => {
            if (layer && img.naturalWidth > 0) layer.classList.add('is-photo');
            const preview = $('#bgPreview');
            if (preview && !customWallpaperUrl && img.currentSrc) {
                preview.style.backgroundImage = 'url("' + img.currentSrc + '")';
            }
        });
        img.addEventListener('error', () => {
            if (layer) layer.classList.remove('is-photo');
        });
        if (img.complete) {
            if (img.naturalWidth > 0) {
                if (layer) layer.classList.add('is-photo');
                const preview = $('#bgPreview');
                if (preview && !customWallpaperUrl && img.currentSrc) {
                    preview.style.backgroundImage = 'url("' + img.currentSrc + '")';
                }
            } else if (layer) {
                layer.classList.remove('is-photo');
            }
        }
    }

    /**
     * 把选择的壁纸先按最长边 2560px 重采样并转成 WebP，
     * 避免 4K PNG 原图常驻显存 / 解码缓存。
     */
    async function applyWallpaperFile(file) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
            showToast('请选择 PNG / JPG / WebP 图片', 'i-info');
            return;
        }

        let nextUrl = null;
        try {
            const bitmap = await createImageBitmap(file);
            const maxWidth = 2560;
            const scale = Math.min(1, maxWidth / bitmap.width);
            const needsCompress = scale < 1 || file.size > 2.5 * 1024 * 1024;
            if (needsCompress) {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const ctx = canvas.getContext('2d', { alpha: false });
                if (ctx) {
                    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
                    if (blob) nextUrl = URL.createObjectURL(blob);
                }
                canvas.width = 0;
                canvas.height = 0;
            }
            bitmap.close();
        } catch (err) {
            // 浏览器不支持 createImageBitmap / webp 时退回原图
        }

        if (!nextUrl) nextUrl = URL.createObjectURL(file);
        const previous = customWallpaperUrl;
        customWallpaperUrl = nextUrl;
        setWallpaper(nextUrl);
        const preview = $('#bgPreview');
        if (preview) preview.style.backgroundImage = 'url("' + nextUrl + '")';
        if (previous) URL.revokeObjectURL(previous);
        showToast('背景已更新（仅本次预览）', 'i-palette');
    }

    /* -----------------------------------------------------------------
       绑定
       ----------------------------------------------------------------- */
    function bind() {
        /* 路由 */
        document.addEventListener('click', (event) => {
            const nav = event.target.closest('[data-nav]');
            if (nav) {
                event.preventDefault();
                go(nav.dataset.nav);
                return;
            }
            const link = event.target.closest('[data-nav-link]');
            if (link) {
                event.preventDefault();
                go(link.dataset.navLink);
                return;
            }
            const toastBtn = event.target.closest('[data-toast]');
            if (toastBtn) showToast(toastBtn.dataset.toast);

            if (!event.target.closest('#instPop') && !event.target.closest('#instPicker')) {
                const pop = $('#instPop');
                const trigger = $('#instPicker');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
            if (!event.target.closest('#accountPop') && !event.target.closest('#railAvatar')) {
                const pop = $('#accountPop');
                const trigger = $('#railAvatar');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
        });

        window.addEventListener('hashchange', applyRoute);
        window.addEventListener('resize', () => {
            const pop = $('#accountPop');
            if (pop && !pop.hidden) positionAccountPop();
        });

        /* 时钟与问候 */
        tickClock();
        window.setInterval(tickClock, 20000);

        /* 标题栏窗口按钮 */
        $$('.tb-btn[data-win]').forEach((btn) => {
            btn.addEventListener('click', () => handleWindowControl(btn.dataset.win));
        });

        /* 实例选择 */
        const instPicker = $('#instPicker');
        if (instPicker) {
            instPicker.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleInstancePicker();
            });
        }
        const instOptions = $('#instOptions');
        if (instOptions) {
            instOptions.addEventListener('click', (event) => {
                const option = event.target.closest('[data-pick]');
                if (!option) return;
                selectInstance(option.dataset.pick, { toast: true });
                closePopovers();
                if (instPicker) instPicker.focus({ preventScroll: true });
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
                if (event.target.closest('.pop-item, .link-btn')) closePopovers();
            });
        }

        /* 版本列表 */
        $$('[data-instance-row]').forEach((row) => {
            const activate = () => selectInstance(row.dataset.instanceRow);
            row.addEventListener('click', (event) => {
                if (event.target.closest('[data-toast]')) return;
                activate();
            });
            row.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            });
        });
        const instSearch = $('#instSearch');
        if (instSearch) instSearch.addEventListener('input', filterInstances);
        $$('[data-inst-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                instFilter = btn.dataset.instFilter;
                $$('[data-inst-filter]').forEach((item) => {
                    const active = item === btn;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
                filterInstances();
            });
        });

        /* 版本详情内存 */
        const memRange = $('#vMemRange');
        if (memRange) {
            memRange.addEventListener('input', () => {
                const inst = getInstance(activeId);
                inst.mem = Number(memRange.value);
                paintRange(memRange);
                const label = $('#vMemLabel');
                if (label) label.textContent = inst.mem + ' GB';
                const homeMem = $('#curMemText');
                if (homeMem) homeMem.textContent = inst.mem + ' / 16 GB';
                const fill = $('#curMemFill');
                if (fill) fill.style.width = clamp((inst.mem / 16) * 100, 4, 100).toFixed(1) + '%';
                syncInstanceMem(inst);
                showToast('已为「' + inst.name + '」分配 ' + inst.mem + ' GB 内存', 'i-memory');
            });
        }

        /* 启动 */
        $$('[data-launch]').forEach((btn) => {
            btn.addEventListener('click', startLaunch);
        });
        $$('[data-close-modal]').forEach((el) => {
            el.addEventListener('click', closeLaunch);
        });
        const launchGo = $('#launchGo');
        if (launchGo) {
            launchGo.addEventListener('click', () => {
                const inst = getInstance(activeId);
                closeLaunch();
                showToast('已进入「' + inst.name + '」，祝你好运', 'i-play');
            });
        }

        /* 下载 */
        $$('[data-dl-tab]').forEach((btn) => {
            btn.addEventListener('click', () => setDownloadCategory(btn.dataset.dlTab));
        });
        const dlSearch = $('#dlSearch');
        if (dlSearch) dlSearch.addEventListener('input', renderDownloads);
        document.addEventListener('click', (event) => {
            const downloadButton = event.target.closest('[data-download]');
            if (downloadButton) {
                event.preventDefault();
                startDownload(downloadButton.dataset.download);
            }
        });
        $$('.source').forEach((btn) => {
            btn.addEventListener('click', () => selectDownloadSource(btn.dataset.source));
        });
        $$('[data-dl-source]').forEach((btn) => {
            btn.addEventListener('click', () => selectDownloadSource(btn.dataset.dlSource));
        });

        /* 设置：开关 */
        $$('.switch:not(#perfSwitch)').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('aria-checked') !== 'true';
                btn.setAttribute('aria-checked', String(next));
            });
        });

        /* 设置：性能模式 */
        const perfSwitch = $('#perfSwitch');
        if (perfSwitch) {
            perfSwitch.addEventListener('click', () => {
                appearance.performance = !appearance.performance;
                applyAppearance(true);
                showToast(appearance.performance ? '性能模式已开启：毛玻璃与背景动画已关闭' : '性能模式已关闭', 'i-palette');
            });
        }

        /* 设置：内存 */
        const settingsMem = $('#memRange');
        if (settingsMem) {
            paintRange(settingsMem);
            const updateMem = () => {
                const label = $('#memValue');
                if (label) label.textContent = settingsMem.value + ' GB';
                paintRange(settingsMem);
            };
            settingsMem.addEventListener('input', updateMem);
            updateMem();
        }

        /* 设置：外观滑杆 */
        const bindAppearanceRange = (inputSel, key, echo) => {
            const input = $(inputSel);
            if (!input) return;
            paintRange(input);
            input.addEventListener('input', () => {
                appearance[key] = Number(input.value);
                applyAppearance(true);
                if (echo) echo(Number(input.value));
            });
        };
        bindAppearanceRange('#blurRange', 'blur');
        bindAppearanceRange('#glassRange', 'glass');
        bindAppearanceRange('#veilRange', 'veil');

        $$('.swatch[data-accent]').forEach((btn) => {
            btn.addEventListener('click', () => {
                appearance.accent = btn.dataset.accent;
                applyAppearance(true);
                showToast('主题色已切换为' + ({ blue: '天蓝', sakura: '樱粉', mint: '薄荷' }[appearance.accent]), 'i-palette');
            });
        });
        const resetAppearance = $('#resetAppearance');
        if (resetAppearance) {
            resetAppearance.addEventListener('click', () => {
                Object.assign(appearance, DEFAULT_APPEARANCE);
                applyAppearance(true);
                showToast('外观已恢复默认');
            });
        }

        /* 设置：背景图 */
        const bgPick = $('#bgPick');
        const bgInput = $('#bgInput');
        const bgReset = $('#bgReset');
        const bgPreview = $('#bgPreview');
        if (bgPick && bgInput) {
            bgPick.addEventListener('click', () => bgInput.click());
            bgInput.addEventListener('change', () => {
                const file = bgInput.files && bgInput.files[0];
                if (file) applyWallpaperFile(file);
                bgInput.value = '';
            });
        }
        if (bgReset) {
            bgReset.addEventListener('click', () => {
                if (customWallpaperUrl) {
                    URL.revokeObjectURL(customWallpaperUrl);
                    customWallpaperUrl = null;
                }
                setWallpaper('assets/wallpaper.png');
                if (bgPreview) bgPreview.style.backgroundImage = '';
                showToast('已恢复默认背景', 'i-refresh');
            });
        }

        /* 设置：标题栏按钮位置 */
        $$('[data-win-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const center = btn.dataset.winStyle === 'center';
                $('#titlebar').classList.toggle('controls-center', center);
                $$('[data-win-style]').forEach((item) => {
                    const active = item === btn;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
            });
        });

        /* 设置：并发数 */
        const concurrency = $('#concurrency');
        if (concurrency) {
            paintRange(concurrency);
            const update = () => {
                const label = $('#concurrencyValue');
                if (label) label.textContent = concurrency.value;
                paintRange(concurrency);
            };
            concurrency.addEventListener('input', update);
            update();
        }

        /* 公告 */
        const readAll = $('#readAllBtn');
        if (readAll) {
            readAll.addEventListener('click', () => {
                $$('.notice-item.is-unread').forEach((item) => item.classList.remove('is-unread'));
                const count = $('.unread-count');
                if (count) count.innerHTML = '<i></i>0 条未读';
                showToast('全部公告已标记为已读', 'i-check');
            });
        }

        /* 换一句 */
        let quoteIndex = 0;
        const quoteBtn = $('#quoteBtn');
        if (quoteBtn) {
            quoteBtn.addEventListener('click', () => {
                quoteIndex = (quoteIndex + 1) % QUOTES.length;
                const text = $('.hero-quote > span:first-child');
                const by = $('.quote-by');
                if (text) text.textContent = QUOTES[quoteIndex][0];
                if (by) by.textContent = QUOTES[quoteIndex][1];
                quoteBtn.classList.remove('is-spinning');
                void quoteBtn.offsetWidth;
                quoteBtn.classList.add('is-spinning');
            });
        }

        /* 最小化 / 切后台时暂停装饰动画，减少后台占用 */
        document.addEventListener('visibilitychange', () => {
            document.documentElement.classList.toggle('is-hidden', document.hidden);
        });

        /* 拖放图片直接更换壁纸 */
        let dragDepth = 0;
        const dropOverlay = $('#dropOverlay');
        const showDropOverlay = (show) => {
            if (dropOverlay) dropOverlay.hidden = !show;
        };
        window.addEventListener('dragenter', (event) => {
            if (!event.dataTransfer || Array.from(event.dataTransfer.types).indexOf('Files') === -1) return;
            event.preventDefault();
            dragDepth += 1;
            showDropOverlay(true);
        });
        window.addEventListener('dragover', (event) => {
            if (!event.dataTransfer || Array.from(event.dataTransfer.types).indexOf('Files') === -1) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });
        window.addEventListener('dragleave', () => {
            if (dragDepth > 0) dragDepth -= 1;
            if (dragDepth === 0) showDropOverlay(false);
        });
        window.addEventListener('drop', (event) => {
            event.preventDefault();
            dragDepth = 0;
            showDropOverlay(false);
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) applyWallpaperFile(file);
        });

        /* 键盘关闭 */
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
    function init() {
        loadAppearance();
        applyAppearance(false);
        initWallpaper();
        bind();
        selectInstance(activeId);
        filterInstances();
        renderDownloads();
        if (!location.hash) {
            try { history.replaceState(null, '', '#home'); } catch (err) { /* ignore */ }
        }
        applyRoute();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
