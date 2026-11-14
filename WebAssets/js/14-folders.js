/* =====================================================================
   StarLaunch · 游戏文件夹列表（PCL 式多 .minecraft）
   ---------------------------------------------------------------------
   版本页左侧那一栏：列出所有登记过的 .minecraft。右边的版本列表是合并的，
   点某个文件夹就筛成那个文件夹；每个文件夹各自记自己的版本隔离策略。

   数据来自宿主 /api/versions 的 folders 字段，写操作全走 postMessage：
       add-game-dirs / remove-game-dir / set-dir-isolation /
       set-active-dir / open-game-dir / import-modpack
   宿主处理完回 game-dirs / modpack-import，这里再拉一次扫描结果。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;
    const { $, $$, escapeHtml, STORE, writeStore } = SL.core;
    const { ui, launchPrefs } = SL.state;

    /* 模块之间互相引用，取的时候再解析，避免加载顺序把方法取成 undefined */
    const versionsMod = () => SL.core.mod('versions');
    const hostMod = () => SL.core.mod('host');
    const uiMod = () => SL.core.mod('ui');

    const ALL = 'all';

    const ISO_SHORT = { all: '隔离', modded: '按模组', none: '共享' };
    const ISO_TONE = { all: 'is-on', modded: 'is-pending', none: 'is-off' };

    /**
     * 宿主的 game-dirs 回包里，哪些动作需要重新扫盘。
     *
     * 切换当前文件夹（active）不在里面：页面已经乐观更新过了，再扫一遍
     * 会把所有文件夹的 versions 重读、每个版本还要数一遍目录大小，
     * 表现就是快速点文件夹时卡一下。
     */
    const RELOAD_ACTIONS = { add: true, remove: true, isolation: true, reset: true };

    /** 宿主扫出来的文件夹摘要。 */
    const folders = () => SL.state.folders || [];

    /** 当前选中的文件夹；选的是「全部」或者那个文件夹已经没了就返回 null。 */
    function currentFolder() {
        if (!ui.folderFilter || ui.folderFilter === ALL) return null;
        return folders().find((item) => item.id === ui.folderFilter) || null;
    }

    /* -----------------------------------------------------------------
       渲染
       ----------------------------------------------------------------- */

    function renderFolderList() {
        const host = $('#folderList');
        if (!host) return;

        const list = folders();
        if (!list.length) {
            host.innerHTML = '<p class="folders-empty">运行在启动器里才能读取游戏文件夹。</p>';
            updateCurrent();
            return;
        }

        const counts = SL.state.scanState.counts || {};
        const rows = [];

        rows.push(
            '<article class="folder-row folder-row--all' + (ui.folderFilter === ALL || !currentFolder() ? ' is-active' : '') + '"' +
                ' data-folder-row="' + ALL + '" role="button" tabindex="0" aria-pressed="' +
                (ui.folderFilter === ALL || !currentFolder() ? 'true' : 'false') + '">' +
                '<span class="folder-row-icon" aria-hidden="true"><svg class="icon"><use href="#i-layers"/></svg></span>' +
                '<span class="folder-row-main">' +
                    '<span class="folder-row-name">全部文件夹</span>' +
                    '<span class="folder-row-path num">' + list.length + ' 个文件夹 · ' + (counts.total || 0) + ' 个版本</span>' +
                '</span>' +
            '</article>'
        );

        rows.push(list.map((folder) => {
            const active = folder.id === ui.folderFilter;
            const iso = folder.isolation || 'all';
            const meta = folder.exists
                ? (folder.versions || 0) + ' 个版本' + (folder.broken ? ' · ' + folder.broken + ' 异常' : '')
                : '已失效';
            const tag = folder.builtIn ? '<span class="folder-row-tag">内置</span>' : '';

            return '<article class="folder-row' + (active ? ' is-active' : '') + (folder.exists ? '' : ' is-missing') + '"' +
                    ' data-folder-row="' + escapeHtml(folder.id) + '" role="button" tabindex="0"' +
                    ' aria-pressed="' + (active ? 'true' : 'false') + '" title="' + escapeHtml(folder.path) + '">' +
                    '<span class="folder-row-icon" aria-hidden="true"><svg class="icon"><use href="#i-folder"/></svg></span>' +
                    '<span class="folder-row-main">' +
                        '<span class="folder-row-name">' + escapeHtml(folder.name || '.minecraft') + tag + '</span>' +
                        '<span class="folder-row-path num">' + escapeHtml(folder.path) + '</span>' +
                    '</span>' +
                    '<span class="folder-row-side">' +
                        '<span class="iso-chip ' + (ISO_TONE[iso] || 'is-on') + '">' + (ISO_SHORT[iso] || '隔离') + '</span>' +
                        '<span class="folder-row-meta num">' + escapeHtml(meta) + '</span>' +
                    '</span>' +
                '</article>';
        }).join(''));

        host.innerHTML = rows.join('');
        syncFolderView();
    }

    /**
     * 只更新「选中态」：侧栏高亮、当前文件夹信息、版本行上的文件夹标签显隐。
     *
     * 切换文件夹时走这里而不是重画整个列表——重画会重建所有行节点，
     * 版本多的时候肉眼能看出停顿。
     */
    function syncFolderView() {
        const filtered = Boolean(currentFolder());

        $$('[data-folder-row]').forEach((row) => {
            const active = row.dataset.folderRow === (filtered ? ui.folderFilter : ALL);
            row.classList.toggle('is-active', active);
            row.setAttribute('aria-pressed', String(active));
        });

        // 已经按文件夹筛过了，版本行上的文件夹标签就是废话，收起来
        const instList = $('#instList');
        if (instList) instList.classList.toggle('is-filtered', filtered);

        updateCurrent();
    }

    /** 侧栏上半部分：「当前文件夹」路径 + 这个文件夹的隔离下拉 + 操作按钮。 */
    function updateCurrent() {
        const pathEl = $('#folderCurrentPath');
        const isoRow = $('#folderIsoRow');
        const isoSelect = $('#folderIsolation');
        const removeBtn = $('#folderRemove');
        const openBtn = $('#folderOpen');
        const hint = $('#folderHint');
        const folder = currentFolder();

        if (!folder) {
            const counts = SL.state.scanState.counts || {};
            if (pathEl) pathEl.textContent = folders().length
                ? folders().length + ' 个文件夹 · ' + (counts.total || 0) + ' 个版本'
                : '—';
            if (isoRow) isoRow.hidden = true;
            if (removeBtn) removeBtn.hidden = true;
            if (openBtn) openBtn.hidden = true;
            if (hint) {
                hint.hidden = !folders().length;
                hint.textContent = '点一个文件夹，可以单独设置它的版本隔离。';
            }
            return;
        }

        if (pathEl) pathEl.textContent = folder.path;
        if (isoRow) isoRow.hidden = !folder.exists;
        if (openBtn) openBtn.hidden = !folder.exists;
        if (removeBtn) removeBtn.hidden = Boolean(folder.builtIn) || !folder.exists;

        if (isoSelect) {
            isoSelect.value = folder.isolation || 'all';
            isoSelect.disabled = !folder.exists;
        }

        if (hint) {
            const error = folder.exists ? '' : (folder.error || '文件夹不存在');
            hint.hidden = !error;
            hint.textContent = error;
        }
    }

    /** 选一个文件夹（或「全部」）。移动端和桌面端都走这里。 */
    function selectFolder(id, options) {
        const opts = options || {};
        const target = id === ALL || folders().some((item) => item.id === id) ? id : ALL;
        const changed = ui.folderFilter !== target;

        ui.folderFilter = target;
        writeStore(STORE.uiPrefs, ui);

        versionsMod().filterInstances();
        syncFolderView();

        // 当前实例可能被筛掉了：换成这个文件夹里的第一个，没有就清空详情
        const pool = target === ALL
            ? SL.state.instances
            : SL.state.instances.filter((item) => item.dirId === target);
        if (!pool.some((item) => item.id === ui.activeId)) {
            ui.activeId = pool.length ? pool[0].id : '';
            writeStore(STORE.uiPrefs, ui);
            if (ui.activeId) versionsMod().selectInstance(ui.activeId);
            else versionsMod().clearDetail();
        }

        const folder = currentFolder();
        if (folder && !folder.active && hostMod().hasHost()) {
            // 让宿主把「当前文件夹」也切过去：导入整合包会落到这里
            hostMod().hostPost({ type: 'set-active-dir', path: folder.path });
            folder.active = true;
        }

        if (opts.toast && changed) {
            uiMod().toast(folder ? '已筛选到「' + (folder.name || folder.path) + '」' : '已显示全部文件夹的版本', 'i-folder');
        }
        return target;
    }

    /* -----------------------------------------------------------------
       宿主消息
       ----------------------------------------------------------------- */

    function onHostMessage(data) {
        if (!data || typeof data.type !== 'string') return;

        if (data.type === 'game-dirs') {
            if (data.canceled) return;
            if (!data.ok) {
                uiMod().toast('文件夹操作失败：' + (data.error || '未知错误'), 'i-info');
                return;
            }
            const labels = {
                add: '已添加文件夹',
                remove: '已移除文件夹',
                isolation: '已更新这个文件夹的版本隔离',
                reset: '已回到只有默认的 .minecraft'
            };

            // 「当前文件夹」只是侧栏状态，不重新扫盘（见 RELOAD_ACTIONS 的注释）
            if (!RELOAD_ACTIONS[data.action]) return;

            const label = labels[data.action];
            if (label) uiMod().toast(label, 'i-folder');
            versionsMod().loadInstances({ force: true });
            return;
        }

        if (data.type === 'modpack-import') {
            if (data.canceled) return;
            if (!data.ok) {
                uiMod().toast('导入整合包失败：' + (data.error || '未知错误'), 'i-info');
                return;
            }
            uiMod().toast(data.message || ('已导入整合包「' + (data.name || '') + '」'), 'i-package');
            versionsMod().loadInstances({ force: true });
        }
    }

    /* -----------------------------------------------------------------
       事件绑定
       ----------------------------------------------------------------- */

    function bindFolderMessages() {
        if (!window.chrome || !window.chrome.webview ||
            typeof window.chrome.webview.addEventListener !== 'function') return;

        window.chrome.webview.addEventListener('message', (event) => {
            let data = event.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (err) { return; }
            }
            onHostMessage(data);
        });
    }

    function requireHost() {
        if (hostMod().hasHost()) return true;
        uiMod().toast('浏览器预览里用不了这个功能，跑在启动器里才行', 'i-folder');
        return false;
    }

    /** 导入整合包：宿主弹文件框，解压到当前文件夹（默认就是启动器同级的 .minecraft）。 */
    function requestImport() {
        if (!requireHost()) return;
        uiMod().toast('选择整合包（zip / mrpack），会导入到当前文件夹', 'i-package');
        hostMod().hostPost({ type: 'import-modpack' });
    }

    function bindFolderList() {
        const list = $('#folderList');
        if (!list) return;

        list.addEventListener('click', (event) => {
            const row = event.target.closest('[data-folder-row]');
            if (row) selectFolder(row.dataset.folderRow, { toast: true });
        });

        list.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const row = event.target.closest('[data-folder-row]');
            if (!row) return;
            event.preventDefault();
            selectFolder(row.dataset.folderRow, { toast: true });
        });
    }

    function bindFolderActions() {
        const addBtn = $('#folderAdd');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (!requireHost()) return;
                hostMod().hostPost({ type: 'add-game-dirs', isolation: launchPrefs.isolation || 'all' });
            });
        }

        const importBtn = $('#folderImport');
        if (importBtn) importBtn.addEventListener('click', requestImport);

        // 页头的「导入」和侧栏的「导入整合包」是同一件事
        const headerImport = $('#instImport');
        if (headerImport) headerImport.addEventListener('click', requestImport);

        const openBtn = $('#folderOpen');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                if (!requireHost()) return;
                const folder = currentFolder();
                if (!folder) return;
                hostMod().hostPost({ type: 'open-game-dir', path: folder.path });
            });
        }

        const removeBtn = $('#folderRemove');
        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                if (!requireHost()) return;
                const folder = currentFolder();
                if (!folder) return;
                // 网页自绘的确认浮层（和 Custom.xaml 的 MyDialog 同一套），宿主不开系统窗口
                const confirmed = await hostMod().confirmDialog({
                    title: '移除游戏文件夹',
                    message: '把「' + (folder.name || folder.path) + '」从列表里移除？\n\n' +
                        '只会取消登记，磁盘上的文件一个都不会删。',
                    danger: true
                });
                if (!confirmed) return;

                hostMod().hostPost({ type: 'remove-game-dir', path: folder.path });
                ui.folderFilter = ALL;
                writeStore(STORE.uiPrefs, ui);
            });
        }

        const isoSelect = $('#folderIsolation');
        if (isoSelect) {
            isoSelect.addEventListener('change', () => {
                if (!requireHost()) return;
                const folder = currentFolder();
                if (!folder) return;
                hostMod().hostPost({ type: 'set-dir-isolation', path: folder.path, isolation: isoSelect.value });
            });
        }

        const rescanBtn = $('#folderRescan');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', async () => {
                const ok = await versionsMod().loadInstances({ force: true });
                uiMod().toast(ok
                    ? '已重新扫描 ' + folders().length + ' 个文件夹 · ' + SL.state.instances.length + ' 个版本'
                    : '扫描失败：' + (SL.state.scanState.error || '未知错误'),
                    ok ? 'i-refresh' : 'i-info');
            });
        }
    }

    function bindFolders() {
        bindFolderMessages();
        bindFolderList();
        bindFolderActions();
    }

    SL.folders = Object.assign(SL.folders || {}, {
        ALL, folders, currentFolder, renderFolderList, syncFolderView, updateCurrent,
        selectFolder, onHostMessage, bindFolders
    });
})(window);
