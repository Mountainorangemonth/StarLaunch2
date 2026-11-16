/* =====================================================================
   StarLaunch · 主页：实例与内存
   ---------------------------------------------------------------------
   主页的当前实例选择与内存滑杆。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, STORE, escapeHtml, writeStore } = SL.core;
    const { activeInstance, modsLabel, ui } = SL.state;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);

    /* -----------------------------------------------------------------
       主页：实例
       ----------------------------------------------------------------- */
    function renderInstanceOptions() {
        const host = $('#instOptions');
        if (!host) return;
        host.innerHTML = SL.state.instances.map((inst) => {
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
        if (count) count.textContent = SL.state.instances.length + ' 个';
    }

    function paintRange(input) {
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value || 0);
        const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--p', pct.toFixed(2) + '%');
    }

    /* -----------------------------------------------------------------
       主页：内存读数
       -----------------------------------------------------------------
       这里以前全是写死的：文字「8 / 32 GB」、「本机 32 GB」、滑杆 max=32。
       本机多大、已经用掉多少，只有宿主知道（memory-status →
       GlobalMemoryStatusEx），所以统一从 SL.settings 的读数取值。
       ----------------------------------------------------------------- */
    function memoryInfo() {
        const settingsMod = SL.core.mod('settings');
        const info = settingsMod && typeof settingsMod.memoryStatus === 'function'
            ? settingsMod.memoryStatus()
            : null;
        const total = Number(info && info.totalGb) || 0;
        const used = Number(info && info.usedGb) || 0;
        return {
            total: total > 0 ? total : 0,
            used: Math.max(0, Math.min(used, total > 0 ? total : used)),
            live: Boolean(info && info.live)
        };
    }

    /** 本机总量（GB，一位小数）；读不到时返回 0。 */
    function totalGb() {
        return memoryInfo().total;
    }

    function totalText() {
        const total = totalGb();
        return total > 0 ? total.toFixed(1) + ' GB' : '本机内存';
    }

    /** 滑杆上限跟着真机走：不超过物理内存，最多 32 GB。 */
    function paintMemRanges() {
        const total = totalGb();
        if (total <= 0) return;
        const max = Math.max(2, Math.min(32, Math.floor(total)));

        ['#homeMemRange', '#vMemRange'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            if (Number(input.max) !== max) input.max = String(max);
            if (Number(input.value) > max) input.value = String(max);
            paintRange(input);
        });
    }

    /** 只重画内存相关的文字/刻度，不动实例数据。 */
    function paintHomeMemory() {
        const info = memoryInfo();
        const hostLabel = $('#hostMem');
        if (hostLabel) {
            if (info.total > 0) {
                hostLabel.textContent = '本机 ' + info.total.toFixed(1) + ' GB';
                hostLabel.title = info.live
                    ? '已用 ' + info.used.toFixed(1) + ' GB · 可用 ' +
                        Math.max(0, info.total - info.used).toFixed(1) + ' GB（本机实时读数）'
                    : '浏览器预览：没有读到本机内存，这是保守值';
            } else {
                hostLabel.textContent = '本机内存读取中…';
                hostLabel.title = '';
            }
        }

        paintMemRanges();
        syncMem(activeInstance());
    }

    function refreshHomeMemory() {
        const settingsMod = SL.core.mod('settings');
        if (settingsMod && typeof settingsMod.refreshMemoryStatus === 'function') {
            settingsMod.refreshMemoryStatus();
        } else {
            paintHomeMemory();
        }
        return paintHomeMemory();
    }

    function syncMem(inst) {
        const homeRange = $('#homeMemRange');
        const vRange = $('#vMemRange');
        const curText = $('#curMemText');
        const vLabel = $('#vMemLabel');
        if (!inst || !inst.id) {
            if (curText) curText.textContent = '— / ' + totalText();
            return;
        }
        const total = totalText();
        if (curText) curText.textContent = inst.mem + ' / ' + total;
        if (homeRange && inst.id === ui.activeId) { homeRange.value = String(inst.mem); paintRange(homeRange); }
        if (vRange && inst.id === ui.activeId) { vRange.value = String(inst.mem); paintRange(vRange); }
        if (vLabel) vLabel.textContent = inst.mem + ' GB';
        const row = $('[data-instance-row="' + inst.id + '"] .inst-row-side');
        if (row) row.textContent = inst.mem + ' GB';
    }


    /* 事件绑定 */
    function bindHomeMemory() {
        /* 内存滑杆（主页 + 版本详情同一份数据，写进这个版本的设置文件） */
        ['#homeMemRange', '#vMemRange'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            paintRange(input);

            const applyMemory = (delay) => {
                const inst = activeInstance();
                if (!inst.id) return null;
                const gb = Number(input.value);
                const instMod = SL.core.mod('instance');
                if (typeof instMod.updateSettings === 'function') {
                    instMod.updateSettings(inst, { memoryMode: 'custom', memoryMb: gb * 1024 }, { delay: delay });
                } else {
                    // 模块没就位时退回旧的本地字段，至少不要把界面丢掉
                    inst.mem = gb;
                    ui.instanceMem = ui.instanceMem || {};
                    ui.instanceMem[inst.id] = gb;
                    writeStore(STORE.uiPrefs, ui);
                }
                syncMem(inst);
                return inst;
            };

            input.addEventListener('input', () => {
                applyMemory(600);
                paintRange(input);
            });
            input.addEventListener('change', () => {
                const inst = applyMemory(0);
                if (!inst) return;
                toast('已为「' + inst.name + '」分配 ' + inst.mem + ' GB 内存', 'i-chip');
            });
        });

        // 本机内存是宿主给的：启动就问一次，别让卡片一直显示写死的 32 GB
        refreshHomeMemory();
    }

    /* -----------------------------------------------------------------
       主页：内存优化
       -----------------------------------------------------------------
       宿主那边是 Services/MemoryOptimizer.cs（空闲感知压缩工作集 + 清待机列表），
       这里只管「点一下 → 按钮进入优化中 → 收到 memory-result 说结果」。
       浏览器预览没有宿主，只提示一句。
       ----------------------------------------------------------------- */
    let memBusy = false;

    function formatMemBytes(value) {
        const bytes = Number(value) || 0;
        if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        if (bytes >= 1024 * 1024) return Math.round(bytes / 1024 / 1024) + ' MB';
        if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
        return bytes + ' B';
    }

    function setMemBusy(busy) {
        memBusy = busy;
        const btn = $('#memOptimizeBtn');
        if (!btn) return;
        btn.disabled = busy;
        btn.classList.toggle('is-busy', busy);
        btn.setAttribute('aria-busy', String(busy));
        const label = btn.querySelector('span');
        if (label) label.textContent = busy ? '优化中…' : '内存优化';
    }

    function optimizeMemory() {
        if (memBusy) return;
        const hostMod = SL.core.mod('host');
        if (!(typeof hostMod.hasHost === 'function' && hostMod.hasHost())) {
            toast('内存优化要在启动器里运行', 'i-info');
            return;
        }
        setMemBusy(true);
        hostMod.hostPost({ type: 'memory-optimize' });
        toast('正在整理内存，可能要几秒…', 'i-chip');
    }

    function onMemoryResult(data) {
        setMemBusy(false);
        if (!data || data.ok !== true) {
            const message = (data && data.error) || '内存优化失败';
            // pending = 宿主的 Cleanup() 还没实现，这条是给开发看的，别用 toast 一闪而过
            if (data && data.pending && typeof uiMod.dialog === 'function') {
                uiMod.dialog({
                    title: '内存优化还没接上',
                    message: message,
                    okLabel: '知道了',
                    cancelLabel: null
                });
                return;
            }
            toast(message, 'i-info');
            return;
        }

        const freed = formatMemBytes(data.freedBytes);
        const after = formatMemBytes(data.afterBytes);
        toast(Number(data.freedBytes) > 0
            ? '内存优化完成 · 释放 ' + freed + '，当前可用 ' + after
            : '内存优化完成，当前可用 ' + after, 'i-check');

        // 明细（压了几个进程 / 跳过了几个）写进启动日志，toast 放不下这么多字
        if (data.detail) {
            const noticeMod = SL.core.mod('notice');
            if (noticeMod && typeof noticeMod.recordLaunchLog === 'function') {
                noticeMod.recordLaunchLog('· 内存优化：' + data.detail);
            }
        }

        // 设置页的内存条跟着刷新一次
        const settingsMod = SL.core.mod('settings');
        if (settingsMod && typeof settingsMod.refreshMemoryStatus === 'function') {
            settingsMod.refreshMemoryStatus();
        }
    }

    function bindMemoryOptimize() {
        const btn = $('#memOptimizeBtn');
        if (btn) btn.addEventListener('click', optimizeMemory);

        const webview = window.chrome && window.chrome.webview;
        if (!webview || typeof webview.addEventListener !== 'function') return;
        webview.addEventListener('message', (event) => {
            let data = event.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (err) { return; }
            }
            if (!data || typeof data.type !== 'string') return;
            if (data.type === 'memory-start') setMemBusy(true);
            else if (data.type === 'memory-result') onMemoryResult(data);
        });
    }

    /* -----------------------------------------------------------------
       主页：本周游戏
       -----------------------------------------------------------------
       以前那 7 根柱子、12.6 小时、+18% 全是写死在 index.html 里的假数据。
       现在数据来自宿主：每次启动游戏 PlayStats 记一条会话，这里按周一起
       的 7 天画出来。浏览器预览没有宿主，用一份示例数据撑住界面。
       ----------------------------------------------------------------- */
    const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

    function hoursOf(seconds) {
        return (Number(seconds) || 0) / 3600;
    }

    function renderWeek(week) {
        const chart = $('#weekChart');
        if (!chart) return;

        const days = (week && Array.isArray(week.days)) ? week.days : [];
        const total = Number(week && week.totalSeconds) || 0;
        const sessions = Number(week && week.sessions) || 0;
        // deltaPercent 可能是 null（上周同期一分钟都没玩 = 没有可比的基数）。
        // 别用 Number(x) || 0：那会把 null 变成 0，界面上就出现一个假的「+0%」。
        const rawDelta = week ? week.deltaPercent : null;
        const delta = (rawDelta === null || rawDelta === undefined || rawDelta === '')
            ? null
            : Number(rawDelta);
        const comparedSeconds = Number(week && week.comparedSeconds) || 0;
        const comparedDays = Number(week && week.comparedDays) || 0;
        const lastWeek = Number(week && week.lastWeekSeconds) || 0;

        const totalEl = $('#weekTotal');
        if (totalEl) totalEl.textContent = hoursOf(total).toFixed(1);

        const noteEl = $('#weekSessions');
        if (noteEl) noteEl.textContent = '共 ' + sessions + ' 次启动';

        const deltaEl = $('#weekDelta');
        if (deltaEl) {
            // 只有「上周同期真的玩过一会儿」时这个百分比才有意义。
            // 宿主给的是同一段日历时间的对比（周一早上只比上周一早上），
            // 基数太小时百分比会乱跳（上周同期 3 分钟 → 今天没玩就是 -100%），
            // 所以不到 5 分钟就当没有可比数据，直接不显示。
            const comparable = delta !== null && !Number.isNaN(delta) && comparedSeconds >= 300;

            if (!comparable) {
                deltaEl.hidden = true;
                deltaEl.textContent = '';
                deltaEl.classList.remove('is-down');
                deltaEl.removeAttribute('title');
                if (lastWeek > 0 && comparedSeconds <= 0) {
                    // 上周玩过，但那段日子里没留下记录：说清楚为什么没有对比
                    deltaEl.title = '上周同期没有可比的记录';
                }
            } else {
                const rounded = Math.round(delta);
                deltaEl.hidden = false;
                // 四舍五入到 0 就显示 0%，不显示「-0%」
                deltaEl.textContent = (rounded > 0 ? '+' : '') + rounded + '%';
                deltaEl.classList.toggle('is-down', rounded < 0);
                deltaEl.title = '比较的是上周同期（周一起 ' + comparedDays + ' 天），不是整周';
            }
        }

        let max = 1;
        days.forEach((value) => {
            const seconds = Number(value) || 0;
            if (seconds > max) max = seconds;
        });

        // 今天在「周一起」里的下标
        const today = (new Date().getDay() + 6) % 7;

        chart.innerHTML = '';
        for (let index = 0; index < 7; index += 1) {
            const seconds = Number(days[index]) || 0;
            const ratio = seconds > 0 ? Math.max(0.08, seconds / max) : 0.03;

            const bar = document.createElement('span');
            bar.style.setProperty('--h', Math.round(ratio * 100) + '%');
            bar.title = '周' + WEEK_LABELS[index] + ' ' + hoursOf(seconds).toFixed(1) + ' 小时';
            if (index === today) bar.classList.add('is-today');
            chart.appendChild(bar);
        }
    }

    function loadWeek() {
        const hostMod = SL.core.mod('host');
        if (!hostMod || typeof hostMod.request !== 'function' || !hostMod.hasHost()) {
            renderWeek({
                days: [3240, 5400, 3600, 7200, 7920, 11520, 6480],
                totalSeconds: 45360,
                sessions: 7,
                lastWeekSeconds: 38400,
                comparedSeconds: 38440,
                comparedDays: 7,
                deltaPercent: 18
            });
            return;
        }

        hostMod.request('play-stats')
            .then((data) => renderWeek(data))
            .catch(() => renderWeek(null));
    }

    function bindWeek() {
        loadWeek();
    }

    SL.home = Object.assign(SL.home || {}, {
        renderInstanceOptions, paintRange, syncMem, bindHomeMemory,
        paintHomeMemory, refreshHomeMemory, totalGb,
        bindMemoryOptimize, optimizeMemory, onMemoryResult,
        renderWeek, loadWeek, bindWeek
    });
})(window);
