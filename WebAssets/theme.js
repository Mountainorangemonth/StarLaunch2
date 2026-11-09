/* =====================================================================
   StarLaunch · 主题引擎
   ---------------------------------------------------------------------
   整套配色由 Material Color Utilities（Google 的 Material You 色彩库）
   在本地实时计算：源色 → HCT → M3 Scheme → 56 个颜色角色 → CSS 变量。

   为什么不用 <script type="module">：
   WebView2 多数情况下以 file:// 加载页面，ESM 会被 CORS 拦下，界面直接白屏。
   mcu.js 是 tools/build-mcu.mjs 生成的经典脚本，挂在 window.MaterialColorUtilities。

   对外接口（app.js 会用到）：
       StarTheme.ready            Promise，首次配色完成
       StarTheme.state            当前设置（可直接读）
       StarTheme.update(patch)    改设置并立即重算
       StarTheme.setWallpaper(file|url|null)
       StarTheme.onChange(fn)     配色变化回调
       StarTheme.randomSeed()     随机换一个源色
   ===================================================================== */
(function (global) {
    'use strict';

    const MCU = global.MaterialColorUtilities;
    const STORE_KEY = 'starlaunch.theme.v3';
    const WALLPAPER_KEY = 'starlaunch.wallpaper.v3';

    /* -----------------------------------------------------------------
       默认值
       ----------------------------------------------------------------- */
    const DEFAULT_STATE = {
        seed: '#7c6ce6',
        variant: 'tonalSpot',
        mode: 'auto',
        contrast: 0,
        roles: { accent: 'primary', selected: 'primary', hero: 'primary' },
        glass: 55,
        blur: 18,
        scrim: 24,
        glow: 18,
        performance: false,
        wallpaper: null,      // dataURL 或普通路径
        wallpaperName: '',
        wallpaperLum: null    // 壁纸平均亮度（0–1），用来推算遮罩下限
    };

    const VARIANTS = [
        { id: 'tonalSpot', label: '柔和' },
        { id: 'expressive', label: '表现' },
        { id: 'vibrant', label: '鲜艳' },
        { id: 'content', label: '内容' },
        { id: 'fidelity', label: '保真' },
        { id: 'neutral', label: '中性' },
        { id: 'monochrome', label: '单色' }
    ];

    const SEEDS = [
        { value: '#7c6ce6', label: '琉璃紫' },
        { value: '#1d9bf0', label: '天青' },
        { value: '#e8556d', label: '樱粉' },
        { value: '#2bb673', label: '薄荷' },
        { value: '#e08a2e', label: '暖橙' },
        { value: '#0ea5a4', label: '青碧' }
    ];

    // 需要从 M3 角色表里取出的键（顺序即 CSS 变量写入顺序）
    const ROLE_KEYS = [
        'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
        'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
        'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
        'error', 'onError', 'errorContainer', 'onErrorContainer',
        'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
        'surfaceDim', 'surfaceBright',
        'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
        'surfaceContainerHigh', 'surfaceContainerHighest',
        'inverseSurface', 'inverseOnSurface', 'inversePrimary',
        'outline', 'outlineVariant', 'shadow', 'scrim', 'surfaceTint'
    ];

    /* -----------------------------------------------------------------
       工具
       ----------------------------------------------------------------- */
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const kebab = (key) => key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const listeners = [];
    const notify = () => listeners.forEach((fn) => { try { fn(state); } catch (err) { console.error(err); } });

    const state = Object.assign({}, DEFAULT_STATE, { roles: Object.assign({}, DEFAULT_STATE.roles) });
    let resolvedMode = 'light';
    let currentTokens = null;
    let wallpaperToken = 0;

    /* -----------------------------------------------------------------
       持久化
       ----------------------------------------------------------------- */
    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved && typeof saved === 'object') {
                    if (typeof saved.seed === 'string' && /^#[0-9a-f]{6}$/i.test(saved.seed)) state.seed = saved.seed;
                    if (VARIANTS.some((v) => v.id === saved.variant)) state.variant = saved.variant;
                    if (['auto', 'light', 'dark'].indexOf(saved.mode) !== -1) state.mode = saved.mode;
                    if (Number.isFinite(saved.contrast)) state.contrast = clamp(saved.contrast, -1, 1);
                    if (saved.roles && typeof saved.roles === 'object') {
                        ['accent', 'selected', 'hero'].forEach((slot) => {
                            if (['primary', 'secondary', 'tertiary'].indexOf(saved.roles[slot]) !== -1) {
                                state.roles[slot] = saved.roles[slot];
                            }
                        });
                    }
                    ['glass', 'blur', 'scrim', 'glow'].forEach((key) => {
                        if (Number.isFinite(saved[key])) state[key] = saved[key];
                    });
                    state.performance = saved.performance === true;
                }
            }
            const wp = localStorage.getItem(WALLPAPER_KEY);
            if (wp) {
                state.wallpaper = wp;
                state.wallpaperName = localStorage.getItem(WALLPAPER_KEY + ':name') || '自定义壁纸';
            }
        } catch (err) {
            console.warn('读取主题设置失败，使用默认值', err);
        }
        state.glass = clamp(state.glass, 30, 95);
        state.blur = clamp(state.blur, 0, 40);
        state.scrim = clamp(state.scrim, 0, 80);
        state.glow = clamp(state.glow, 0, 60);
    }

    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({
                seed: state.seed, variant: state.variant, mode: state.mode, contrast: state.contrast,
                roles: state.roles, glass: state.glass, blur: state.blur, scrim: state.scrim,
                glow: state.glow, performance: state.performance
            }));
        } catch (err) {
            console.warn('保存主题设置失败', err);
        }
    }

    /* -----------------------------------------------------------------
       明暗：auto 时跟随系统（WebView2 里 prefers-color-scheme 会跟 Windows 主题）
       ----------------------------------------------------------------- */
    const darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

    function resolveMode() {
        if (state.mode === 'dark') return 'dark';
        if (state.mode === 'light') return 'light';
        return darkQuery && darkQuery.matches ? 'dark' : 'light';
    }

    /* -----------------------------------------------------------------
       M3 计算
       ----------------------------------------------------------------- */
    const SCHEMES = {
        tonalSpot: 'SchemeTonalSpot',
        expressive: 'SchemeExpressive',
        vibrant: 'SchemeVibrant',
        content: 'SchemeContent',
        fidelity: 'SchemeFidelity',
        neutral: 'SchemeNeutral',
        monochrome: 'SchemeMonochrome'
    };

    function schemeFor(sourceHct, isDark) {
        const ctorName = SCHEMES[state.variant] || 'SchemeTonalSpot';
        const Ctor = MCU[ctorName] || MCU.SchemeTonalSpot;
        return new Ctor(sourceHct, isDark, clamp(state.contrast, -1, 1));
    }

    function readRoles(scheme) {
        const out = {};
        ROLE_KEYS.forEach((key) => {
            const dynamicColor = MCU.MaterialDynamicColors[key];
            if (!dynamicColor || typeof dynamicColor.getArgb !== 'function') return;
            let argb;
            try {
                argb = dynamicColor.getArgb(scheme);
            } catch (err) {
                return;
            }
            if (typeof argb !== 'number') return;
            out[key] = {
                hex: MCU.hexFromArgb(argb),
                rgb: [MCU.redFromArgb(argb), MCU.greenFromArgb(argb), MCU.blueFromArgb(argb)]
            };
        });
        return out;
    }

    function toneRamp(palette) {
        return [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]
            .map((tone) => MCU.hexFromArgb(palette.tone(tone)));
    }

    /** 主视觉 / 强调色所用的「颜色 + 容器」对，取决于设置里选的角色 */
    function rolePair(scheme, roles, slot) {
        const key = roles[slot] || 'primary';
        const palette = scheme[key + 'Palette'];
        const dark = scheme.isDark;
        const tone = (t) => MCU.hexFromArgb(palette.tone(t));
        return {
            key: key,
            color: tone(dark ? 80 : 40),
            onColor: tone(dark ? 20 : 100),
            container: tone(dark ? 30 : 90),
            onContainer: tone(dark ? 90 : 10),
            fixed: tone(dark ? 90 : 40),
            fixedDim: tone(dark ? 80 : 30),
            inverse: tone(dark ? 40 : 80)
        };
    }

    /* -----------------------------------------------------------------
       写入 CSS 变量
       ----------------------------------------------------------------- */
    function applyTokens() {
        const root = document.documentElement;
        const isDark = resolvedMode === 'dark';
        const sourceHct = MCU.Hct.fromInt(MCU.argbFromHex(state.seed));
        const scheme = schemeFor(sourceHct, isDark);
        const roles = readRoles(scheme);

        const set = (name, value) => root.style.setProperty(name, value);
        const rgb = (key, fallback) => (roles[key] ? roles[key].rgb.join(', ') : fallback);

        Object.keys(roles).forEach((key) => {
            set('--m3-' + kebab(key), roles[key].hex);
            set('--m3-' + kebab(key) + '-rgb', roles[key].rgb.join(', '));
        });

        const accent = rolePair(scheme, state.roles, 'accent');
        const selected = rolePair(scheme, state.roles, 'selected');
        const hero = rolePair(scheme, state.roles, 'hero');

        set('--brand', accent.color);
        set('--brand-rgb', hexToRgb(accent.color));
        set('--on-brand', accent.onColor);
        set('--brand-container', accent.container);
        set('--on-brand-container', accent.onContainer);
        set('--selected', selected.container);
        set('--on-selected', selected.onContainer);
        set('--selected-solid', selected.color);
        set('--hero', hero.container);
        set('--on-hero', hero.onContainer);
        set('--hero-solid', hero.color);

        set('--text', roles.onSurface ? roles.onSurface.hex : (isDark ? '#e6e1e5' : '#1c1b1f'));
        set('--text-2', roles.onSurfaceVariant ? roles.onSurfaceVariant.hex : (isDark ? '#cac4d0' : '#49454f'));
        set('--line', 'rgba(' + rgb('outlineVariant', isDark ? '73, 69, 79' : '202, 197, 208') + ', 0.55)');
        set('--line-soft', 'rgba(' + rgb('outlineVariant', isDark ? '73, 69, 79' : '202, 197, 208') + ', 0.28)');

        // 材质：只允许一个来源。玻璃底色 = surfaceContainer + 不透明度
        const glassAlpha = state.performance ? 1 : state.glass / 100;
        const glassBase = isDark ? 'surfaceContainerHigh' : 'surfaceContainerLow';
        set('--glass-rgb', rgb(glassBase, isDark ? '40, 37, 43' : '242, 238, 248'));
        set('--glass-a', String(state.performance ? 1 : glassAlpha));
        set('--glass-blur', state.performance ? '0px' : state.blur + 'px');
        set('--glass', 'rgba(var(--glass-rgb), var(--glass-a))');
        set('--glass-strong', 'rgba(var(--glass-rgb), calc(var(--glass-a) + 0.22))');
        set('--glass-weak', 'rgba(var(--glass-rgb), calc(var(--glass-a) - 0.16))');
        set('--specular', isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.72)');
        set('--hairline', isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.5)');

        /*
         * 遮罩取「用户设置」和「可读性下限」中较大的那个。
         * 壁纸太亮时玻璃压不住深色文字，这里自动补足，用户不需要自己去调。
         */
        const autoScrim = autoScrimFor(state.wallpaperLum);
        const effectiveScrim = Math.max(state.scrim / 100, autoScrim);
        set('--scrim-a', String(effectiveScrim));
        root.dataset.autoScrim = autoScrim > state.scrim / 100 ? 'on' : 'off';
        set('--glow', String(state.glow / 100));
        set('--shadow-rgb', isDark ? '0, 0, 0' : '24, 22, 40');

        // 背景氛围光：用源色的 primary / tertiary 色相铺开
        const primaryTone = MCU.hexFromArgb(scheme.primaryPalette.tone(isDark ? 30 : 88));
        const tertiaryTone = MCU.hexFromArgb(scheme.tertiaryPalette.tone(isDark ? 24 : 92));
        const secondaryTone = MCU.hexFromArgb(scheme.secondaryPalette.tone(isDark ? 18 : 96));
        set('--aura-a', primaryTone);
        set('--aura-b', tertiaryTone);
        set('--aura-c', secondaryTone);

        root.dataset.mode = resolvedMode;
        root.dataset.variant = state.variant;
        root.dataset.performance = state.performance ? 'on' : 'off';
        root.style.colorScheme = resolvedMode;

        currentTokens = {
            scheme, roles, isDark,
            ramp: {
                primary: toneRamp(scheme.primaryPalette),
                secondary: toneRamp(scheme.secondaryPalette),
                tertiary: toneRamp(scheme.tertiaryPalette),
                neutral: toneRamp(scheme.neutralPalette)
            },
            source: MCU.hexFromArgb(MCU.Hct.fromInt(MCU.argbFromHex(state.seed)).toInt())
        };

        return currentTokens;
    }

    function hexToRgb(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ');
    }

    /* -----------------------------------------------------------------
       壁纸：压缩 → 存 localStorage → 取色
       ----------------------------------------------------------------- */
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const maxSide = 1920;
                const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) { URL.revokeObjectURL(url); reject(new Error('当前环境不支持 Canvas')); return; }
                ctx.drawImage(img, 0, 0, w, h);
                let out = '';
                try {
                    out = canvas.toDataURL('image/webp', 0.86);
                } catch (err) {
                    out = '';
                }
                if (!out || out.indexOf('data:image') !== 0) {
                    try { out = canvas.toDataURL('image/jpeg', 0.86); } catch (err) { out = ''; }
                }
                canvas.width = 0;
                canvas.height = 0;
                URL.revokeObjectURL(url);
                if (!out) { reject(new Error('图片编码失败')); return; }
                resolve(out);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')); };
            img.src = url;
        });
    }

    /**
     * 从图片取源色 + 算平均亮度。
     * 用 MCU 自己的 quantizer + score（和琉璃主题同一套流程），
     * 而不是平均色 —— 平均色会把鲜艳的图算成灰。
     * 亮度用来兜底可读性：壁纸太亮时玻璃上的深色文字会糊掉。
     */
    function sampleWallpaper(img) {
        const side = 96;
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        try {
            ctx.drawImage(img, 0, 0, side, side);
            const data = ctx.getImageData(0, 0, side, side).data;
            const pixels = [];
            let lr = 0, lg = 0, lb = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 255) continue;
                pixels.push(MCU.argbFromRgb(data[i], data[i + 1], data[i + 2]));
                // sRGB 相对亮度的线性化权重，用来估算整张图的明暗
                lr += Math.pow(data[i] / 255, 2.2);
                lg += Math.pow(data[i + 1] / 255, 2.2);
                lb += Math.pow(data[i + 2] / 255, 2.2);
                count += 1;
            }
            if (!count || !pixels.length) return null;
            const lum = 0.2126 * (lr / count) + 0.7152 * (lg / count) + 0.0722 * (lb / count);

            let seed = null;
            const quantized = MCU.QuantizerCelebi.quantize(pixels, 64);
            if (quantized && quantized.size) {
                const seedArgb = MCU.MaterialDynamicColors.primaryPaletteKeyColor.getArgb(
                    new MCU.SchemeTonalSpot(MCU.Hct.fromInt(MCU.argbFromHex(DEFAULT_STATE.seed)), false, 0)
                );
                const scored = MCU.Score.score(quantized, seedArgb);
                if (scored && scored.length) seed = MCU.hexFromArgb(scored[0]);
            }
            return { seed: seed, lum: Math.min(1, Math.max(0, lum)) };
        } catch (err) {
            // file:// 下画布可能被判定为「跨源污染」，此时安静退回默认源色
            console.warn('壁纸取色失败，保留当前源色', err);
            return null;
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }

    /**
     * 自动遮罩：保证玻璃层背后有一个可读的基底。
     *
     * 玻璃是半透明的，壁纸越亮，压在玻璃下的浅色底越会把深色文字冲掉；
     * 暗色模式下反过来，太暗的壁纸会让亮字发灰。
     * 这里按壁纸平均亮度算一个「至少需要多少遮罩」，用户手动调的值
     * 低于它时取它（用户调高则尊重用户）。
     */
    function autoScrimFor(lum) {
        if (lum === null || lum === undefined) return 0;
        const dark = resolvedMode === 'dark';
        if (dark) {
            // 目标：基底暗到亮字够清楚
            const target = 0.14;
            if (lum <= target) return 0;
            return clamp((lum - target) / Math.max(lum, 0.0001), 0, 0.78);
        }
        // 目标：基底亮到深字够清楚
        const target = 0.74;
        if (lum >= target) return 0;
        return clamp((target - lum) / Math.max(1 - lum, 0.0001), 0, 0.72);
    }

    function paintWallpaper() {
        const layer = document.getElementById('wallpaperLayer');
        const backdrop = document.getElementById('backdrop');
        if (!layer) return;
        if (state.wallpaper) {
            layer.style.backgroundImage = 'url("' + state.wallpaper.replace(/"/g, '\\"') + '")';
            if (backdrop) backdrop.classList.add('has-photo');
        } else {
            layer.style.backgroundImage = 'none';
            if (backdrop) backdrop.classList.remove('has-photo');
        }
        const preview = document.getElementById('bgPreview');
        if (preview) preview.style.backgroundImage = state.wallpaper ? layer.style.backgroundImage : '';
        const note = document.getElementById('wallpaperNote');
        if (note) {
            note.textContent = state.wallpaper
                ? '当前：' + (state.wallpaperName || '自定义壁纸') + '（取色与背景共用这张图）'
                : '未设置壁纸时使用由源色生成的氛围光。';
        }
    }

    async function adoptWallpaper(dataUrl, name, options) {
        const opts = options || {};
        const token = ++wallpaperToken;
        state.wallpaper = dataUrl;
        state.wallpaperName = name || '自定义壁纸';
        paintWallpaper();
        try {
            localStorage.setItem(WALLPAPER_KEY, dataUrl);
            localStorage.setItem(WALLPAPER_KEY + ':name', state.wallpaperName);
        } catch (err) {
            console.warn('壁纸过大，未能写入本地存储（本次运行仍生效）', err);
            if (opts.onQuota) opts.onQuota(err);
        }
        if (opts.sample !== false) {
            const img = new Image();
            img.onload = () => {
                if (token !== wallpaperToken) return;
                const sample = sampleWallpaper(img);
                if (!sample) return;
                if (sample.seed) state.seed = sample.seed;
                state.wallpaperLum = sample.lum;
                render();
                notify();
            };
            img.src = dataUrl;
        }
        return true;
    }

    /**
     * 设置壁纸。传 File 会自动压缩；传字符串则当作已有图片地址。
     * 传 null 清除壁纸。
     */
    async function setWallpaper(input, options) {
        if (input === null || input === undefined) {
            state.wallpaper = null;
            state.wallpaperName = '';
            state.wallpaperLum = null;
            paintWallpaper();
            render();
            notify();
            try {
                localStorage.removeItem(WALLPAPER_KEY);
                localStorage.removeItem(WALLPAPER_KEY + ':name');
            } catch (err) { /* 忽略 */ }
            return true;
        }
        if (typeof input === 'string') {
            return adoptWallpaper(input, (options && options.name) || '自定义壁纸', options);
        }
        const file = input;
        if (!file.type || file.type.indexOf('image/') !== 0) {
            throw new Error('请选择 PNG / JPG / WebP 图片');
        }
        const dataUrl = await compressImage(file);
        return adoptWallpaper(dataUrl, file.name, options);
    }

    /* -----------------------------------------------------------------
       渲染 / 对外 API
       ----------------------------------------------------------------- */
    function render() {
        resolvedMode = resolveMode();
        const tokens = applyTokens();
        document.documentElement.dataset.mode = resolvedMode;
        return tokens;
    }

    function update(patch, options) {
        const opts = options || {};
        const next = patch || {};
        if (typeof next.seed === 'string' && /^#[0-9a-f]{6}$/i.test(next.seed)) state.seed = next.seed.toLowerCase();
        if (next.variant && VARIANTS.some((v) => v.id === next.variant)) state.variant = next.variant;
        if (next.mode && ['auto', 'light', 'dark'].indexOf(next.mode) !== -1) state.mode = next.mode;
        if (Number.isFinite(next.contrast)) state.contrast = clamp(next.contrast, -1, 1);
        if (next.roles) {
            ['accent', 'selected', 'hero'].forEach((slot) => {
                if (['primary', 'secondary', 'tertiary'].indexOf(next.roles[slot]) !== -1) state.roles[slot] = next.roles[slot];
            });
        }
        ['glass', 'blur', 'scrim', 'glow'].forEach((key) => {
            if (Number.isFinite(next[key])) state[key] = Number(next[key]);
        });
        if (typeof next.performance === 'boolean') state.performance = next.performance;

        render();
        if (opts.persist !== false) save();
        if (opts.silent !== true) notify();
        return state;
    }

    function randomSeed() {
        const palette = SEEDS;
        const pool = palette.map((s) => s.value).filter((v) => v !== state.seed);
        return pool[Math.floor(Math.random() * pool.length)] || '#7c6ce6';
    }

    function bindSystemMode() {
        if (!darkQuery) return;
        const handler = () => {
            if (state.mode !== 'auto') return;
            render();
            notify();
        };
        if (typeof darkQuery.addEventListener === 'function') darkQuery.addEventListener('change', handler);
        else if (typeof darkQuery.addListener === 'function') darkQuery.addListener(handler);
    }

    /* -----------------------------------------------------------------
       初始化
       ----------------------------------------------------------------- */
    let readyResolve;
    const ready = new Promise((resolve) => { readyResolve = resolve; });

    function init() {
        load();
        if (!MCU) {
            console.error('Material Color Utilities 未加载：mcu.js 缺失或损坏，界面将以默认色运行');
            document.documentElement.dataset.mode = resolveMode();
            readyResolve(null);
            return;
        }
        render();
        paintWallpaper();
        bindSystemMode();
        // 上次保存过壁纸：只重算亮度以恢复遮罩下限，不覆盖用户后来挑的源色
        if (state.wallpaper) {
            const img = new Image();
            img.onload = () => {
                const sample = sampleWallpaper(img);
                if (!sample) return;
                state.wallpaperLum = sample.lum;
                render();
                notify();
            };
            img.src = state.wallpaper;
        }
        readyResolve(currentTokens);
    }

    const api = {
        ready,
        state,
        variants: VARIANTS,
        seeds: SEEDS,
        update,
        render,
        setWallpaper,
        randomSeed,
        onChange(fn) {
            if (typeof fn === 'function') listeners.push(fn);
            return () => {
                const index = listeners.indexOf(fn);
                if (index !== -1) listeners.splice(index, 1);
            };
        },
        get tokens() { return currentTokens; },
        get mode() { return resolvedMode; }
    };

    global.StarTheme = api;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
