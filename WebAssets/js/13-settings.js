/* =====================================================================
   StarLaunch · 设置：启动选项
   ---------------------------------------------------------------------
   内存分配、实例隔离、高级选项与分组切换。

   2026-11-15 补齐的那一批：
     · 内存读数不再是写死的 23.6 / 14.9 GB，改成问宿主要真实值
       （memory-status → GlobalMemoryStatusEx），自动配置按真实可用内存推算；
     · Java 列表不再是两条假选项，改成 JavaRuntime.Discover() 扫出来的真 Java；
     · 「自动清理安装缓存 / 检查启动器更新 / 记住窗口尺寸 / 关闭时最小化到托盘」
       四个开关以前点了只弹 toast，现在真写进宿主配置并生效；
     · 标题栏按钮位置会记住；
     · 「恢复默认」不再只重置外观，外观 / 启动 / 窗口 / 下载源一起还原。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, writeStore } = SL.core;
    const { launchPrefs, ui } = SL.state;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const hostMod = SL.core.mod('host');
    const homeMod = SL.core.mod('home');
    const paintRange = (...args) => homeMod.paintRange(...args);
    const versionsMod = SL.core.mod('versions');
    const applyScanState = (...args) => versionsMod.applyScanState(...args);
    const isolationLabel = (...args) => versionsMod.isolationLabel(...args);
    const appearanceMod = SL.core.mod('appearance');
    const bindAppearanceRange = (...args) => appearanceMod.bindAppearanceRange(...args);
    const renderPalette = (...args) => appearanceMod.renderPalette(...args);
    const renderWallpaperUI = (...args) => appearanceMod.renderWallpaperUI(...args);

    const hasHost = () => typeof hostMod.hasHost === 'function' && hostMod.hasHost();
    const canRequest = () => hasHost() && typeof hostMod.request === 'function';

    const GB = 1024 * 1024 * 1024;

    /* -----------------------------------------------------------------
       内存：真实读数
       -----------------------------------------------------------------
       浏览器预览里没有宿主，退回一组保守值，界面上仍然能拖动。
       ----------------------------------------------------------------- */
    const memory = { totalGb: 23.6, usedGb: 14.9, live: false };

    function roundGb(bytes) {
        return Math.round((Number(bytes) || 0) / GB * 10) / 10;
    }

    function applyMemoryStatus(data) {
        if (!data) return;
        const total = Number(data.totalBytes) || 0;
        if (total <= 0) return;

        memory.totalGb = roundGb(total);
        memory.usedGb = roundGb(data.usedBytes == null
            ? Math.max(0, total - (Number(data.availableBytes) || 0))
            : data.usedBytes);
        memory.live = true;

        paintLaunchMemory();
        // 主页的内存卡片和版本设置里的内存条读的是同一份读数，一起重画
        const homeMod2 = SL.core.mod('home');
        if (homeMod2 && typeof homeMod2.paintHomeMemory === 'function') homeMod2.paintHomeMemory();
        const instMod2 = SL.core.mod('instance');
        if (instMod2 && typeof instMod2.refreshMemory === 'function') instMod2.refreshMemory();
    }

    /** 本机内存读数（主页 / 版本设置 / 设置页共用）。live=false 表示还在用保守值。 */
    function memoryStatus() {
        return {
            totalGb: memory.totalGb,
            usedGb: memory.usedGb,
            availableGb: Math.max(0, memory.totalGb - memory.usedGb),
            live: memory.live
        };
    }

    /** 重新问一次本机内存（启动页切过去、内存优化之后都调它）。 */
    function refreshMemoryStatus() {
        if (!canRequest()) {
            paintLaunchMemory();
            return Promise.resolve();
        }

        return hostMod.request('memory-status')
            .then(applyMemoryStatus)
            .catch(() => { paintLaunchMemory(); });
    }

    function launchAllocatedMem() {
        if (launchPrefs.memMode === 'auto') {
            const available = Math.max(1, memory.totalGb - memory.usedGb);
            // 和 PCL 一个思路：拿可用内存的六成，夹在 2~12 GB
            return Math.max(2, Math.min(12, Math.round(available * 0.6)));
        }
        return Math.max(2, Math.min(20, Number(launchPrefs.mem) || 8));
    }

    function paintLaunchMemory() {
        const auto = launchPrefs.memMode === 'auto';
        const value = launchAllocatedMem();
        const total = memory.totalGb;
        const used = Math.min(memory.usedGb, total);

        const range = $('#launchMemRange');
        const label = $('#launchMemValue');
        const usedLabel = $('#memUsedLabel');
        const gameLabel = $('#memGameLabel');
        const usedBar = $('#memMeterUsed');
        const gameBar = $('#memMeterGame');

        if (range) {
            range.disabled = auto;
            range.value = String(auto ? value : (Number(launchPrefs.mem) || 8));
            paintRange(range);
        }
        if (label) label.textContent = value + ' GB';
        if (gameLabel) gameLabel.textContent = value + ' GB';
        if (usedLabel) {
            usedLabel.textContent = used.toFixed(1) + ' GB / ' + total.toFixed(1) + ' GB';
            usedLabel.title = memory.live ? '来自本机实时读数' : '浏览器预览：没有读到真实内存';
        }

        const usedPct = Math.min(100, (used / total) * 100);
        const gamePct = Math.min(100 - usedPct, (value / total) * 100);
        if (usedBar) usedBar.style.width = usedPct + '%';
        if (gameBar) {
            gameBar.style.left = usedPct + '%';
            gameBar.style.width = gamePct + '%';
        }
    }

    /* -----------------------------------------------------------------
       启动设置：控件回填（不挂监听）
       ----------------------------------------------------------------- */
    function syncLaunchControls() {
        const setValue = (sel, value) => {
            const el = $(sel);
            if (el) el.value = value;
        };
        const setChecked = (sel, value) => {
            const el = $(sel);
            if (el) el.checked = Boolean(value);
        };

        setValue('#launchIsolation', launchPrefs.isolation || 'all');
        setValue('#launchWindowTitle', launchPrefs.windowTitle || '');
        setValue('#launchCustomInfo', launchPrefs.customInfo || '');
        setValue('#launchVisibility', launchPrefs.visibility || 'unchanged');
        setValue('#launchPriority', launchPrefs.priority || 'normal');
        setValue('#launchWindowMode', launchPrefs.windowMode || 'custom');
        setValue('#launchWinW', launchPrefs.winW || 854);
        setValue('#launchWinH', launchPrefs.winH || 480);
        setValue('#launchJvmArgs', launchPrefs.jvmArgs || '');
        setValue('#launchGameArgs', launchPrefs.gameArgs || '');
        setValue('#launchPreCommand', launchPrefs.preCommand || '');
        setValue('#launchMemManager', launchPrefs.memoryManager || 'g1');
        setChecked('#launchMemOptimize', launchPrefs.memOptimize !== false);
        setChecked('#launchDisableWrapper', Boolean(launchPrefs.disableWrapper));
        setChecked('#launchDisableUnsafe', Boolean(launchPrefs.disableUnsafe));
        setChecked('#launchHighPerfGpu', launchPrefs.highPerfGpu !== false);
        setChecked('#launchMemAuto', launchPrefs.memMode !== 'custom');
        setChecked('#launchMemCustom', launchPrefs.memMode === 'custom');

        const modeEl = $('#launchWindowMode');
        const custom = !modeEl || modeEl.value === 'custom';
        ['#launchWinW', '#launchWinH'].forEach((sel) => {
            const el = $(sel);
            if (el) el.disabled = !custom;
        });

        // Java 下拉框的选项由 refreshJavaList 填充；这里只负责让它选中原来那台
        const javaSelect = $('#launchJavaList');
        if (javaSelect) {
            const wanted = launchPrefs.javaList || 'auto';
            const exists = Array.prototype.some.call(
                javaSelect.options, (option) => option.value === wanted);
            javaSelect.value = exists ? wanted : 'auto';
            launchPrefs.javaList = javaSelect.value;
        }

        const advancedBlock = $('#advancedBlock');
        const advancedToggle = $('#advancedToggle');
        const open = launchPrefs.advancedOpen !== false;
        if (advancedBlock) advancedBlock.classList.toggle('is-collapsed', !open);
        if (advancedToggle) advancedToggle.setAttribute('aria-expanded', String(open));

        const note = $('#advancedNote');
        if (note) note.hidden = launchPrefs.advancedNote === false;

        // 「启动前检查更新」「启动完成后最小化」这两个开关也回填
        setSwitchByLabel('启动前检查更新', launchPrefs.updater !== false);
        setSwitchByLabel('启动完成后最小化窗口', Boolean(launchPrefs.minimize));
    }

    /** 按 aria-label 找开关（页面上这两个 switch 没有 id）。 */
    function findSwitch(label) {
        return $$('.switch').find((btn) => btn.getAttribute('aria-label') === label) || null;
    }

    function setSwitchByLabel(label, on) {
        const btn = findSwitch(label);
        if (btn) btn.setAttribute('aria-checked', String(Boolean(on)));
    }

    /* -----------------------------------------------------------------
       启动设置：事件
       ----------------------------------------------------------------- */
    function bindLaunchSettings() {
        const save = () => writeStore(STORE.launchPrefs, launchPrefs);

        const bindText = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('input', () => { launchPrefs[key] = el.value; });
            el.addEventListener('change', save);
        };

        bindText('#launchWindowTitle', 'windowTitle');
        bindText('#launchCustomInfo', 'customInfo');
        bindText('#launchJvmArgs', 'jvmArgs');
        bindText('#launchGameArgs', 'gameArgs');
        bindText('#launchPreCommand', 'preCommand');

        const bindSelect = (sel, key, after) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('change', () => {
                launchPrefs[key] = el.value;
                save();
                if (after) after();
            });
        };

        // 这个策略只作为「之后添加的新文件夹」的默认值；已有文件夹在版本管理里各自设置
        bindSelect('#launchIsolation', 'isolation', () => {
            applyScanState();
            toast('新添加的文件夹默认使用「' + isolationLabel() + '」', 'i-shield');
        });
        bindSelect('#launchVisibility', 'visibility');
        bindSelect('#launchPriority', 'priority');
        bindSelect('#launchWindowMode', 'windowMode', () => {
            const modeEl = $('#launchWindowMode');
            const custom = !modeEl || modeEl.value === 'custom';
            ['#launchWinW', '#launchWinH'].forEach((sel) => {
                const el = $(sel);
                if (el) el.disabled = !custom;
            });
        });
        bindSelect('#launchMemManager', 'memoryManager');

        const bindNumber = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('input', () => { launchPrefs[key] = Number(el.value) || 0; });
            el.addEventListener('change', save);
        };
        bindNumber('#launchWinW', 'winW');
        bindNumber('#launchWinH', 'winH');

        const bindCheck = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('change', () => {
                launchPrefs[key] = el.checked;
                save();
            });
        };
        bindCheck('#launchMemOptimize', 'memOptimize');
        bindCheck('#launchDisableWrapper', 'disableWrapper');
        bindCheck('#launchDisableUnsafe', 'disableUnsafe');
        bindCheck('#launchHighPerfGpu', 'highPerfGpu');

        $$('input[name="launchMemMode"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                launchPrefs.memMode = radio.value;
                if (radio.value === 'custom' && !launchPrefs.mem) launchPrefs.mem = 8;
                if (radio.value === 'auto') launchPrefs.mem = launchAllocatedMem();
                save();
                paintLaunchMemory();
            });
        });

        const memRange = $('#launchMemRange');
        if (memRange) {
            memRange.addEventListener('input', () => {
                launchPrefs.mem = Number(memRange.value);
                paintLaunchMemory();
            });
            memRange.addEventListener('change', () => {
                save();
                toast('已设置游戏内存：' + launchAllocatedMem() + ' GB', 'i-chip');
            });
        }

        const bindSwitch = (label, key) => {
            const btn = findSwitch(label);
            if (!btn) return;
            btn.addEventListener('click', () => {
                launchPrefs[key] = btn.getAttribute('aria-checked') === 'true';
                save();
            });
        };
        bindSwitch('启动前检查更新', 'updater');
        bindSwitch('启动完成后最小化窗口', 'minimize');

        const advancedToggle = $('#advancedToggle');
        if (advancedToggle) {
            advancedToggle.addEventListener('click', () => {
                launchPrefs.advancedOpen = launchPrefs.advancedOpen === false;
                save();
                const block = $('#advancedBlock');
                if (block) block.classList.toggle('is-collapsed', launchPrefs.advancedOpen === false);
                advancedToggle.setAttribute('aria-expanded', String(launchPrefs.advancedOpen !== false));
            });
        }

        const noteClose = $('#advancedNoteClose');
        if (noteClose) {
            noteClose.addEventListener('click', () => {
                launchPrefs.advancedNote = false;
                save();
                const note = $('#advancedNote');
                if (note) note.hidden = true;
            });
        }

        bindJavaList();

        if (launchPrefs.memMode === 'auto') {
            launchPrefs.mem = launchAllocatedMem();
            save();
        }

        paintLaunchMemory();
    }

    /* -----------------------------------------------------------------
       Java 列表：真实扫描
       ----------------------------------------------------------------- */
    let javaLoading = false;

    function renderJavaList(list) {
        const select = $('#launchJavaList');
        if (!select) return;

        const wanted = launchPrefs.javaList || 'auto';
        const items = Array.isArray(list) ? list : [];

        select.innerHTML = '';
        const auto = document.createElement('option');
        auto.value = 'auto';
        auto.textContent = '自动匹配（推荐）';
        select.appendChild(auto);

        items.forEach((item) => {
            const path = String(item.path || '').trim();
            if (!path) return;
            const option = document.createElement('option');
            option.value = path;
            option.textContent = String(item.label || ('Java ' + (item.version || '')));
            option.title = path;
            select.appendChild(option);
        });

        const exists = Array.prototype.some.call(select.options, (option) => option.value === wanted);
        select.value = exists ? wanted : 'auto';
        launchPrefs.javaList = select.value;
        writeStore(STORE.launchPrefs, launchPrefs);

        // 下拉框是自绘的（18-select.js），选项被重建后它会自己跟上
        if (SL.select && typeof SL.select.close === 'function') SL.select.close();
    }

    /** 让宿主扫一遍本机 Java 并更新下拉框（force 为真时忽略宿主的缓存）。 */
    function refreshJavaList(force) {
        if (!canRequest()) {
            renderJavaList([]);
            return Promise.resolve();
        }
        if (javaLoading) return Promise.resolve();

        javaLoading = true;
        const refreshBtn = $('#launchJavaRefresh');
        if (refreshBtn) refreshBtn.classList.add('is-spin');

        return hostMod.request('java-list', { refresh: Boolean(force) }, 30000)
            .then((data) => {
                renderJavaList(data && data.list);
                return data && data.list ? data.list.length : 0;
            })
            .catch((err) => {
                toast('扫描 Java 失败：' + err.message, 'i-info');
                return 0;
            })
            .then((count) => {
                javaLoading = false;
                if (refreshBtn) refreshBtn.classList.remove('is-spin');
                return count;
            });
    }

    function bindJavaList() {
        const select = $('#launchJavaList');
        if (select) {
            select.addEventListener('change', () => {
                launchPrefs.javaList = select.value;
                writeStore(STORE.launchPrefs, launchPrefs);
                if (select.value === 'auto') {
                    toast('启动时会按版本要求自动挑 Java', 'i-chip');
                } else {
                    toast('已固定使用 ' + select.options[select.selectedIndex].textContent, 'i-chip');
                }
            });
        }

        const refreshBtn = $('#launchJavaRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                toast('正在扫描本机 Java…', 'i-refresh');
                refreshJavaList(true).then((count) => {
                    if (count) toast('找到 ' + count + ' 个 Java', 'i-check');
                    else if (canRequest()) toast('没有找到可用的 Java', 'i-info');
                });
            });
        }

        // 先放「自动匹配」，等宿主回包再换成真实列表
        renderJavaList([]);
        refreshJavaList(false);
    }

    /* -----------------------------------------------------------------
       宿主侧开关：缓存 / 更新 / 窗口尺寸 / 托盘
       ----------------------------------------------------------------- */
    const HOST_SWITCHES = [
        { label: '自动清理安装缓存', key: 'cleanInstallCache' },
        { label: '检查启动器更新', key: 'checkUpdate' },
        { label: '记住窗口尺寸', key: 'rememberWindowSize' },
        { label: '关闭时最小化到托盘', key: 'closeToTray' }
    ];

    function bindHostSwitches() {
        HOST_SWITCHES.forEach((item) => {
            const btn = findSwitch(item.label);
            if (!btn) return;

            // 打个标记，通用开关处理器会跳过它（否则会双重翻转 + 只弹 toast）
            btn.dataset.hostSwitch = '1';

            btn.addEventListener('click', () => {
                const next = btn.getAttribute('aria-checked') !== 'true';

                if (!hasHost()) {
                    toast('这个开关要在启动器里才有用', 'i-info');
                    btn.setAttribute('aria-checked', String(!next));
                    return;
                }

                const payload = { type: 'set-host-settings' };
                payload[item.key] = next;
                hostMod.hostPost(payload);

                if (item.key === 'closeToTray' && next) {
                    // Win11 默认把新图标塞进「^」溢出区，先把这话说清楚，免得以为没生效
                    toast('已开启后台模式：托盘图标在任务栏右下角（Win11 可能收在 ^ 里）', 'i-info');
                }

                if (item.key === 'checkUpdate' && next) {
                    hostMod.request('check-update')
                        .then((info) => {
                            toast(info && info.available
                                ? '发现新版本 ' + info.latest
                                : '已经是最新版本', 'i-download');
                        })
                        .catch((err) => toast(err.message, 'i-info'));
                }
            });
        });

        if (!canRequest()) return;

        hostMod.request('host-settings')
            .then((settings) => {
                if (!settings) return;
                HOST_SWITCHES.forEach((item) => {
                    const btn = findSwitch(item.label);
                    if (btn) btn.setAttribute('aria-checked', String(settings[item.key] === true));
                });
            })
            .catch(() => { });
    }

    /* -----------------------------------------------------------------
       标题栏按钮位置
       ----------------------------------------------------------------- */
    function applyWindowStyle(style) {
        const center = style === 'center';
        const titlebar = $('#titlebar');
        if (titlebar) titlebar.classList.toggle('controls-center', center);

        $$('[data-win-style]').forEach((item) => {
            const active = item.dataset.winStyle === (center ? 'center' : 'right');
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-pressed', String(active));
        });
    }

    function bindWindowStyle() {
        applyWindowStyle(ui.winStyle || 'right');

        $$('[data-win-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                ui.winStyle = btn.dataset.winStyle === 'center' ? 'center' : 'right';
                writeStore(STORE.uiPrefs, ui);
                applyWindowStyle(ui.winStyle);
            });
        });
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

        // 切到启动设置时顺手刷新一次内存读数（开机久了数值会变）
        if (tab === 'launch') refreshMemoryStatus();
    }

    /* -----------------------------------------------------------------
       恢复默认
       ----------------------------------------------------------------- */
    function resetToDefaults() {
        // 外观
        window.StarTheme.update({
            seed: '#7c6ce6', variant: 'tonalSpot', mode: 'auto', contrast: 0,
            roles: { accent: 'primary', selected: 'primary', hero: 'primary' },
            glass: 55, blur: 18, glow: 18, performance: false
        });
        renderPalette();
        renderWallpaperUI();

        // 启动设置：整套还原成出厂值（保留窗口尺寸记忆这类纯宿主状态）
        const defaults = SL.state.DEFAULT_LAUNCH_PREFS || {};
        Object.keys(launchPrefs).forEach((key) => { delete launchPrefs[key]; });
        Object.assign(launchPrefs, JSON.parse(JSON.stringify(defaults)));
        writeStore(STORE.launchPrefs, launchPrefs);
        syncLaunchControls();
        paintLaunchMemory();

        // 下载与账户：并发数回到默认，下载源回到镜像 + 自动
        launchPrefs.concurrency = 8;
        writeStore(STORE.launchPrefs, launchPrefs);
        const concurrency = $('#concurrency');
        if (concurrency) {
            concurrency.value = '8';
            paintRange(concurrency);
            const label = $('#concurrencyValue');
            if (label) label.textContent = '8';
        }
        const downloadMod = SL.core.mod('download');
        if (downloadMod && typeof downloadMod.setConcurrency === 'function') {
            downloadMod.setConcurrency(8, false);
        }
        // 这两组按钮的点击处理器在 11-download.js 里，点一下最省事也最一致
        const sourceBtn = $('#dlSourceSet [data-dl-source="BMCLAPI"]');
        if (sourceBtn) sourceBtn.click();
        const modSourceBtn = $('#modSourceSet [data-dl-mod-source="auto"]');
        if (modSourceBtn) modSourceBtn.click();

        // 窗口
        ui.winStyle = 'right';
        writeStore(STORE.uiPrefs, ui);
        applyWindowStyle('right');

        // 宿主行为：恢复成默认（清理缓存 / 检查更新开，托盘关）
        if (hasHost()) {
            hostMod.hostPost({
                type: 'set-host-settings',
                cleanInstallCache: true,
                checkUpdate: true,
                rememberWindowSize: true,
                closeToTray: false
            });
            HOST_SWITCHES.forEach((item) => {
                const btn = findSwitch(item.label);
                if (btn) btn.setAttribute('aria-checked', String(item.key !== 'closeToTray'));
            });
        }

        toast('已恢复默认设置（外观 / 启动 / 下载 / 窗口）', 'i-refresh');
    }

    /* -----------------------------------------------------------------
       事件绑定总入口
       ----------------------------------------------------------------- */
    function bindSettings() {
        /* 通用开关：先跳过宿主开关和版本设置浮层里的开关 */
        $$('.switch:not(.iset-switch):not(#perfSwitch):not(#wpRotateSwitch)').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.hostSwitch) return;
                const next = btn.getAttribute('aria-checked') !== 'true';
                btn.setAttribute('aria-checked', String(next));
                const label = btn.getAttribute('aria-label') || '选项';
                toast(label + (next ? ' 已开启' : ' 已关闭'), next ? 'i-check' : 'i-info');
            });
        });

        /* 性能模式 */
        const perfSwitch = $('#perfSwitch');
        if (perfSwitch) {
            perfSwitch.addEventListener('click', () => {
                const next = !window.StarTheme.state.performance;
                window.StarTheme.update({ performance: next });
                renderPalette();
                toast(next ? '性能模式已开启：模糊与泛光已关闭' : '性能模式已关闭', 'i-palette');
            });
        }

        /* 外观滑杆 */
        bindAppearanceRange('#glassRange', 'glass', (v) => v + '%');
        bindAppearanceRange('#blurRange', 'blur', (v) => v + ' px');
        bindAppearanceRange('#glowRange', 'glow', (v) => v + '%');
        bindAppearanceRange('#contrastRange', 'contrast', (v) => (v > 0 ? '+' : '') + v);

        /* 启动选项 */
        syncLaunchControls();
        bindLaunchSettings();
        bindHostSwitches();
        bindWindowStyle();

        /* 并发数 */
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
                // 让宿主的下载器也按这个并发数跑（没宿主时什么也不做）
                const downloadMod = SL.core.mod('download');
                if (typeof downloadMod.setConcurrency === 'function') {
                    downloadMod.setConcurrency(launchPrefs.concurrency, false);
                }
            };
            concurrency.addEventListener('input', update);
            update();
        }

        /* 分组 */
        $$('#setNav [data-set-nav]').forEach((btn) => {
            btn.addEventListener('click', () => setSettingsTab(btn.dataset.setNav));
        });

        /* 恢复默认 */
        const resetAll = $('#resetAll');
        if (resetAll) {
            resetAll.addEventListener('click', () => {
                const run = () => resetToDefaults();
                if (typeof uiMod.dialog === 'function') {
                    uiMod.dialog({
                        title: '恢复默认设置',
                        message: '外观、启动设置、下载源和窗口设置都会回到出厂状态。\n\n' +
                            '已安装的版本、账户和游戏文件夹不会受影响。',
                        okLabel: '恢复默认',
                        cancelLabel: '取消',
                        danger: true
                    }).then((confirmed) => { if (confirmed) run(); }, () => { });
                } else {
                    run();
                }
            });
        }

        /* 壁纸库 */
        const wallpaperOpen = $('#wallpaperOpen');
        if (wallpaperOpen) {
            wallpaperOpen.addEventListener('click', () => {
                // 打开成功 / 失败都由宿主回执决定提示，这里不再抢先 toast
                hostMod.openLocation('open-wallpapers', null, '壁纸文件夹');
            });
        }

        const wallpaperRefresh = $('#wallpaperRefresh');
        if (wallpaperRefresh) {
            wallpaperRefresh.addEventListener('click', () => {
                toast('正在重新扫描壁纸文件夹…', 'i-refresh');
                window.StarTheme.reloadWallpapers().then((ok) => {
                    if (ok) toast('壁纸库已更新', 'i-check');
                    else toast('没有读取到壁纸文件夹，请通过宿主运行', 'i-info');
                });
            });
        }

        const wallpaperToggle = $('#wallpaperToggle');
        if (wallpaperToggle) {
            wallpaperToggle.addEventListener('click', () => appearanceMod.toggleWallpaperFold());
        }

        const wpRotate = $('#wpRotateSwitch');
        if (wpRotate) {
            wpRotate.addEventListener('click', () => {
                const next = !window.StarTheme.state.wallpaperRotate;
                window.StarTheme.update({ wallpaperRotate: next });
                renderWallpaperUI();
                toast(next ? '壁纸自动切换已开启' : '壁纸自动切换已关闭', next ? 'i-check' : 'i-info');
            });
        }

        /* 从当前壁纸重新取色 */
        const seedFromWallpaper = $('#seedFromWallpaper');
        if (seedFromWallpaper) {
            seedFromWallpaper.addEventListener('click', () => {
                if (!window.StarTheme.state.wallpaper) {
                    toast('还没有设置壁纸', 'i-info');
                    return;
                }
                toast('正在从壁纸取色…', 'i-palette');
                window.StarTheme.resampleWallpaper().then((ok) => {
                    if (ok) {
                        renderPalette();
                        toast('已从当前壁纸重新取色', 'i-palette');
                    } else {
                        toast('取色失败，已保留当前源色', 'i-info');
                    }
                });
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

        /* 启动设置面板：先把真实内存读出来 */
        refreshMemoryStatus();
    }

    SL.settings = Object.assign(SL.settings || {}, {
        launchAllocatedMem, paintLaunchMemory, bindLaunchSettings, bindSettings, setSettingsTab,
        refreshMemoryStatus, applyMemoryStatus, memoryStatus, refreshJavaList, renderJavaList, resetToDefaults
    });

    // 19-instance.js 的内存条要读这两个值；用 getter 才会跟着实时读数变
    Object.defineProperties(SL.settings, {
        LAUNCH_TOTAL_MEM: { get: () => memory.totalGb, enumerable: true },
        LAUNCH_USED_MEM: { get: () => memory.usedGb, enumerable: true }
    });
})(window);
