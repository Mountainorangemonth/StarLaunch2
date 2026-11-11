/* =====================================================================
   StarLaunch · 公告与启动日志
   ---------------------------------------------------------------------
   公告列表、自定义内容（Markdown / XAML）、日志历史。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, escapeHtml, pad2, readArray, readStore, writeStore } = SL.core;
    const hostMod = SL.core.mod('host');
    const hostPost = (...args) => hostMod.hostPost(...args);
    const routerMod = SL.core.mod('router');
    const go = (...args) => routerMod.go(...args);
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const versionsMod = SL.core.mod('versions');
    const loadInstances = (...args) => versionsMod.loadInstances(...args);
    const launchMod = SL.core.mod('launch');
    const appendLaunchLog = (...args) => launchMod.appendLaunchLog(...args);
    const settingsMod = SL.core.mod('settings');
    const setSettingsTab = (...args) => settingsMod.setSettingsTab(...args);

    const noticePrefs = readStore(STORE.notice, {
        source: 'auto',          // auto = 启动器目录里的 Custom.xaml；preset = 空白预设；file = 手动选的本地文件
        format: 'md',
        preset: '',
        filePath: '',
        fileName: '',
        fileText: '',
        fileFormat: 'md',
        autoPath: '',
        autoFolder: '',
        autoText: '',
        autoError: ''
    });
    // 老版本的默认来源是「空白预设」；预设里一个字都没有时没理由继续挡着 Custom.xaml
    if (noticePrefs.source === 'preset' && !String(noticePrefs.preset || '').trim()) {
        noticePrefs.source = 'auto';
    }

    const launchLog = readArray(STORE.launchLog, []);

    /* -----------------------------------------------------------------
       公告：全部已读后的自定义内容（Markdown / XAML）与启动日志
       ----------------------------------------------------------------- */
    const NOTICE_FORMAT_LABEL = { md: 'Markdown', xaml: 'XAML', txt: '纯文本' };
    let noticeSaveTimer = 0;
    let noticeSilentReload = false;

    function saveNoticePrefs() {
        writeStore(STORE.notice, noticePrefs);
    }

    function noticeFormatFromPath(name) {
        const ext = String(name || '').toLowerCase().split('.').pop();
        if (ext === 'xaml' || ext === 'xml') return 'xaml';
        if (ext === 'md' || ext === 'markdown') return 'md';
        return 'txt';
    }


    function mdInline(text) {
        const codes = [];
        let out = escapeHtml(text);
        out = out.replace(/`([^`]+)`/g, (m, code) => {
            codes.push(code);
            return '\u0001' + (codes.length - 1) + '\u0001';
        });
        out = out
            .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-external rel="noreferrer">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        return out.replace(/\u0001(\d+)\u0001/g, (m, index) => '<code>' + codes[Number(index)] + '</code>');
    }

    function renderMarkdown(src) {
        const blocks = [];
        let text = String(src || '').replace(/\r\n?/g, '\n');

        // 先抽出围栏代码块，避免里面的 #、* 被当成 Markdown 语法
        text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (m, lang, code) => {
            blocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
            return '\n\u0000' + (blocks.length - 1) + '\u0000\n';
        });

        const lines = text.split('\n');
        const out = [];
        let para = [];
        let list = null;

        const flushPara = () => {
            if (!para.length) return;
            out.push('<p>' + mdInline(para.join('\n')) + '</p>');
            para = [];
        };
        const closeList = () => {
            if (!list) return;
            out.push('</' + list + '>');
            list = null;
        };
        const openList = (tag) => {
            if (list === tag) return;
            closeList();
            out.push('<' + tag + '>');
            list = tag;
        };

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                flushPara();
                closeList();
                i += 1;
                continue;
            }

            const placeholder = trimmed.match(/^\u0000(\d+)\u0000$/);
            if (placeholder) {
                flushPara();
                closeList();
                out.push(blocks[Number(placeholder[1])] || '');
                i += 1;
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
            if (heading) {
                flushPara();
                closeList();
                // 面板本身已经有 h2 标题，正文从 h3 起更协调
                const level = Math.min(heading[1].length + 1, 4);
                out.push('<h' + level + '>' + mdInline(heading[2]) + '</h' + level + '>');
                i += 1;
                continue;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushPara();
                closeList();
                out.push('<hr>');
                i += 1;
                continue;
            }

            if (/^>\s?/.test(line)) {
                const quote = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^\s*>\s?/, ''));
                    i += 1;
                }
                flushPara();
                closeList();
                out.push('<blockquote>' + mdInline(quote.join('\n')) + '</blockquote>');
                continue;
            }

            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (ul || ol) {
                flushPara();
                openList(ul ? 'ul' : 'ol');
                out.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
                i += 1;
                continue;
            }

            para.push(line);
            i += 1;
        }

        flushPara();
        closeList();
        return out.join('\n');
    }

    /* ── XAML：交给 16/17 号模块（PCL 的 Custom.xaml 渲染器） ── */
    function renderXamlInto(body, raw, basePath) {
        body.innerHTML = '';
        const view = SL.xamlView;
        if (!view) {
            body.innerHTML = '<pre><code>' + escapeHtml(raw) + '</code></pre>';
            return;
        }
        view.mount(body, raw, { basePath: basePath || '' });
    }

    /** 宿主推来的 Custom.xaml（或 /api/custom-home 拉到的）写进偏好里。 */
    function applyCustomHome(data, silent) {
        if (!data || typeof data !== 'object') return;
        if (data.folder) noticePrefs.autoFolder = data.folder;
        if (data.path) noticePrefs.autoPath = data.path;

        if (data.ok) {
            noticePrefs.autoText = data.text || '';
            noticePrefs.autoError = '';
        } else {
            noticePrefs.autoText = '';
            noticePrefs.autoError = data.error || '读取 Custom.xaml 失败';
        }

        saveNoticePrefs();
        renderNoticeSettings();
        if (noticeIsCustom() && noticePrefs.source === 'auto') {
            // 换了文件就重头来，改内容则尽量保留变量与卡片折叠状态
            if (data.reason === 'reset') SL.xamlView && SL.xamlView.reset();
            renderNoticeBody();
        }
        if (!silent && data.reason === 'change') toast('Custom.xaml 已更新', 'i-refresh');
    }

    /** 启动时拉一次；宿主推送（文件监听）是另一条路，两边都能到。 */
    function loadCustomHome() {
        if (!hostMod.hasHost()) return;
        fetch('/api/custom-home', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => applyCustomHome(data, true))
            .catch(() => { /* 宿主没准备好就算了，稍后推送会补上 */ });
    }

    /* ── 公告视图 ────────────────────────────────────────── */
    function noticeIsCustom() {
        const panel = $('#noticePanel');
        return Boolean(panel && panel.classList.contains('is-custom'));
    }

    function getNoticeIds() {
        return $$('.notice-item[data-notice-id]').map((item) => item.dataset.noticeId);
    }

    function readNoticeIds() {
        return readArray(STORE.noticeRead, []);
    }

    function noticesAllRead() {
        const ids = getNoticeIds();
        if (!ids.length) return false;
        const read = new Set(readNoticeIds());
        return ids.every((id) => read.has(id));
    }

    function markAllNoticesRead() {
        $$('.notice-item').forEach((item) => item.classList.remove('is-unread'));
        const count = $('#unreadCount');
        if (count) count.textContent = '0 条未读';

        const read = new Set(readNoticeIds());
        getNoticeIds().forEach((id) => read.add(id));
        writeStore(STORE.noticeRead, Array.from(read));
    }

    function restoreNoticeUnread() {
        let unread = 0;
        $$('.notice-item').forEach((item) => {
            const isUnread = item.dataset.noticeUnread === 'true';
            item.classList.toggle('is-unread', isUnread);
            if (isUnread) unread += 1;
        });
        const count = $('#unreadCount');
        if (count) count.textContent = unread + ' 条未读';
    }

    function initNoticeView() {
        const title = $('#noticeTitle');
        if (noticesAllRead()) {
            if (title) title.textContent = '自定义内容';
            showNoticeCustom();
            return;
        }
        restoreNoticeUnread();
        if (title) title.textContent = '公告';
        showNoticeDefault();
    }

    function renderNoticeBody() {
        const body = $('#noticeBody');
        if (!body) return;

        const source = noticePrefs.source;
        const isAuto = source === 'auto';
        const isFile = source === 'file';
        const raw = isAuto ? noticePrefs.autoText : (isFile ? noticePrefs.fileText : noticePrefs.preset);
        const format = isAuto ? 'xaml' : (isFile ? noticePrefs.fileFormat : noticePrefs.format);
        const label = NOTICE_FORMAT_LABEL[format] || String(format || '').toUpperCase() || '文本';

        const badge = $('#noticeSourceBadge');
        if (badge) {
            badge.textContent = isAuto ? '启动器目录 · Custom.xaml' : (isFile ? '本地文件' : '空白预设') + ' · ' + label;
        }

        body.classList.toggle('is-xaml', format === 'xaml');

        // 启动器目录还没读到（宿主刚起来 / 还在读盘）
        if (isAuto && !noticePrefs.autoError && !noticePrefs.autoPath && hostMod.hasHost()) {
            body.innerHTML = '<div class="notice-empty"><span>正在读取 Custom.xaml…</span></div>';
            return;
        }

        // 启动器目录读失败时，把原因直接写在面板里，别让人对着一片空白猜
        if (isAuto && noticePrefs.autoError) {
            body.innerHTML = '<div class="notice-empty">' +
                '<span>' + escapeHtml(noticePrefs.autoError) + '</span>' +
                '<button class="btn btn-tonal btn-sm" type="button" data-notice-config>去设置里看看 Custom.xaml</button>' +
                '</div>';
            return;
        }

        if (!raw || !String(raw).trim()) {
            let emptyText;
            if (isAuto) {
                emptyText = hostMod.hasHost()
                    ? 'Custom.xaml 还是空的，去设置里点「编辑文件」写点东西。'
                    : '浏览器预览模式下读不到启动器目录，用启动器打开才会显示 Custom.xaml。';
            } else if (isFile) {
                emptyText = '还没有选择本地文件，或文件内容为空。';
            } else {
                emptyText = '空白预设还没有内容。';
            }
            body.innerHTML = '<div class="notice-empty">' +
                '<span>' + emptyText + '</span>' +
                '<button class="btn btn-tonal btn-sm" type="button" data-notice-config>去设置里填写自定义内容</button>' +
                '</div>';
            return;
        }

        if (format === 'xaml') {
            renderXamlInto(body, raw, isAuto ? noticePrefs.autoFolder : '');
        } else if (format === 'md') {
            body.innerHTML = renderMarkdown(raw);
        } else {
            body.innerHTML = '<pre><code>' + escapeHtml(raw) + '</code></pre>';
        }
    }

    function showNoticeCustom() {
        const panel = $('#noticePanel');
        if (!panel) return;
        panel.classList.add('is-custom');
        const title = $('#noticeTitle');
        if (title) title.textContent = '自定义内容';
        const layout = $('#noticeDefault');
        if (layout) layout.hidden = true;
        const custom = $('#noticeCustom');
        if (custom) custom.hidden = false;
        const toolsDefault = $('#noticeToolsDefault');
        if (toolsDefault) toolsDefault.hidden = true;
        const toolsCustom = $('#noticeToolsCustom');
        if (toolsCustom) toolsCustom.hidden = false;
        // 已全部读完之后公告列表不再存在，返回按钮只用于“预览”场景
        const back = $('#noticeBackBtn');
        if (back) back.hidden = noticesAllRead();
        renderNoticeBody();
        renderLaunchLog();
    }

    function showNoticeDefault() {
        const panel = $('#noticePanel');
        if (!panel) return;
        panel.classList.remove('is-custom');
        const title = $('#noticeTitle');
        if (title) title.textContent = '公告';
        const layout = $('#noticeDefault');
        if (layout) layout.hidden = false;
        const custom = $('#noticeCustom');
        if (custom) custom.hidden = true;
        const toolsDefault = $('#noticeToolsDefault');
        if (toolsDefault) toolsDefault.hidden = false;
        const toolsCustom = $('#noticeToolsCustom');
        if (toolsCustom) toolsCustom.hidden = true;
    }

    /* ── 启动日志 ────────────────────────────────────────── */
    function formatLogTime(ts) {
        const date = new Date(Number(ts) || Date.now());
        return (date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' +
            pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
    }

    function renderLaunchLog() {
        const list = $('#noticeLogList');
        const meta = $('#noticeLogMeta');
        if (!list) return;

        if (!launchLog.length) {
            list.innerHTML = '<p class="notice-log-empty">还没有启动记录。启动一次游戏后，日志会出现在这里。</p>';
            if (meta) meta.textContent = '暂无记录';
            return;
        }

        list.innerHTML = launchLog.map((entry) =>
            '<div class="log-line"><span class="log-time num">' + escapeHtml(formatLogTime(entry.t)) + '</span>' +
            '<span class="log-text">' + escapeHtml(entry.line) + '</span></div>'
        ).join('');
        if (meta) meta.textContent = '共 ' + launchLog.length + ' 行';
        list.scrollTop = list.scrollHeight;
    }

    function recordLaunchLog(line) {
        launchLog.push({ t: Date.now(), line: String(line) });
        while (launchLog.length > 300) launchLog.shift();
        writeStore(STORE.launchLog, launchLog);
        renderLaunchLog();
    }

    function clearLaunchLog() {
        launchLog.length = 0;
        writeStore(STORE.launchLog, launchLog);
        renderLaunchLog();
        toast('启动日志已清空', 'i-info');
    }

    /* ── 设置区 ──────────────────────────────────────────── */
    function renderNoticeSettings() {
        const source = noticePrefs.source;
        const isAuto = source === 'auto';
        const isPreset = source === 'preset';

        $$('#noticeSourceSeg [data-notice-source]').forEach((btn) => {
            const active = btn.dataset.noticeSource === source;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });

        $$('#noticeFormatSeg [data-notice-format]').forEach((btn) => {
            const active = noticePrefs.format === btn.dataset.noticeFormat;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
            btn.disabled = !isPreset;
        });

        const editor = $('#noticePresetInput');
        if (editor) {
            if (document.activeElement !== editor) editor.value = noticePrefs.preset;
            editor.disabled = !isPreset;
        }

        const autoRow = $('#noticeAutoRow');
        if (autoRow) autoRow.hidden = !isAuto;
        const presetRow = $('#noticePresetRow');
        if (presetRow) presetRow.hidden = !isPreset;
        const fileRow = $('#noticeFileRow');
        if (fileRow) fileRow.hidden = source !== 'file';

        const autoPath = $('#noticeAutoPath');
        if (autoPath) {
            if (noticePrefs.autoError) {
                autoPath.textContent = noticePrefs.autoError;
            } else if (noticePrefs.autoPath) {
                autoPath.textContent = noticePrefs.autoPath +
                    '（改完保存会自动刷新）';
            } else {
                autoPath.textContent = hostMod.hasHost()
                    ? '正在读取启动器目录…'
                    : '浏览器预览模式下没有启动器目录，运行启动器后可见';
            }
        }

        const path = $('#noticeFilePath');
        if (path) {
            path.textContent = noticePrefs.filePath
                ? noticePrefs.filePath
                : (noticePrefs.fileName ? noticePrefs.fileName + '（未记录路径）' : '未选择文件');
        }
    }

    function scheduleNoticeSave() {
        window.clearTimeout(noticeSaveTimer);
        noticeSaveTimer = window.setTimeout(() => {
            saveNoticePrefs();
            const hint = $('#noticePresetHint');
            if (hint) {
                hint.textContent = '已自动保存 · 最后修改 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
            }
        }, 350);
    }

    function setNoticeFile(result, silent) {
        if (!result) return;
        if (result.canceled) {
            if (!silent) toast('已取消选择文件', 'i-info');
            return;
        }
        if (!result.ok) {
            if (!silent) toast('读取公告文件失败：' + (result.error || '未知错误'), 'i-info');
            return;
        }

        noticePrefs.source = 'file';
        noticePrefs.filePath = result.path || '';
        noticePrefs.fileName = result.name || '';
        noticePrefs.fileText = result.text || '';
        noticePrefs.fileFormat = noticeFormatFromPath(result.name || result.path);
        saveNoticePrefs();
        renderNoticeSettings();
        if (noticeIsCustom()) renderNoticeBody();
        if (!silent) toast('已载入公告文件：' + (result.name || '本地文件'), 'i-folder');
    }

    function pickNoticeFile() {
        noticeSilentReload = false;
        if (hostPost({ type: 'pick-notice-file' })) return;
        const input = $('#noticeFileInput');
        if (input) input.click();
    }

    function reloadNoticeFile() {
        if (!noticePrefs.filePath) {
            toast('还没有选择本地文件', 'i-info');
            return;
        }
        noticeSilentReload = false;
        if (!hostPost({ type: 'read-notice-file', path: noticePrefs.filePath })) {
            toast('当前环境无法直接读取本地路径，请重新选择文件', 'i-info');
        }
    }

    function openNoticeSettings() {
        go('settings');
        setSettingsTab('notice');
    }


    /* 事件绑定 */
    function bindNotice() {
        /* 公告已读 → 持久化状态，之后加载页面直接显示自定义内容 */
        const readAll = $('#readAllBtn');
        if (readAll) {
            readAll.addEventListener('click', () => {
                markAllNoticesRead();
                showNoticeCustom();
                toast('公告已全部已读，之后将显示自定义内容');
            });
    }

    /* 自定义内容设置入口 */
    const noticeEdit = $('#noticeEditBtn');
    if (noticeEdit) noticeEdit.addEventListener('click', openNoticeSettings);

    const noticeBack = $('#noticeBackBtn');
    if (noticeBack) noticeBack.addEventListener('click', showNoticeDefault);

    const noticeResetRead = $('#noticeResetRead');
    if (noticeResetRead) {
        noticeResetRead.addEventListener('click', () => {
            writeStore(STORE.noticeRead, []);
            restoreNoticeUnread();
            showNoticeDefault();
            toast('已重置已读状态，公告列表重新显示', 'i-refresh');
        });
    }

    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-notice-config]')) {
            event.preventDefault();
            openNoticeSettings();
        }
    });

    /* 公告内容来源 / 格式 */
    $$('#noticeSourceSeg [data-notice-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
            noticePrefs.source = btn.dataset.noticeSource;
            saveNoticePrefs();
            // 换来源等于换了一份内容：变量和卡片折叠状态不该带过去
            if (SL.xamlView) SL.xamlView.reset();
            renderNoticeSettings();
            if (noticePrefs.source === 'auto') loadCustomHome();
            if (noticeIsCustom()) renderNoticeBody();
            const labels = { auto: '启动器目录里的 Custom.xaml', file: '本地文件', preset: '空白预设' };
            toast('内容来源：' + (labels[noticePrefs.source] || noticePrefs.source), 'i-info');
        });
    });

    $$('#noticeFormatSeg [data-notice-format]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            noticePrefs.format = btn.dataset.noticeFormat;
            saveNoticePrefs();
            renderNoticeSettings();
            if (noticeIsCustom()) renderNoticeBody();
        });
    });

    /* 预设编辑器 */
    const noticeEditor = $('#noticePresetInput');
    if (noticeEditor) {
        noticeEditor.addEventListener('input', () => {
            noticePrefs.preset = noticeEditor.value;
            scheduleNoticeSave();
        });
    }

    const noticePreview = $('#noticePreviewBtn');
    if (noticePreview) {
        noticePreview.addEventListener('click', () => {
            showNoticeCustom();
            go('home');
            toast('已在公告栏预览自定义内容', 'i-info');
        });
    }

    /* 本地文件 */
    const noticePick = $('#noticePickFile');
    if (noticePick) noticePick.addEventListener('click', pickNoticeFile);

    const noticeReload = $('#noticeReloadFile');
    if (noticeReload) {
        noticeReload.addEventListener('click', () => {
            toast('正在重新读取公告文件…', 'i-refresh');
            reloadNoticeFile();
        });
    }

    /* 启动器目录里的 Custom.xaml */
    const noticeOpenAuto = $('#noticeOpenAuto');
    if (noticeOpenAuto) {
        noticeOpenAuto.addEventListener('click', () => {
            if (hostPost({ type: 'open-custom-home' })) return;
            toast('只有启动器里才能直接打开 Custom.xaml', 'i-info');
        });
    }

    const noticeOpenAutoFolder = $('#noticeOpenAutoFolder');
    if (noticeOpenAutoFolder) {
        noticeOpenAutoFolder.addEventListener('click', () => {
            if (hostPost({ type: 'open-custom-home-folder' })) return;
            toast('只有启动器里才能打开配置文件夹', 'i-info');
        });
    }

    const noticeResetAuto = $('#noticeResetAuto');
    if (noticeResetAuto) {
        noticeResetAuto.addEventListener('click', () => {
            if (hostPost({ type: 'reset-custom-home' })) {
                toast('已恢复默认的 Custom.xaml', 'i-refresh');
                return;
            }
            toast('只有启动器里才能恢复默认文件', 'i-info');
        });
    }

    const noticeFileInput = $('#noticeFileInput');
    if (noticeFileInput) {
        noticeFileInput.addEventListener('change', async () => {
            const file = noticeFileInput.files && noticeFileInput.files[0];
            noticeFileInput.value = '';
            if (!file) return;
            try {
                const text = await file.text();
                setNoticeFile({ ok: true, path: '', name: file.name, text: text });
            } catch (err) {
                toast('读取公告文件失败', 'i-info');
            }
        });
    }

    /* 宿主返回的公告文件内容 */
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.addEventListener === 'function') {
        window.chrome.webview.addEventListener('message', (event) => {
            let data = event.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (err) { return; }
            }
            // 自定义主页：启动时推一次，文件改动后也会再推
            if (data && data.type === 'custom-home') {
                applyCustomHome(data, data.reason === 'init');
                return;
            }

            if (!data || data.type !== 'notice-file') {
                // 宿主可以持续把真实游戏进程的日志推进来
                if (data && data.type === 'launch-log' && typeof data.line === 'string') {
                    appendLaunchLog(data.line);
                }
                // 游戏目录被改过：重新扫一遍，页面上所有版本信息跟着更新
                if (data && data.type === 'game-dir') {
                    if (data.ok) {
                        const label = data.custom ? '已切换游戏目录' : '已恢复默认游戏目录';
                        toast(label + '：' + (data.gameDir || ''), 'i-folder');
                        loadInstances({ force: true });
                    } else if (!data.canceled) {
                        toast('游戏目录设置失败：' + (data.error || '未知错误'), 'i-info');
                    }
                }
                return;
            }
            const silent = noticeSilentReload;
            noticeSilentReload = false;
            setNoticeFile(data, silent);
        });
    }

    /* 启动时拉一次 Custom.xaml（宿主那条推送可能比页面先到，两边都留着） */
    loadCustomHome();

    /* 启动日志 */
    const logClear = $('#noticeLogClear');
    if (logClear) logClear.addEventListener('click', clearLaunchLog);
    const logSettingsClear = $('#noticeLogSettingsClear');
    if (logSettingsClear) logSettingsClear.addEventListener('click', clearLaunchLog);

    /* 自定义公告里的外链交给系统浏览器 */
    document.addEventListener('click', (event) => {
        const link = event.target.closest('a[data-external]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) return;
        event.preventDefault();
        if (!hostPost({ type: 'open-external', url: href })) window.open(href, '_blank', 'noopener');
    });

    }

    /** 启动时让宿主静默重读公告文件：不弹 toast，也不覆盖用户正在编辑的内容 */
    function setSilentReload(value) {
        noticeSilentReload = Boolean(value);
    }

    SL.notice = Object.assign(SL.notice || {}, { setSilentReload, noticePrefs, launchLog, NOTICE_FORMAT_LABEL, saveNoticePrefs, noticeFormatFromPath, mdInline, renderMarkdown, renderXamlInto, applyCustomHome, loadCustomHome, noticeIsCustom, getNoticeIds, readNoticeIds, noticesAllRead, markAllNoticesRead, restoreNoticeUnread, initNoticeView, renderNoticeBody, showNoticeCustom, showNoticeDefault, formatLogTime, renderLaunchLog, recordLaunchLog, clearLaunchLog, renderNoticeSettings, scheduleNoticeSave, setNoticeFile, pickNoticeFile, reloadNoticeFile, openNoticeSettings, bindNotice });
})(window);
