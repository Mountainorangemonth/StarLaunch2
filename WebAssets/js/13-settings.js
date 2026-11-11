/* =====================================================================
   StarLaunch · 设置：启动选项
   ---------------------------------------------------------------------
   内存分配、实例隔离、高级选项与分组切换。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, STORE, writeStore } = SL.core;
    const { launchPrefs, ui } = SL.state;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const homeMod = SL.core.mod('home');
    const paintRange = (...args) => homeMod.paintRange(...args);
    const versionsMod = SL.core.mod('versions');
    const applyScanState = (...args) => versionsMod.applyScanState(...args);
    const isolationLabel = (...args) => versionsMod.isolationLabel(...args);
    const appearanceMod = SL.core.mod('appearance');
    const bindAppearanceRange = (...args) => appearanceMod.bindAppearanceRange(...args);
    const renderPalette = (...args) => appearanceMod.renderPalette(...args);
    const renderWallpaperUI = (...args) => appearanceMod.renderWallpaperUI(...args);

    /* -----------------------------------------------------------------
       设置：启动选项 / 内存分配 / 高级选项
       ----------------------------------------------------------------- */
    const LAUNCH_TOTAL_MEM = 23.6;
    const LAUNCH_USED_MEM = 14.9;

    function launchAllocatedMem() {
        if (launchPrefs.memMode === 'auto') {
            return Math.max(2, Math.min(12, Math.round((LAUNCH_TOTAL_MEM - LAUNCH_USED_MEM) * 0.6)));
        }
        return Math.max(2, Math.min(20, Number(launchPrefs.mem) || 8));
    }

    function paintLaunchMemory() {
        const auto = launchPrefs.memMode === 'auto';
        const value = launchAllocatedMem();
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
            usedLabel.textContent = LAUNCH_USED_MEM.toFixed(1) + ' GB / ' + LAUNCH_TOTAL_MEM.toFixed(1) + ' GB';
        }

        const usedPct = Math.min(100, (LAUNCH_USED_MEM / LAUNCH_TOTAL_MEM) * 100);
        const gamePct = Math.min(100 - usedPct, (value / LAUNCH_TOTAL_MEM) * 100);
        if (usedBar) usedBar.style.width = usedPct + '%';
        if (gameBar) {
            gameBar.style.left = usedPct + '%';
            gameBar.style.width = gamePct + '%';
        }
    }

    function bindLaunchSettings() {
            const save = () => writeStore(STORE.launchPrefs, launchPrefs);
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
            setValue('#launchJavaList', launchPrefs.javaList || 'java21');
            setValue('#launchMemManager', launchPrefs.memoryManager || 'g1');
            setChecked('#launchMemOptimize', launchPrefs.memOptimize !== false);
            setChecked('#launchDisableWrapper', Boolean(launchPrefs.disableWrapper));
            setChecked('#launchDisableUnsafe', Boolean(launchPrefs.disableUnsafe));
            setChecked('#launchHighPerfGpu', launchPrefs.highPerfGpu !== false);
            setChecked('#launchMemAuto', launchPrefs.memMode !== 'custom');
            setChecked('#launchMemCustom', launchPrefs.memMode === 'custom');

            const syncWindowSize = () => {
                const modeEl = $('#launchWindowMode');
                const custom = !modeEl || modeEl.value === 'custom';
                ['#launchWinW', '#launchWinH'].forEach((sel) => {
                    const el = $(sel);
                    if (el) el.disabled = !custom;
                });
            };
            syncWindowSize();

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
            bindSelect('#launchWindowMode', 'windowMode', syncWindowSize);
            bindSelect('#launchJavaList', 'javaList');
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

            const syncSwitch = (label, key) => {
                const btn = $$('.set-panel[data-set-panel="launch"] .switch')
                    .find((item) => item.getAttribute('aria-label') === label);
                if (!btn) return;
                btn.setAttribute('aria-checked', String(Boolean(launchPrefs[key])));
                btn.addEventListener('click', () => {
                    launchPrefs[key] = btn.getAttribute('aria-checked') === 'true';
                    save();
                });
            };
            syncSwitch('启动前检查更新', 'updater');
            syncSwitch('启动完成后最小化窗口', 'minimize');

            const advancedBlock = $('#advancedBlock');
            const advancedToggle = $('#advancedToggle');
            const applyAdvanced = () => {
                if (!advancedBlock || !advancedToggle) return;
                const open = launchPrefs.advancedOpen !== false;
                advancedBlock.classList.toggle('is-collapsed', !open);
                advancedToggle.setAttribute('aria-expanded', String(open));
            };
            applyAdvanced();
            if (advancedToggle) {
                advancedToggle.addEventListener('click', () => {
                    launchPrefs.advancedOpen = launchPrefs.advancedOpen === false;
                    save();
                    applyAdvanced();
                });
            }

            const note = $('#advancedNote');
            if (note) note.hidden = launchPrefs.advancedNote === false;
            const noteClose = $('#advancedNoteClose');
            if (noteClose) {
                noteClose.addEventListener('click', () => {
                    launchPrefs.advancedNote = false;
                    save();
                    if (note) note.hidden = true;
                });
            }

            const javaRefresh = $('#launchJavaRefresh');
            if (javaRefresh) {
                javaRefresh.addEventListener('click', () => {
                    javaRefresh.classList.remove('is-spin');
                    void javaRefresh.offsetWidth;
                    javaRefresh.classList.add('is-spin');
                    toast('正在重新扫描本机 Java…', 'i-refresh');
                });
            }

            if (launchPrefs.memMode === 'auto') {
                launchPrefs.mem = launchAllocatedMem();
                save();
            }

            paintLaunchMemory();
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


    /* 事件绑定 */
    function bindSettings() {
        /* 设置：通用开关 */
        $$('.switch:not(#perfSwitch):not(#wpRotateSwitch)').forEach((btn) => {
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
    bindAppearanceRange('#glowRange', 'glow', (v) => v + '%');
    bindAppearanceRange('#contrastRange', 'contrast', (v) => (v > 0 ? '+' : '') + v);

    /* 设置：启动选项 */
    bindLaunchSettings();

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
                glass: 55, blur: 18, glow: 18, performance: false
            });
            renderPalette();
            toast('已恢复默认外观', 'i-refresh');
        });
    }

    /* 设置：壁纸库 */
    const wallpaperOpen = $('#wallpaperOpen');
    if (wallpaperOpen) {
        wallpaperOpen.addEventListener('click', () => {
            const webview = window.chrome && window.chrome.webview;
            if (webview && typeof webview.postMessage === 'function') {
                webview.postMessage({ type: 'open-wallpapers' });
                toast('已打开壁纸文件夹', 'i-folder');
            } else {
                toast('请通过 StarLaunch 宿主打开壁纸文件夹', 'i-info');
            }
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

    }

    SL.settings = Object.assign(SL.settings || {}, { LAUNCH_TOTAL_MEM, LAUNCH_USED_MEM, launchAllocatedMem, paintLaunchMemory, bindLaunchSettings, setSettingsTab, bindSettings });
})(window);
