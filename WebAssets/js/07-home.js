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


    /* 事件绑定 */
    function bindHomeMemory() {
        /* 内存滑杆（主页 + 详情页同一份数据） */
        ['#homeMemRange', '#vMemRange'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            paintRange(input);
            input.addEventListener('input', () => {
                const inst = activeInstance();
                if (!inst.id) return;
                inst.mem = Number(input.value);
                ui.instanceMem = ui.instanceMem || {};
                ui.instanceMem[inst.id] = inst.mem;
                syncMem(inst);
                paintRange(input);
            });
            input.addEventListener('change', () => {
                writeStore(STORE.uiPrefs, ui);
                toast('已为「' + activeInstance().name + '」分配 ' + activeInstance().mem + ' GB 内存', 'i-chip');
            });
        });

    }

    SL.home = Object.assign(SL.home || {}, { renderInstanceOptions, paintRange, syncMem, bindHomeMemory });
})(window);
