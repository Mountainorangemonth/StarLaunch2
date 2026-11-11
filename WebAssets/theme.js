/* =====================================================================
   StarLaunch · 主题引擎
   ---------------------------------------------------------------------
   整套配色由 Material Color Utilities（Google 的 Material You 色彩库）
   在本地实时计算：源色 → HCT → M3 Scheme → 56 个颜色角色 → CSS 变量。

   壁纸由宿主扫描外部文件夹后通过 /wallpapers/manifest.json 提供，
   前端只负责随机 / 顺序轮播、预加载和取色；不再把图片写进 localStorage。

   为什么不用 <script type="module">：
   WebView2 多数情况下以 file:// 加载页面，ESM 会被 CORS 拦下，界面直接白屏。
   mcu.js 是 tools/build-mcu.mjs 生成的经典脚本，挂在 window.MaterialColorUtilities。

   对外接口（app.js 会用到）：
       StarTheme.ready                 Promise，首次配色完成
       StarTheme.state                 当前设置（可直接读）
       StarTheme.library               宿主扫描到的壁纸列表
       StarTheme.update(patch)         改设置并立即重算
       StarTheme.persist()             立即写入 localStorage
       StarTheme.reloadWallpapers()    重新读取 /wallpapers/manifest.json
       StarTheme.selectWallpaper(url)  切换到指定壁纸
       StarTheme.nextWallpaper()       按当前模式换下一张
       StarTheme.resampleWallpaper()   重新从当前壁纸取色
       StarTheme.onChange(fn)          配色变化回调
   ===================================================================== */
