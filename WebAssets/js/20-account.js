/* =====================================================================
   StarLaunch · 账户
   ---------------------------------------------------------------------
   三种登录方式（微软 / 外置 authlib-injector / 离线）、账号切换、头像。

   数据来源：宿主 /api/accounts（账号列表 + 选中的那个 + 微软应用 ID 配置）。
   令牌一律不出宿主，网页只拿到展示字段。

   登录动作全走 postMessage：
     account-login        发 {method, ...}
     ms-device            宿主回设备代码（要显示给用户的 user_code）
     ms-progress          微软登录的阶段提示
     account-login        结果（ok / error / need-profile 的角色列表）
     accounts-changed     档案变了（列表、选中项）
   浏览器预览（没有宿主）时只能离线登录，账号存在 localStorage 里。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, escapeHtml, STORE, readStore, writeStore } = SL.core;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const hostMod = SL.core.mod('host');
    const hasHost = () => (typeof hostMod.hasHost === 'function' ? hostMod.hasHost() : false);
    const hostPost = (message) => (typeof hostMod.hostPost === 'function' ? hostMod.hostPost(message) : false);

    const TYPE_LABEL = { ms: '微软账户', authlib: '外置登录', offline: '离线登录' };
    const AUTH_PRESETS = [
        { value: 'https://littleskin.cn/api/yggdrasil', label: 'LittleSkin' },
        { value: 'https://skin.prinzeugen.net/api/yggdrasil', label: 'Blessing Skin' }
    ];

    const state = {
        loaded: false,
        accounts: [],
        selected: null,
        hasClientId: false,
        clientId: '',
        clientIdFromEnv: false,
        builtInClientId: false,
        isPreview: false,
        authority: 'consumers',
        logins: [],              // 账号文件路径（设置里显示）
        loginTab: 'ms',
        loginOpen: false,
        device: null,            // { loginId, userCode, verificationUri }
        official: { checked: [], found: [], busy: false },   // 官方启动器导入
        importPending: false,
        profiles: null,          // 需要选角色时的候选
        pendingServer: '',
        busy: '',
        skinBust: 0,
        preview: readStore(STORE.accountPrefs, { accounts: [], selected: '' })
    };

    /* -----------------------------------------------------------------
       工具
       ----------------------------------------------------------------- */
    function typeLabel(view) {
        if (!view) return '—';
        if (view.type === 'authlib') return view.serverName || '外置登录';
        return TYPE_LABEL[view.type] || '账户';
    }

    function shortUuid(view) {
        if (!view) return '—';
        const dashed = view.uuidDashed || '';
        return dashed.length >= 13 ? dashed.slice(0, 8) + '…' + dashed.slice(-4) : (view.uuid || '—');
    }

    function formatTime(ts) {
        if (!ts) return '—';
        const date = new Date(Number(ts));
        if (Number.isNaN(date.getTime())) return '—';
        const pad = (n) => String(n).padStart(2, '0');
        const hm = pad(date.getHours()) + ':' + pad(date.getMinutes());
        const now = new Date();
        const stamp = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        if (stamp(date) === stamp(now)) return '今天 ' + hm;
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (stamp(date) === stamp(yesterday)) return '昨天 ' + hm;
        return (date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + hm;
    }

    function skinUrl(view) {
        if (!view || !view.hasSkin) return '';
        const bust = state.skinBust ? '&t=' + state.skinBust : '';
        return '/api/skin?account=' + encodeURIComponent(view.id) + bust;
    }

    /** 把皮肤贴到某个头像上：没有皮肤就显示内置的小人。 */
    function paintAvatar(fallbackEl, layerEl, view) {
        const url = skinUrl(view);
        if (layerEl) {
            if (url) {
                layerEl.style.backgroundImage = 'url("' + url + '")';
                layerEl.hidden = false;
            } else {
                layerEl.style.backgroundImage = '';
                layerEl.hidden = true;
            }
            layerEl.setAttribute('data-model', (view && view.skinModel) || 'classic');
        }
        if (fallbackEl) fallbackEl.style.opacity = url ? '0' : '1';
    }

    function statusOf(view) {
        if (!view) return { text: '未登录', tone: '' };
        if (view.expired) return { text: '登录已过期', tone: 'is-warn' };
        return { text: '已登录', tone: 'is-ok' };
    }

    /* -----------------------------------------------------------------
       渲染：主页账户卡 / 侧栏头像 / 账户菜单
       ----------------------------------------------------------------- */
    function renderSlab() {
        const view = state.selected;

        const ring = $('#acctAvatar');
        const name = $('#acctName');
        const uuid = $('#acctUuid');
        const tags = $('#acctTags');
        const stateEl = $('#acctState');
        const typeEl = $('#acctType');
        const lastEl = $('#acctLast');
        const online = $('#acctOnline');
        const action = $('#acctAction');

        if (!view) {
            if (name) name.textContent = '未登录';
            if (uuid) uuid.textContent = '—';
            if (tags) tags.innerHTML = '<span class="acct-tag">登录后可使用正版皮肤与联机</span>';
            if (stateEl) { stateEl.textContent = '未登录'; stateEl.className = ''; }
            if (typeEl) typeEl.textContent = '—';
            if (lastEl) { lastEl.textContent = '—'; delete lastEl.dataset.source; }
            if (ring) ring.style.setProperty('--xp', '0%');
            if (online) online.hidden = true;
            if (action) {
                action.dataset.accountAction = 'login';
                action.setAttribute('aria-label', '登录账户');
                action.innerHTML = '<svg class="icon"><use href="#i-user"/></svg>';
            }
            paintAvatar($('#acctFallback'), $('#acctSkin'), null);
            return;
        }

        const status = statusOf(view);
        if (name) name.textContent = view.name || '未命名';
        if (uuid) uuid.textContent = shortUuid(view);
        if (stateEl) { stateEl.textContent = status.text; stateEl.className = status.tone; }
        if (typeEl) typeEl.textContent = typeLabel(view);
        if (lastEl) {
            lastEl.textContent = view.lastLogin ? formatTime(view.lastLogin) : '—';
            lastEl.dataset.source = 'account';
        }
        if (ring) ring.style.setProperty('--xp', '100%');
        if (online) online.hidden = false;

        if (tags) {
            const chips = [];
            chips.push('<span class="acct-tag acct-tag--brand">' + escapeHtml(TYPE_LABEL[view.type] || '账户') + '</span>');
            if (view.type === 'authlib' && view.serverName) {
                chips.push('<span class="acct-tag">' + escapeHtml(view.serverName) + '</span>');
            }
            if (view.type === 'offline') chips.push('<span class="acct-tag">离线模式</span>');
            if (view.skinModel === 'slim') chips.push('<span class="acct-tag">纤细皮肤</span>');
            if (view.expired) chips.push('<span class="acct-tag acct-tag--warn">令牌过期</span>');
            tags.innerHTML = chips.join('');
        }

        if (action) {
            action.dataset.accountAction = 'open';
            action.setAttribute('aria-label', '切换账户');
            action.innerHTML = '<svg class="icon"><use href="#i-external"/></svg>';
        }

        paintAvatar($('#acctFallback'), $('#acctSkin'), view);
    }

    function renderRail() {
        const view = state.selected;
        paintAvatar($('#railFallback'), $('#railSkin'), view);
        const online = $('#railOnline');
        if (online) online.hidden = !view;
        const trigger = $('#railAvatar');
        if (trigger) trigger.setAttribute('aria-label', view ? '账户菜单：' + (view.name || '') : '登录账户');
    }

    function renderPopover() {
        const head = $('#accountPopHead');
        const list = $('#accountPopList');
        const foot = $('#accountPopFoot');
        if (!head || !list || !foot) return;

        const view = state.selected;
        const status = statusOf(view);

        head.innerHTML =
            '<span class="avatar avatar--sm">' +
                '<svg class="skin" aria-hidden="true"><use href="#skin-steve"/></svg>' +
                (skinUrl(view) ? '<span class="avatar-skin" style="background-image:url(&quot;' + skinUrl(view) + '&quot;)" aria-hidden="true"></span>' : '') +
            '</span>' +
            '<div>' +
                '<b>' + escapeHtml(view ? view.name : '未登录') + '</b>' +
                '<span>' + escapeHtml(view ? typeLabel(view) + ' · ' + shortUuid(view) : '点下面的按钮登录账户') + '</span>' +
            '</div>' +
            '<span class="' + (view && !view.expired ? 'chip-ok' : 'chip-plain') + '"><i aria-hidden="true"></i>' + status.text + '</span>';

        const items = [];
        state.accounts.forEach((account) => {
            const active = view && account.id === view.id;
            items.push(
                '<button class="pop-item pop-account' + (active ? ' is-active' : '') + '" type="button" role="menuitem" data-account-select="' + escapeHtml(account.id) + '">' +
                    '<span class="avatar avatar--xs"><svg class="skin" aria-hidden="true"><use href="#skin-steve"/></svg>' +
                        (skinUrl(account) ? '<span class="avatar-skin" style="background-image:url(&quot;' + skinUrl(account) + '&quot;)" aria-hidden="true"></span>' : '') +
                    '</span>' +
                    '<span class="pop-account-copy"><b>' + escapeHtml(account.name) + '</b><small>' + escapeHtml(typeLabel(account)) + '</small></span>' +
                    (active ? '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' : '') +
                '</button>'
            );
        });

        items.push(
            '<button class="pop-item" type="button" role="menuitem" data-account-login="' + (view ? view.type : 'ms') + '">' +
                '<svg class="icon"><use href="#i-plus"/></svg><span>' + (state.accounts.length ? '添加账户' : '登录账户') + '</span>' +
            '</button>'
        );

        if (view) {
            items.push(
                '<button class="pop-item" type="button" role="menuitem" data-account-action="refresh">' +
                    '<svg class="icon"><use href="#i-refresh"/></svg><span>刷新登录状态</span>' +
                '</button>' +
                '<button class="pop-item" type="button" role="menuitem" data-account-action="skin">' +
                    '<svg class="icon"><use href="#i-image"/></svg><span>刷新皮肤</span>' +
                '</button>' +
                '<button class="pop-item" type="button" role="menuitem" data-account-action="folder">' +
                    '<svg class="icon"><use href="#i-folder"/></svg><span>打开游戏目录</span>' +
                '</button>' +
                '<button class="pop-item pop-item--danger" type="button" role="menuitem" data-account-action="logout">' +
                    '<svg class="icon"><use href="#i-logout"/></svg><span>退出登录</span>' +
                '</button>'
            );
        }

        items.push(
            '<button class="pop-item" type="button" role="menuitem" data-nav="settings">' +
                '<svg class="icon"><use href="#i-settings"/></svg><span>外观与设置</span>' +
            '</button>'
        );

        list.innerHTML = items.join('');

        foot.innerHTML =
            '<span class="num">' + escapeHtml(view ? shortUuid(view) : 'accounts.json') + '</span>' +
            '<button class="link" type="button" data-account-login="' + (view ? view.type : 'ms') + '">管理账户</button>';
    }

    function render() {
        renderSlab();
        renderRail();
        renderSettings();
        if (state.loaded) renderPopover();
    }

    /** 设置页「账户」面板：应用 ID、账号文件位置。 */
    function renderSettings() {
        const input = $('#setMsClientId');
        if (input && document.activeElement !== input) input.value = state.clientId || '';

        const note = $('#setMsClientIdNote');
        if (note) {
            note.textContent = state.clientIdFromEnv
                ? '当前由环境变量 MS_CLIENT_ID 提供，改这里不会生效'
                : (state.clientId && state.clientId.indexOf('••') < 0
                    ? '已保存；换过应用 ID 之后旧令牌需要重新登录'
                    : '留空 = 用启动器内置的应用身份（开箱即用，不用注册 Azure 应用）');
        }

        const path = $('#setAccountPath');
        if (path) path.textContent = state.logins[0] || '只能在启动器里查看（浏览器预览没有账号文件）';

        const open = $('#setAccountOpen');
        if (open) open.disabled = !state.logins[0];
    }

    /* -----------------------------------------------------------------
       数据
       ----------------------------------------------------------------- */
    function applyAccountsPayload(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (Array.isArray(payload.accounts)) state.accounts = payload.accounts;
        if ('selected' in payload) state.selected = payload.selected || null;
        if ('hasClientId' in payload) state.hasClientId = Boolean(payload.hasClientId);
        if (typeof payload.clientId === 'string') state.clientId = payload.clientId;
        if ('clientIdFromEnv' in payload) state.clientIdFromEnv = Boolean(payload.clientIdFromEnv);
        if ('builtInClientId' in payload) state.builtInClientId = Boolean(payload.builtInClientId);
        if (typeof payload.authority === 'string') state.authority = payload.authority;
        state.loaded = true;
        render();
    }

    function load() {
        state.isPreview = !hasHost();
        if (!hasHost()) {
            // 浏览器预览：只有本地存的离线账号
            state.accounts = state.preview.accounts || [];
            state.selected = state.accounts.find((item) => item.id === state.preview.selected) || state.accounts[0] || null;
            state.loaded = true;
            render();
            return Promise.resolve();
        }

        return fetch('/api/accounts')
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
                if (!payload || payload.ok === false) return;
                if (payload.path) state.logins = [payload.path];
                applyAccountsPayload(payload);
            })
            .catch(() => {
                state.loaded = true;
                render();
            });
    }

    function savePreview() {
        state.preview.accounts = state.accounts;
        state.preview.selected = state.selected ? state.selected.id : '';
        writeStore(STORE.accountPrefs, state.preview);
    }

    /* -----------------------------------------------------------------
       登录浮层
       ----------------------------------------------------------------- */
    function openLogin(tab) {
        const modal = $('#loginModal');
        if (!modal) return;
        if (typeof uiMod.closePopovers === 'function') uiMod.closePopovers();
        state.loginOpen = true;
        state.device = null;
        state.profiles = null;
        state.busy = '';
        modal.hidden = false;
        setLoginTab(tab || (state.accounts.length ? (state.selected && state.selected.type) || 'official' : 'official'));
        renderLogin();
        const first = modal.querySelector('.login-pane.is-active input, .login-pane.is-active .btn-filled');
        if (first) window.setTimeout(() => first.focus({ preventScroll: true }), 60);
    }

    function closeLogin(cancel) {
        const modal = $('#loginModal');
        if (!modal || modal.hidden) return;
        if (cancel && state.device) cancelLogin();
        modal.hidden = true;
        state.loginOpen = false;
        state.device = null;
        state.profiles = null;
        state.busy = '';
    }

    function setLoginTab(tab) {
        state.loginTab = tab || 'ms';
        document.querySelectorAll('[data-login-tab]').forEach((btn) => {
            const active = btn.dataset.loginTab === state.loginTab;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        document.querySelectorAll('[data-login-pane]').forEach((pane) => {
            pane.classList.toggle('is-active', pane.dataset.loginPane === state.loginTab);
        });
        if (state.loginTab === 'official') probeOfficialLauncher();
        renderLogin();
    }

    function setStatus(id, text, tone) {
        const el = $(id);
        if (!el) return;
        if (!text) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.textContent = text;
        el.className = 'login-status' + (tone ? ' ' + tone : '');
    }

    function renderLogin() {
        /* 官方启动器导入 */
        const importBtn = $('#officialImport');
        if (importBtn) {
            importBtn.disabled = state.official.busy;
            importBtn.textContent = state.official.busy ? '正在读取官方启动器…' : '从官方启动器导入';
        }
        const pickBtn = $('#officialPick');
        if (pickBtn) pickBtn.disabled = state.official.busy;
        const officialPath = $('#officialPath');
        if (officialPath) {
            const found = state.official.found || [];
            officialPath.hidden = found.length === 0;
            if (found.length) officialPath.textContent = '找到：' + found.join(' ／ ');
        }

        /* 微软 */
        const noClient = $('#msNoClientId');
        if (noClient) noClient.hidden = state.hasClientId;
        /* 应用身份是内置的：这一页只留「获取登录代码」，换 ID 走设置页 */
        const builtInNote = $('#msBuiltIn');
        if (builtInNote) builtInNote.hidden = !state.builtInClientId;

        const code = $('#msCode');
        if (code) {
            const show = Boolean(state.device);
            code.hidden = !show;
            if (show) {
                const value = $('#msCodeValue');
                if (value) value.textContent = state.device.userCode || '—';
                const url = $('#msCodeUrl');
                if (url) url.textContent = state.device.verificationUri || '';
            }
        }
        const cancel = $('#msCancel');
        if (cancel) cancel.hidden = !state.device;

        const msStart = $('#msStart');
        if (msStart) {
            msStart.disabled = state.busy === 'ms' || Boolean(state.device);
            msStart.textContent = state.busy === 'ms' ? '正在申请登录代码…' : '获取登录代码';
        }

        /* 外置 */
        const profiles = $('#authProfiles');
        if (profiles) {
            profiles.hidden = !(state.profiles && state.profiles.length);
            const host = $('#authProfileList');
            if (host && state.profiles) {
                host.innerHTML = state.profiles.map((profile) =>
                    '<button class="login-profile" type="button" data-auth-profile="' + escapeHtml(profile.id) + '">' +
                        '<span class="login-profile-face"><svg class="skin" aria-hidden="true"><use href="#skin-steve"/></svg></span>' +
                        '<b>' + escapeHtml(profile.name) + '</b>' +
                    '</button>'
                ).join('');
            }
        }
        const authStart = $('#authStart');
        if (authStart) {
            authStart.disabled = state.busy === 'authlib';
            authStart.textContent = state.busy === 'authlib' ? '正在登录…' : '登录';
        }

        const offlineStart = $('#offlineStart');
        if (offlineStart) offlineStart.disabled = state.busy === 'offline';

        /* 预填：离线名默认取上次的账号名 */
        const offlineName = $('#offlineName');
        if (offlineName && !offlineName.value && state.selected && state.selected.type === 'offline') {
            offlineName.value = state.selected.name || '';
        }
        const authServer = $('#authServer');
        if (authServer && !authServer.value) authServer.value = AUTH_PRESETS[0].value;
    }

    /* ---- 微软 ---- */

    /** 设置页里的「微软应用 ID」：留空 = 用内置身份。 */
    function saveClientId(inputId) {
        const input = $(inputId || '#setMsClientId');
        const value = input ? input.value.trim() : '';
        state.clientId = value;
        state.hasClientId = Boolean(value);
        if (hasHost()) hostPost({ type: 'account-set-client-id', clientId: value, authority: '' });
        toast(value ? '应用 ID 已保存' : '已改回内置应用 ID', 'i-check');
        renderSettings();
        renderLogin();
    }

    function startMsLogin() {
        if (!hasHost()) {
            setStatus('#msStatus', '浏览器预览里不能走微软登录，请在启动器里试。', 'is-warn');
            return;
        }
        if (!state.hasClientId) {
            setStatus('#msStatus', '先在上面填好 Azure 应用 ID。', 'is-warn');
            return;
        }

        const loginId = 'login' + Date.now().toString(36);
        state.busy = 'ms';
        state.device = null;
        setStatus('#msStatus', '正在向微软申请登录代码…');
        renderLogin();

        if (!hostPost({ type: 'account-login', method: 'ms', loginId: loginId })) {
            state.busy = '';
            setStatus('#msStatus', '启动器没有响应。', 'is-warn');
            renderLogin();
        }
    }

    function cancelLogin() {
        if (!state.device) return;
        if (hasHost()) hostPost({ type: 'account-login-cancel', loginId: state.device.loginId });
        state.device = null;
        state.busy = '';
        setStatus('#msStatus', '已取消登录。', '');
        renderLogin();
    }

    /* ---- 官方启动器导入 ---- */

    function probeOfficialLauncher() {
        if (!hasHost()) return;
        hostPost({ type: 'account-probe-official' });
    }

    function pickOfficialFile() {
        if (!hasHost()) return;
        state.official.busy = true;
        state.importPending = true;
        setStatus('#officialStatus', '选好账号文件后会自动导入…');
        renderLogin();
        if (!hostPost({ type: 'account-pick-official', loginId: 'pick' + Date.now().toString(36) })) {
            state.official.busy = false;
            state.importPending = false;
            renderLogin();
        }
    }

    function importOfficial() {
        if (!hasHost()) {
            setStatus('#officialStatus', '浏览器预览里读不到官方启动器的文件，请在启动器里试。', 'is-warn');
            return;
        }
        state.official.busy = true;
        state.importPending = true;
        setStatus('#officialStatus', '正在读取官方启动器的账号文件…');
        renderLogin();
        if (!hostPost({ type: 'account-import-official', loginId: 'import' + Date.now().toString(36) })) {
            state.official.busy = false;
            state.importPending = false;
            setStatus('#officialStatus', '启动器没有响应。', 'is-warn');
            renderLogin();
        }
    }

    /* ---- 外置 ---- */

    function submitAuthlib(profileId) {
        if (!hasHost()) {
            setStatus('#authStatus', '外置登录需要启动器本体（浏览器预览里没有网络代理）。', 'is-warn');
            return;
        }
        const server = ($('#authServer') && $('#authServer').value || '').trim();
        const username = ($('#authName') && $('#authName').value || '').trim();
        const password = ($('#authPass') && $('#authPass').value) || '';

        if (profileId) {
            state.busy = 'authlib';
            renderLogin();
            hostPost({ type: 'account-login', method: 'authlib', server: state.pendingServer || server, profileId: profileId });
            return;
        }

        if (!server || !username || !password) {
            setStatus('#authStatus', '服务器、用户名、密码都要填。', 'is-warn');
            return;
        }

        state.busy = 'authlib';
        state.pendingServer = server;
        state.profiles = null;
        setStatus('#authStatus', '正在联系 ' + server + ' …');
        renderLogin();
        hostPost({ type: 'account-login', method: 'authlib', server: server, username: username, password: password });
    }

    function probeServer() {
        if (!hasHost()) return;
        const server = ($('#authServer') && $('#authServer').value || '').trim();
        const note = $('#authServerName');
        if (!note) return;
        if (!server) {
            note.textContent = '';
            return;
        }
        note.textContent = '正在读取服务器信息…';
        hostPost({ type: 'authlib-probe', server: server });
    }

    /* ---- 离线 ---- */

    function submitOffline() {
        const name = ($('#offlineName') && $('#offlineName').value || '').trim();
        const uuid = ($('#offlineUuid') && $('#offlineUuid').value || '').trim();
        if (!name) {
            setStatus('#offlineStatus', '先填一个玩家名。', 'is-warn');
            return;
        }
        if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
            setStatus('#offlineStatus', '名字只能用字母、数字和下划线，最长 16 位。', 'is-warn');
            return;
        }

        if (!hasHost()) {
            const offlineUuid = uuid || mockOfflineUuid(name);
            const account = {
                id: 'offline:' + offlineUuid,
                type: 'offline',
                name: name,
                uuid: offlineUuid,
                uuidDashed: dashed(offlineUuid),
                description: '离线登录',
                expired: false,
                hasSkin: false,
                lastLogin: Date.now()
            };
            state.accounts = state.accounts.filter((item) => item.id !== account.id).concat(account);
            state.selected = account;
            savePreview();
            render();
            closeLogin();
            toast('已用离线账户「' + name + '」登录', 'i-user');
            return;
        }

        state.busy = 'offline';
        renderLogin();
        hostPost({ type: 'account-login', method: 'offline', name: name, uuid: uuid });
    }

    /** 浏览器预览用的离线 UUID（真正的计算在宿主里做，这里只要能区分就行）。 */
    function mockOfflineUuid(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
        const hex = hash.toString(16).padStart(8, '0');
        return (hex + hex + hex + hex).slice(0, 32);
    }

    function dashed(uuid) {
        const plain = String(uuid || '').replace(/-/g, '');
        if (plain.length !== 32) return uuid || '';
        return plain.slice(0, 8) + '-' + plain.slice(8, 12) + '-' + plain.slice(12, 16) + '-' +
            plain.slice(16, 20) + '-' + plain.slice(20);
    }

    /* -----------------------------------------------------------------
       账号操作
       ----------------------------------------------------------------- */
    function selectAccount(id) {
        if (!id || (state.selected && state.selected.id === id)) return;
        if (hasHost()) {
            hostPost({ type: 'account-select', id: id });
        } else {
            const match = state.accounts.find((item) => item.id === id);
            if (!match) return;
            state.selected = match;
            savePreview();
            render();
        }
        toast('已切换到「' + ((state.accounts.find((item) => item.id === id) || {}).name || '') + '」', 'i-user');
    }

    function logout() {
        if (!state.selected) return;
        const account = state.selected;
        if (!hasHost()) {
            state.accounts = state.accounts.filter((item) => item.id !== account.id);
            state.selected = state.accounts[0] || null;
            savePreview();
            render();
            toast('已退出离线账户', 'i-logout');
            return;
        }
        hostPost({ type: 'account-logout', id: account.id });
        toast('已退出「' + (account.name || '') + '」', 'i-logout');
    }

    function refreshAccount() {
        if (!state.selected || !hasHost()) return;
        toast('正在刷新登录状态…', 'i-refresh');
        hostPost({ type: 'account-refresh', id: state.selected.id });
    }

    function refreshSkin() {
        if (!state.selected || !hasHost()) return;
        toast('正在刷新皮肤…', 'i-refresh');
        hostPost({ type: 'account-skin-refresh', id: state.selected.id });
    }

    /* -----------------------------------------------------------------
       宿主消息
       ----------------------------------------------------------------- */
    function onHostMessage(data) {
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'accounts-changed') {
            applyAccountsPayload(data);
            return;
        }

        if (data.type === 'account-config') {
            state.hasClientId = Boolean(data.hasClientId);
            state.clientId = data.clientId || '';
            state.clientIdFromEnv = Boolean(data.clientIdFromEnv);
            if (typeof data.authority === 'string') state.authority = data.authority;
            if (state.loginOpen) renderLogin();
            return;
        }

        if (data.type === 'authlib-server') {
            const note = $('#authServerName');
            if (!note) return;
            if (data.ok) {
                note.textContent = '已识别：' + (data.serverName || data.apiRoot || '未知服务器') +
                    (data.registerUrl ? ' · 还没有账号可以去官网注册' : '');
                if (data.serverName) state.pendingServer = data.apiRoot || state.pendingServer;
            } else {
                note.textContent = '连不上这个地址：' + (data.error || '未知错误');
            }
            return;
        }

        if (data.type === 'ms-device') {
            state.device = {
                loginId: data.loginId,
                userCode: data.userCode || '',
                verificationUri: data.verificationUri || ''
            };
            state.busy = 'ms';
            setStatus('#msStatus', '等待你在浏览器里完成授权…');
            renderLogin();
            if (data.userCode && navigator.clipboard) {
                navigator.clipboard.writeText(data.userCode).then(() => { }, () => { });
            }
            return;
        }

        if (data.type === 'official-launcher') {
            if (data.canceled) {
                state.official.busy = false;
                state.importPending = false;
                setStatus('#officialStatus', '没有选择文件。');
                renderLogin();
                return;
            }
            state.official.found = Array.isArray(data.found) ? data.found : [];
            state.official.checked = Array.isArray(data.checked) ? data.checked : [];
            if (state.loginOpen) renderLogin();
            return;
        }

        if (data.type === 'ms-progress') {
            if (data.message) setStatus('#msStatus', data.message);
            return;
        }

        if (data.type === 'account-login') {
            handleLoginResult(data);
            return;
        }

        if (data.type === 'account-skin') {
            if (data.ok) {
                state.skinBust = Date.now();
                render();
                toast('皮肤已刷新', 'i-check');
            } else {
                toast('皮肤刷新失败：' + (data.error || '没有找到皮肤'), 'i-info');
            }
            return;
        }

        if (data.type === 'account-action') {
            if (data.action === 'refresh') {
                if (data.ok) {
                    if (data.account) {
                        state.accounts = state.accounts.map((item) => (item.id === data.account.id ? data.account : item));
                        if (state.selected && state.selected.id === data.account.id) state.selected = data.account;
                    }
                    state.skinBust = Date.now();
                    render();
                    toast('登录状态已刷新', 'i-check');
                } else {
                    toast('刷新失败：' + (data.error || '需要重新登录'), 'i-info');
                    if (data.account && state.selected && data.account.id === state.selected.id) {
                        state.selected = Object.assign({}, state.selected, { expired: true });
                        render();
                    }
                }
            } else if (data.action === 'logout' && data.ok) {
                state.profiles = null;
            }
        }
    }

    function handleLoginResult(data) {
        const method = data.method || 'offline';
        const viaOfficial = state.importPending;
        state.importPending = false;
        state.official.busy = false;
        state.busy = '';
        state.device = null;

        if (data.ok && data.account) {
            const account = data.account;
            state.accounts = state.accounts.filter((item) => item.id !== account.id).concat(account);
            state.selected = account;
            state.profiles = null;
            state.skinBust = Date.now();
            render();
            closeLogin();
            toast('已登录：' + account.name + '（' + typeLabel(account) + '）', 'i-user');
            return;
        }

        if (data.errorCode === 'need-profile' && Array.isArray(data.profiles)) {
            state.profiles = data.profiles;
            state.busy = '';
            setStatus('#authStatus', data.error || '这个账号下有多个角色，选一个继续。');
            renderLogin();
            return;
        }

        state.busy = '';
        const message = data.error || '登录失败，没有更多信息';

        if (viaOfficial) {
            if (data.errorCode === 'no-launcher-accounts') {
                state.official.found = [];
                setStatus('#officialStatus',
                    '没找到官方启动器的账号文件。请先用官方启动器登录这个微软账号（进过一次游戏），再回来导入。', 'is-warn');
            } else if (data.errorCode === 'canceled') {
                setStatus('#officialStatus', '已取消导入。');
            } else {
                setStatus('#officialStatus', message, 'is-warn');
            }
            renderLogin();
            if (!data.silent) toast(message, 'i-info');
            return;
        }

        if (method === 'ms') {
            if (data.errorCode === 'canceled') {
                setStatus('#msStatus', '已取消登录。');
            } else if (data.errorCode === 'no-client-id') {
                state.hasClientId = false;
                setStatus('#msStatus', message, 'is-warn');
            } else {
                setStatus('#msStatus', message, 'is-warn');
            }
            renderLogin();
        } else if (method === 'authlib') {
            setStatus('#authStatus', message, 'is-warn');
            renderLogin();
        } else {
            setStatus('#offlineStatus', message, 'is-warn');
        }

        if (!data.silent) toast(message, 'i-info');
    }

    /* -----------------------------------------------------------------
       事件绑定
       ----------------------------------------------------------------- */
    function bindAccount() {
        /* 主页卡片右上角的按钮 */
        const slabAction = $('#acctAction');
        if (slabAction) {
            slabAction.addEventListener('click', () => {
                if (slabAction.dataset.accountAction === 'login') openLogin('ms');
                else if (typeof uiMod.toggleAccountPopover === 'function') uiMod.toggleAccountPopover();
            });
        }

        /* 账户菜单里的动态按钮 */
        const pop = $('#accountPop');
        if (pop) {
            pop.addEventListener('click', (event) => {
                const select = event.target.closest('[data-account-select]');
                if (select) {
                    selectAccount(select.dataset.accountSelect);
                    return;
                }
                const login = event.target.closest('[data-account-login]');
                if (login) {
                    openLogin(login.dataset.accountLogin || 'ms');
                    return;
                }
                const action = event.target.closest('[data-account-action]');
                if (!action) return;
                const kind = action.dataset.accountAction;
                if (kind === 'refresh') refreshAccount();
                else if (kind === 'skin') refreshSkin();
                else if (kind === 'logout') logout();
                else if (kind === 'folder') {
                    const inst = SL.state.activeInstance();
                    if (SL.host && SL.host.openLocation) {
                        SL.host.openLocation('open-game-dir', { path: inst.dirPath || '' }, '游戏文件夹');
                    }
                }
            });
        }

        /* 登录浮层 */
        const modal = $('#loginModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target.closest('[data-close-login]')) {
                    closeLogin(true);
                    return;
                }
                const tab = event.target.closest('[data-login-tab]');
                if (tab) {
                    setLoginTab(tab.dataset.loginTab);
                    return;
                }
                if (event.target.closest('#officialImport')) { importOfficial(); return; }
                if (event.target.closest('#officialPick')) { pickOfficialFile(); return; }
                if (event.target.closest('#msStart')) { startMsLogin(); return; }
                if (event.target.closest('#msCancel')) { cancelLogin(); return; }
                if (event.target.closest('#msCopyCode')) {
                    const code = state.device && state.device.userCode;
                    if (code && navigator.clipboard) {
                        navigator.clipboard.writeText(code).then(() => toast('登录代码已复制', 'i-check'), () => toast('复制失败', 'i-info'));
                    }
                    return;
                }
                if (event.target.closest('#msOpenLink')) {
                    const url = (state.device && state.device.verificationUri) || 'https://microsoft.com/link';
                    openExternal(url, '微软登录页');
                    return;
                }
                if (event.target.closest('#authStart')) { submitAuthlib(); return; }
                const profile = event.target.closest('[data-auth-profile]');
                if (profile) { submitAuthlib(profile.dataset.authProfile); return; }
                if (event.target.closest('#offlineStart')) { submitOffline(); return; }
            });

            modal.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && state.loginTab === 'authlib' &&
                    !event.target.closest('[data-auth-profile]')) {
                    event.preventDefault();
                    submitAuthlib();
                } else if (event.key === 'Enter' && state.loginTab === 'offline') {
                    event.preventDefault();
                    submitOffline();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeLogin(true);
                }
            });
        }

        /* 验证服地址：离开输入框时探测一次，省得用户填错了才发现 */
        const server = $('#authServer');
        if (server) server.addEventListener('change', probeServer);

        /* 设置页「账户」面板 */
        const settingsSave = $('#setMsClientIdSave');
        if (settingsSave) settingsSave.addEventListener('click', () => saveClientId('#setMsClientId'));

        const settingsInput = $('#setMsClientId');
        if (settingsInput) {
            settingsInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                saveClientId('#setMsClientId');
            });
        }

        const settingsOpen = $('#setAccountOpen');
        if (settingsOpen) settingsOpen.addEventListener('click', () => {
            const path = state.logins[0];
            if (!path) return;
            if (hostMod.openLocation) hostMod.openLocation('open-path', { path: path }, '账号文件');
        });

        const settingsLogin = $('#setAccountLogin');
        if (settingsLogin) settingsLogin.addEventListener('click', () => openLogin('ms'));

        const settingsRefresh = $('#setAccountRefresh');
        if (settingsRefresh) settingsRefresh.addEventListener('click', () => refreshAccount());

        /* 宿主消息 */
        const webview = window.chrome && window.chrome.webview;
        if (webview && typeof webview.addEventListener === 'function') {
            webview.addEventListener('message', (event) => {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (err) { return; }
                }
                onHostMessage(data);
            });
        }
    }

    function openExternal(url, label) {
        if (hostMod.openLocation && hasHost()) {
            hostMod.openLocation('open-external', { url: url }, label || '链接');
            return;
        }
        try { window.open(url, '_blank', 'noopener'); } catch (err) { toast('打不开这个链接', 'i-info'); }
    }

    SL.account = Object.assign(SL.account || {}, {
        state,
        load,
        render,
        renderSettings,
        openLogin,
        closeLogin,
        setLoginTab,
        bindAccount,
        onHostMessage,
        selectAccount,
        logout,
        refreshAccount,
        refreshSkin,
        hasHost
    });
})(window);
