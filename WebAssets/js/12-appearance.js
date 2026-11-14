/* =====================================================================
   StarLaunch · 设置：外观与壁纸
   ---------------------------------------------------------------------
   主题色、材质滑杆、壁纸库。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, $$, escapeHtml } = SL.core;
    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const homeMod = SL.core.mod('home');
    const paintRange = (...args) => homeMod.paintRange(...args);

    /* -----------------------------------------------------------------
       设置：外观
       ----------------------------------------------------------------- */
    let paletteSignature = '';
    let wallpaperSignature = '';
    let themeFrame = 0;
    let pendingThemePatch = null;

    /* -----------------------------------------------------------------
       壁纸库折叠
       ----------------------------------------------------------------- */
    const WP_FOLD_KEY = 'starlaunch.wallpaperLibraryOpen';
    let wallpaperFoldOpen = null;

    function readFoldPref() {
        try {
            return global.localStorage.getItem(WP_FOLD_KEY) === '1';
        } catch (err) {
            return false;
        }
    }

    let foldTimer = 0;

    /* 折叠态同步到 DOM：aria-expanded、按钮文案、inert（收起后不再被 Tab 聚焦） */
    function syncFoldChrome() {
        const open = wallpaperFoldOpen === true;
        const fold = $('#wallpaperFold');
        const toggle = $('#wallpaperToggle');
        const label = $('#wallpaperToggleText');
        const count = (window.StarTheme && window.StarTheme.library ? window.StarTheme.library.length : 0);

        if (fold) fold.inert = !open;
        if (toggle) toggle.setAttribute('aria-expanded', String(open));
        if (label) {
            const prefix = open ? '收起壁纸库' : '展开壁纸库';
            label.textContent = count ? prefix + ' · ' + count + ' 张' : prefix;
        }
    }

    /*
     * 折叠动画用 Web Animations：CSS transition 在这里有时不生成（点按钮与脚本调用表现不一致），
     * 而 animate() 每次都稳定播放。展开先量 inner.scrollHeight，播完交回 auto，壁纸库变多也不会被裁掉。
     */
    function applyWallpaperFold(open, options) {
        const opts = options || {};
        const fold = $('#wallpaperFold');
        const inner = fold ? fold.querySelector('.wp-fold__inner') : null;

        wallpaperFoldOpen = Boolean(open);

        if (fold) {
            global.clearTimeout(foldTimer);
            const from = fold.getBoundingClientRect().height;
            const target = wallpaperFoldOpen ? (inner ? inner.scrollHeight : 0) : 0;

            if (fold._foldAnim) {
                fold._foldAnim.cancel();
                fold._foldAnim = null;
            }

            fold.classList.toggle('is-collapsed', !wallpaperFoldOpen);
            fold.inert = !wallpaperFoldOpen;
            fold.style.height = opts.snap ? (wallpaperFoldOpen ? 'auto' : '0px') : target + 'px';

            if (!opts.snap && typeof fold.animate === 'function' && Math.abs(from - target) > 1) {
                fold._foldAnim = fold.animate(
                    [{ height: from + 'px' }, { height: target + 'px' }],
                    { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
                );
            }

            if (wallpaperFoldOpen && !opts.snap) {
                foldTimer = global.setTimeout(() => {
                    if (wallpaperFoldOpen) fold.style.height = 'auto';
                }, 300);
            }
        }

        syncFoldChrome();
    }

    function toggleWallpaperFold() {
        applyWallpaperFold(!wallpaperFoldOpen);
        try {
            global.localStorage.setItem(WP_FOLD_KEY, wallpaperFoldOpen ? '1' : '0');
        } catch (err) {
            /* 本地存储不可用时只保留在内存里 */
        }
    }

    /*
     * 滑杆的 input 事件一帧可能触发多次。这里合并成一次主题更新，
     * 并且不写 localStorage；松手时再 persist()，避免拖动时反复序列化。
     */
    function queueThemeUpdate(patch) {
        pendingThemePatch = Object.assign(pendingThemePatch || {}, patch);
        if (themeFrame) return;
        themeFrame = requestAnimationFrame(() => {
            themeFrame = 0;
            const next = pendingThemePatch;
            pendingThemePatch = null;
            if (next) window.StarTheme.update(next, { silent: true, persist: false });
        });
    }

    function renderPalette() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;
        const tokens = theme.tokens;

        /*
         * 色板条、源色圆点、变体 chip 只在真正影响颜色的设置变化时重建；
         * 玻璃/模糊/泛光滑杆只改 CSS 变量，不再整块重排。
         */
        const signature = [
            state.seed, state.variant, state.mode, theme.mode, state.contrast,
            state.roles.accent, state.roles.selected, state.roles.hero
        ].join('|');

        if (signature !== paletteSignature) {
            paletteSignature = signature;

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
        }

        const seedLabel = $('#seedLabel');
        if (seedLabel) {
            const variantLabel = (theme.variants.find((v) => v.id === state.variant) || { label: '' }).label;
            seedLabel.textContent = '源色 ' + state.seed.toUpperCase() + ' · ' + variantLabel + '变体 · ' + (theme.mode === 'dark' ? '深色' : '浅色');
        }

        const seedPick = $('#seedPick');
        if (seedPick) seedPick.value = state.seed;

        renderPaletteValues();
    }

    function renderPaletteValues() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;

        const paint = (inputSel, valueSel, value, format) => {
            const input = $(inputSel);
            const label = $(valueSel);
            if (input) { input.value = String(value); paintRange(input); }
            if (label) label.textContent = format(value);
        };
        paint('#glassRange', '#glassValue', state.glass, (v) => v + '%');
        paint('#blurRange', '#blurValue', state.blur, (v) => v + ' px');
        paint('#glowRange', '#glowValue', state.glow, (v) => v + '%');
        paint('#contrastRange', '#contrastValue', state.contrast, (v) => (v > 0 ? '+' : '') + v);

        const perf = $('#perfSwitch');
        if (perf) perf.setAttribute('aria-checked', String(Boolean(state.performance)));
        const blurInput = $('#blurRange');
        if (blurInput) blurInput.disabled = Boolean(state.performance);
        const glowInput = $('#glowRange');
        if (glowInput) glowInput.disabled = Boolean(state.performance);
    }

    function renderWallpaperUI() {
        if (wallpaperFoldOpen === null) applyWallpaperFold(readFoldPref(), { snap: true });

        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;
        const library = theme.library || [];

        const signature = library.map((item) => item.url).join('|') + '#' + state.wallpaper + '#' + (state.libraryError || '');
        if (signature !== wallpaperSignature) {
            wallpaperSignature = signature;
            const grid = $('#wallpaperGrid');
            if (grid) {
                if (!library.length) {
                    grid.innerHTML = '<p class="wallpaper-empty">' +
                        escapeHtml(state.libraryError || '壁纸文件夹里还没有图片。把 jpg / png / webp 放进去，再点“重新扫描”。') +
                    '</p>';
                } else {
                    /* 「不使用壁纸」永远排第一：点它直接关掉当前壁纸，只留氛围光 */
                    const noneTile = '<button class="wallpaper-item wallpaper-item--none' + (state.wallpaper ? '' : ' is-active') + '" type="button" role="option" aria-selected="' + (!state.wallpaper) + '" data-wallpaper-clear="1" title="不使用壁纸">' +
                        '<i class="wallpaper-none-glyph" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-image"/></svg></i>' +
                        '<span>不使用壁纸</span>' +
                    '</button>';
                    grid.innerHTML = noneTile + library.map((item) => {
                        const active = item.url === state.wallpaper;
                        return '<button class="wallpaper-item' + (active ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + active + '" data-wallpaper="' + escapeHtml(item.url) + '" title="' + escapeHtml(item.name) + '">' +
                            '<img src="' + escapeHtml(item.url) + '" loading="lazy" decoding="async" alt="">' +
                            '<span>' + escapeHtml(item.name) + '</span>' +
                        '</button>';
                    }).join('');
                }
            }
        }

        const rotate = $('#wpRotateSwitch');
        if (rotate) rotate.setAttribute('aria-checked', String(Boolean(state.wallpaperRotate)));
        $$('#wpModeSeg [data-wp-mode]').forEach((btn) => {
            const active = btn.dataset.wpMode === state.wallpaperMode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('#wpIntervalSeg [data-wp-interval]').forEach((btn) => {
            const active = Number(btn.dataset.wpInterval) === Number(state.wallpaperInterval);
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });

        if (wallpaperFoldOpen !== null) syncFoldChrome();
    }

    function bindAppearanceRange(inputSel, key, format) {
        const input = $(inputSel);
        if (!input) return;
        paintRange(input);
        input.addEventListener('input', () => {
            const value = Number(input.value);
            queueThemeUpdate({ [key]: value });
            const label = $(inputSel.replace('Range', 'Value'));
            if (label && format) label.textContent = format(value);
            paintRange(input);
        });
        input.addEventListener('change', () => {
            window.StarTheme.persist();
            renderPalette();
            toast('已保存：' + input.getAttribute('aria-label'), 'i-check');
        });
    }

    SL.appearance = Object.assign(SL.appearance || {}, { queueThemeUpdate, renderPalette, renderPaletteValues, renderWallpaperUI, bindAppearanceRange, applyWallpaperFold, toggleWallpaperFold });
})(window);