(function (global) {
    'use strict';

    const MCU = global.MaterialColorUtilities;
    const STORE_KEY = 'starlaunch.theme.v4';
    const LEGACY_STORE_KEY = 'starlaunch.theme.v3';
    const LEGACY_WALLPAPER_KEY = 'starlaunch.wallpaper.v3';
    const MANIFEST_URL = '/wallpapers/manifest.json';

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
        glow: 18,
        performance: false,
        wallpaper: null,
        wallpaperName: '',
        wallpaperFolder: '',
        wallpaperMode: 'random',   // random | sequence
        wallpaperInterval: 5,      // 分钟
        wallpaperRotate: true,
        libraryError: ''
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
    let library = [];
    let resolvedMode = 'light';
    let currentTokens = null;
    let wallpaperToken = 0;
    let lastSwitchAt = 0;
    let rotateTimer = 0;
    let activeWallpaperLayer = 0;
    let paintedWallpaperUrl = null;

    const seedCache = new Map();

    /* -----------------------------------------------------------------
       持久化
       ----------------------------------------------------------------- */
    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
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
                    ['glass', 'blur', 'glow'].forEach((key) => {
                        if (Number.isFinite(saved[key])) state[key] = saved[key];
                    });
                    state.performance = saved.performance === true;

                    if (typeof saved.wallpaper === 'string' && saved.wallpaper.indexOf('/wallpapers/') === 0) {
                        state.wallpaper = saved.wallpaper;
                    }
                    if (typeof saved.wallpaperName === 'string') state.wallpaperName = saved.wallpaperName;
                    if (['random', 'sequence'].indexOf(saved.wallpaperMode) !== -1) state.wallpaperMode = saved.wallpaperMode;
                    if ([1, 5, 10, 30].indexOf(Number(saved.wallpaperInterval)) !== -1) state.wallpaperInterval = Number(saved.wallpaperInterval);
                    state.wallpaperRotate = saved.wallpaperRotate !== false;
                }
            }
        } catch (err) {
            console.warn('读取主题设置失败，使用默认值', err);
        }
        state.glass = clamp(state.glass, 30, 95);
        state.blur = clamp(state.blur, 0, 40);
        state.glow = clamp(state.glow, 0, 60);

        // 旧版把整张壁纸转成 dataURL 存进 localStorage，体积很大；升级后直接丢掉。
        try {
            localStorage.removeItem(LEGACY_WALLPAPER_KEY);
            localStorage.removeItem(LEGACY_WALLPAPER_KEY + ':name');
        } catch (err) { /* 忽略 */ }
    }

    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({
                seed: state.seed,
                variant: state.variant,
                mode: state.mode,
                contrast: state.contrast,
                roles: state.roles,
                glass: state.glass,
                blur: state.blur,
                glow: state.glow,
                performance: state.performance,
                wallpaper: state.wallpaper,
                wallpaperName: state.wallpaperName,
                wallpaperMode: state.wallpaperMode,
                wallpaperInterval: state.wallpaperInterval,
                wallpaperRotate: state.wallpaperRotate
            }));
            localStorage.removeItem(LEGACY_STORE_KEY);
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
       色调过渡
       -----------------------------------------------------------------
       直接改 CSS 变量的话，玻璃面板、文字、描边会瞬间跳色。两个机制配合：

       1) 换色时给 <html> 挂一段短命的 .is-theming，让元素自身的
          background-color / color / border-color 等走 CSS transition。
          玻璃面板的颜色来自 rgb 三元组（rgba(var(--glass-rgb), a)），
          变量本身没法插值，只能靠元素属性过渡。
       2) 用 CSS.registerProperty 把几个关键颜色变量注册成 <color>，
          再单独给它们声明 transition。这样写在渐变里的 var(--brand)
          也会逐帧插值重算 —— 普通 transition 做不到这一点。

       拖动取色滑块时走的是 silent 更新，不挂这个类，保持跟手不拖泥带水。 */

    const FADE_MS = 380;
    let fadeTimer = 0;
    let painted = false;

    const ANIMATABLE_COLORS = [
        '--brand', '--brand-container', '--on-brand', '--on-brand-container',
        '--hero', '--hero-solid', '--on-hero',
        '--selected', '--selected-solid', '--on-selected',
        '--text', '--text-2',
        '--aura-a', '--aura-b', '--aura-c',
        '--m3-tertiary', '--m3-tertiary-container',
        '--m3-surface-container-highest', '--m3-outline'
    ];

    function registerAnimatableColors() {
        if (!global.CSS || typeof global.CSS.registerProperty !== 'function') return;
        ANIMATABLE_COLORS.forEach((name) => {
            try {
                global.CSS.registerProperty({ name: name, syntax: '<color>', inherits: true, initialValue: 'rgb(0 0 0)' });
            } catch (err) {
                // 已经注册过或语法不支持：保持不变，只是这一项没有过渡
            }
        });
    }

    function beginFade() {
        const root = document.documentElement;
        if (!root.classList.contains('is-theming')) root.classList.add('is-theming');
        global.clearTimeout(fadeTimer);
        fadeTimer = global.setTimeout(() => root.classList.remove('is-theming'), FADE_MS);
    }

    /* -----------------------------------------------------------------
       写入 CSS 变量
       ----------------------------------------------------------------- */
    function applyMaterialVars(isDark, roles) {
        const root = document.documentElement;
        const set = (name, value) => root.style.setProperty(name, value);
        const rgb = (key, fallback) => (roles[key] ? roles[key].rgb.join(', ') : fallback);

        // 材质：只允许一个来源。玻璃底色 = surfaceContainer + 不透明度
        const glassAlpha = state.performance ? 1 : state.glass / 100;
        const glassBase = isDark ? 'surfaceContainerHigh' : 'surfaceContainerLow';
        set('--glass-rgb', rgb(glassBase, isDark ? '40, 37, 43' : '242, 238, 248'));
        set('--glass-a', String(glassAlpha));
        set('--glass-blur', state.performance ? '0px' : state.blur + 'px');
        set('--glass', 'rgba(var(--glass-rgb), var(--glass-a))');
        set('--glass-strong', 'rgba(var(--glass-rgb), calc(var(--glass-a) + 0.22))');
        set('--glass-weak', 'rgba(var(--glass-rgb), calc(var(--glass-a) - 0.16))');
        set('--specular', isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.72)');
        set('--glow', String(state.glow / 100));
        set('--shadow-rgb', isDark ? '0, 0, 0' : '24, 22, 40');
        root.dataset.performance = state.performance ? 'on' : 'off';
    }

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

        applyMaterialVars(isDark, roles);

        // 背景氛围光：用源色的 primary / tertiary 色相铺开
        const primaryTone = MCU.hexFromArgb(scheme.primaryPalette.tone(isDark ? 30 : 88));
        const tertiaryTone = MCU.hexFromArgb(scheme.tertiaryPalette.tone(isDark ? 24 : 92));
        const secondaryTone = MCU.hexFromArgb(scheme.secondaryPalette.tone(isDark ? 18 : 96));
        set('--aura-a', primaryTone);
        set('--aura-b', tertiaryTone);
        set('--aura-c', secondaryTone);

        root.dataset.mode = resolvedMode;
        root.dataset.variant = state.variant;
        root.style.colorScheme = resolvedMode;

        currentTokens = {
            scheme, roles, isDark,
            ramp: {
                primary: toneRamp(scheme.primaryPalette),
                secondary: toneRamp(scheme.secondaryPalette),
                tertiary: toneRamp(scheme.tertiaryPalette),
                neutral: toneRamp(scheme.neutralPalette)
            },
            source: MCU.hexFromArgb(sourceHct.toInt())
        };

        return currentTokens;
    }

    function hexToRgb(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ');
    }

    /* -----------------------------------------------------------------
       壁纸：宿主扫描文件夹 → manifest → 预加载 → 取色
       ----------------------------------------------------------------- */
    function preload(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('壁纸加载失败'));
            img.src = url;
        });
    }

    /**
     * 从图片取源色。用 MCU 自己的 quantizer + score，
     * 结果按图片 URL 缓存，轮播回同一张时不再重复计算。
     */
    async function seedFor(url) {
        if (seedCache.has(url)) return seedCache.get(url);
        let img;
        try {
            img = await preload(url);
        } catch (err) {
            seedCache.set(url, null);
            return null;
        }
        const side = 64;
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        let seed = null;
        try {
            ctx.drawImage(img, 0, 0, side, side);
            const data = ctx.getImageData(0, 0, side, side).data;
            const pixels = [];
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 255) continue;
                pixels.push(MCU.argbFromRgb(data[i], data[i + 1], data[i + 2]));
            }
            if (pixels.length) {
                const quantized = MCU.QuantizerCelebi.quantize(pixels, 64);
                if (quantized && quantized.size) {
                    const seedArgb = MCU.MaterialDynamicColors.primaryPaletteKeyColor.getArgb(
                        new MCU.SchemeTonalSpot(MCU.Hct.fromInt(MCU.argbFromHex(DEFAULT_STATE.seed)), false, 0)
                    );
                    const scored = MCU.Score.score(quantized, seedArgb);
                    if (scored && scored.length) seed = MCU.hexFromArgb(scored[0]);
                }
            }
        } catch (err) {
            // 极少数 WebView2 配置把画布判成跨源污染，安静退回当前源色
            console.warn('壁纸取色失败，保留当前源色', err);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
        seedCache.set(url, seed);
        return seed;
    }

    function paintWallpaper() {
        const backdrop = document.getElementById('backdrop');
        const layers = [
            document.getElementById('wallpaperLayer'),
            document.getElementById('wallpaperLayerNext')
        ].filter(Boolean);

        if (!state.wallpaper) {
            layers.forEach((layer) => {
                layer.classList.remove('is-active');
                layer.style.backgroundImage = 'none';
            });
            if (backdrop) backdrop.classList.remove('has-photo');
            activeWallpaperLayer = 0;
            paintedWallpaperUrl = null;
        } else {
            if (backdrop) backdrop.classList.add('has-photo');
            if (paintedWallpaperUrl !== state.wallpaper) {
                // 双图层交叉淡入：旧图保持 is-active，新图淡入后再撤掉旧图。
                const nextIndex = layers.length > 1 ? 1 - activeWallpaperLayer : 0;
                const next = layers[nextIndex];
                if (next) {
                    next.style.backgroundImage = 'url("' + state.wallpaper.replace(/"/g, '\\"') + '")';
                    void next.offsetWidth;
                    next.classList.add('is-active');
                    layers.forEach((layer, index) => {
                        if (index !== nextIndex) layer.classList.remove('is-active');
                    });
                }
                activeWallpaperLayer = nextIndex;
                paintedWallpaperUrl = state.wallpaper;
            }
        }

        const preview = document.getElementById('bgPreview');
        if (preview) {
            preview.style.display = state.wallpaper ? '' : 'none';
            preview.style.backgroundImage = state.wallpaper ? 'url("' + state.wallpaper.replace(/"/g, '\\"') + '")' : '';
        }

        const folder = document.getElementById('wallpaperFolder');
        if (folder) {
            folder.textContent = state.wallpaperFolder || '未读取到壁纸文件夹';
        }
        const note = document.getElementById('wallpaperNote');
        if (note) {
            if (state.wallpaper) {
                note.textContent = '当前：' + (state.wallpaperName || '壁纸') + ' · 共 ' + library.length + ' 张';
            } else if (library.length) {
                note.textContent = '壁纸库共 ' + library.length + ' 张，选择一张作为背景。';
            } else if (state.libraryError) {
                note.textContent = '';
            } else {
                note.textContent = '壁纸文件夹为空。放入图片后点“重新扫描”。';
            }
        }
    }

    async function applyWallpaper(item, options) {
        const opts = options || {};
        const token = ++wallpaperToken;
        try {
            await preload(item.url);
        } catch (err) {
            return false;
        }
        if (token !== wallpaperToken) return false;
        state.wallpaper = item.url;
        state.wallpaperName = item.name || '';
        lastSwitchAt = Date.now();
        paintWallpaper();
        if (opts.persist !== false) save();
        notify();

        if (opts.sample !== false) {
            const seed = await seedFor(item.url);
            if (token !== wallpaperToken) return true;
            if (seed && seed !== state.seed) {
                state.seed = seed;
                render();
                notify();
                save();
            }
        }
        return true;
    }

    function scheduleRotation() {
        if (rotateTimer) {
            global.clearInterval(rotateTimer);
            rotateTimer = 0;
        }
        if (!state.wallpaperRotate || library.length < 2) return;
        lastSwitchAt = Date.now();
        rotateTimer = global.setInterval(() => {
            if (global.document.hidden) return;
            if (Date.now() - lastSwitchAt < state.wallpaperInterval * 60000) return;
            nextWallpaper();
        }, 15000);
    }

    async function setLibrary(items, folder) {
        const previous = state.wallpaper;
        library = (Array.isArray(items) ? items : []).filter((item) =>
            item && typeof item.url === 'string' && item.url.indexOf('/wallpapers/') === 0
        ).map((item) => ({
            url: item.url,
            name: typeof item.name === 'string' && item.name ? item.name : item.url.split('/').pop()
        }));
        state.wallpaperFolder = folder || '';
        state.libraryError = '';

        if (!library.length) {
            state.wallpaper = null;
            state.wallpaperName = '';
            paintWallpaper();
            scheduleRotation();
            save();
            notify();
            return;
        }

        const current = library.find((item) => item.url === previous);
        if (current) {
            state.wallpaperName = current.name;
            paintWallpaper();
            if (!seedCache.has(current.url)) {
                seedFor(current.url).then((seed) => {
                    if (state.wallpaper === current.url && seed) {
                        state.seed = seed;
                        render();
                        notify();
                        save();
                    }
                });
            }
            notify();
        } else {
            const pick = library.length === 1 || state.wallpaperMode === 'sequence'
                ? library[0]
                : library[Math.floor(Math.random() * library.length)];
            await applyWallpaper(pick, { persist: true });
        }
        scheduleRotation();
    }

    async function reloadWallpapers() {
        try {
            const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            await setLibrary(data.items || [], data.folder || '');
            return true;
        } catch (err) {
            library = [];
            state.wallpaper = null;
            state.wallpaperName = '';
            state.wallpaperFolder = '';
            state.libraryError = '需要通过宿主运行才能读取壁纸文件夹';
            paintWallpaper();
            scheduleRotation();
            save();
            notify();
            return false;
        }
    }

    async function selectWallpaper(url) {
        const item = library.find((entry) => entry.url === url);
        if (!item) return false;
        const ok = await applyWallpaper(item, { persist: true });
        if (ok) scheduleRotation();
        return ok;
    }

    async function nextWallpaper() {
        if (library.length < 2) return false;
        const index = library.findIndex((item) => item.url === state.wallpaper);
        let next;
        if (state.wallpaperMode === 'random') {
            const pool = library.filter((item) => item.url !== state.wallpaper);
            next = pool[Math.floor(Math.random() * pool.length)] || library[0];
        } else {
            next = library[(index + 1) % library.length];
        }
        return applyWallpaper(next, { persist: true });
    }

    async function resampleWallpaper() {
        if (!state.wallpaper) return false;
        seedCache.delete(state.wallpaper);
        const seed = await seedFor(state.wallpaper);
        if (!seed) return false;
        state.seed = seed;
        render();
        notify();
        save();
        return true;
    }

    /* -----------------------------------------------------------------
       渲染 / 对外 API
       ----------------------------------------------------------------- */
    function render(options) {
        const opts = options || {};
        // 首帧不淡入：那时候不需要过渡，反而会拖慢第一次上色
        if (painted && opts.fade !== false) beginFade();
        resolvedMode = resolveMode();
        const tokens = applyTokens();
        document.documentElement.dataset.mode = resolvedMode;
        painted = true;
        return tokens;
    }

    function update(patch, options) {
        const opts = options || {};
        const next = patch || {};
        let colorChanged = false;
        let materialChanged = false;
        let wallpaperPrefsChanged = false;

        if (typeof next.seed === 'string' && /^#[0-9a-f]{6}$/i.test(next.seed)) {
            state.seed = next.seed.toLowerCase();
            colorChanged = true;
        }
        if (next.variant && VARIANTS.some((v) => v.id === next.variant)) {
            state.variant = next.variant;
            colorChanged = true;
        }
        if (next.mode && ['auto', 'light', 'dark'].indexOf(next.mode) !== -1) {
            state.mode = next.mode;
            colorChanged = true;
        }
        if (Number.isFinite(next.contrast)) {
            state.contrast = clamp(next.contrast, -1, 1);
            colorChanged = true;
        }
        if (next.roles) {
            ['accent', 'selected', 'hero'].forEach((slot) => {
                if (['primary', 'secondary', 'tertiary'].indexOf(next.roles[slot]) !== -1) {
                    state.roles[slot] = next.roles[slot];
                    colorChanged = true;
                }
            });
        }
        ['glass', 'blur', 'glow'].forEach((key) => {
            if (Number.isFinite(next[key])) {
                state[key] = Number(next[key]);
                materialChanged = true;
            }
        });
        if (typeof next.performance === 'boolean') {
            state.performance = next.performance;
            materialChanged = true;
        }
        if (next.wallpaperMode && ['random', 'sequence'].indexOf(next.wallpaperMode) !== -1) {
            state.wallpaperMode = next.wallpaperMode;
            wallpaperPrefsChanged = true;
        }
        if (Number.isFinite(next.wallpaperInterval) && [1, 5, 10, 30].indexOf(Number(next.wallpaperInterval)) !== -1) {
            state.wallpaperInterval = Number(next.wallpaperInterval);
            wallpaperPrefsChanged = true;
        }
        if (typeof next.wallpaperRotate === 'boolean') {
            state.wallpaperRotate = next.wallpaperRotate;
            wallpaperPrefsChanged = true;
        }

        // 只动玻璃/模糊/泛光时复用已有色板，避免每一帧重算 56 个 M3 角色。
        if (colorChanged) {
            render({ fade: opts.silent !== true });
        } else if (materialChanged) {
            if (painted && opts.silent !== true) beginFade();
            if (currentTokens) applyMaterialVars(currentTokens.isDark, currentTokens.roles);
            else render();
        }
        if (wallpaperPrefsChanged) {
            scheduleRotation();
            if (state.wallpaperRotate && library.length > 1) lastSwitchAt = Date.now();
        }

        if (opts.persist !== false) save();
        if (opts.silent !== true) notify();
        return state;
    }

    function persist() {
        save();
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
        registerAnimatableColors();
        if (!MCU) {
            console.error('Material Color Utilities 未加载：mcu.js 缺失或损坏，界面将以默认色运行');
            document.documentElement.dataset.mode = resolveMode();
            readyResolve(null);
            return;
        }
        render();
        paintWallpaper();
        bindSystemMode();
        readyResolve(currentTokens);
        reloadWallpapers();
    }

    const api = {
        ready,
        state,
        variants: VARIANTS,
        seeds: SEEDS,
        update,
        render,
        persist,
        reloadWallpapers,
        selectWallpaper,
        nextWallpaper,
        resampleWallpaper,
        onChange(fn) {
            if (typeof fn === 'function') listeners.push(fn);
            return () => {
                const index = listeners.indexOf(fn);
                if (index !== -1) listeners.splice(index, 1);
            };
        },
        get library() { return library; },
        get tokens() { return currentTokens; },
        get mode() { return resolvedMode; }
    };

    global.StarTheme = api;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
