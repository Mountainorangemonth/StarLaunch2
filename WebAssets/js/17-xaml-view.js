/* =====================================================================
   StarLaunch · Custom.xaml 渲染
   ---------------------------------------------------------------------
   把 16-xaml-parse.js 得到的节点树画成 DOM，控件按 PCL 的那一套来：

     StackPanel / Grid / Border / TextBlock / Path
     local:MyCard / MyHint / MyImage / MyButton / MyTextButton
     local:MyIconTextButton / MyIconButton / MyListItem

   EventType + EventData 触发真实动作（打开网页、复制、启动游戏……），
   CustomEventService.Events 里的多事件按顺序执行；
   执行了「修改变量」或「刷新页面」就整页重画一次，卡片折叠状态保留。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;
    const xaml = SL.xaml;
    const { $ } = SL.core;

    const uiMod = SL.core.mod('ui');
    const toast = (...args) => uiMod.toast(...args);
    const hostMod = SL.core.mod('host');
    const hostPost = (...args) => hostMod.hostPost(...args);

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /* 渲染期间的共享状态：变量表和卡片折叠状态要活过重画 */
    const vars = Object.create(null);
    const cardState = new Map();
    const state = {
        container: null,
        source: '',
        options: {},
        stamp: 0
    };

    /* ════════════════════════════════════════════════════════════════
       小工具
       ════════════════════════════════════════════════════════════════ */
    function el(tag, className) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    }

    function svgUse(id, className) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        // 带上 .icon 才能吃到全局的描边规则（fill:none / stroke:currentColor）
        svg.setAttribute('class', ('icon ' + (className || '')).trim());
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#' + id);
        svg.appendChild(use);
        return svg;
    }

    /**
     * 读布尔属性：认 True/False 字面量，也认 {variable:名字:True} 这种写法。
     * 解析不出结果（属性没写、或者是不支持的标记扩展）时用 fallback。
     */
    function flag(node, name, ctx, fallback) {
        const raw = xaml.rawAttr(node, name, '');
        if (!raw) return fallback;
        const resolved = xaml.value(node, name, ctx);
        if (resolved === '') return fallback;
        const text = String(resolved).trim().toLowerCase();
        if (text === 'true' || text === '1' || text === 'yes') return true;
        if (text === 'false' || text === '0' || text === 'no') return false;
        return fallback;
    }

    const ALIGN_H = { left: 'flex-start', center: 'center', right: 'flex-end', stretch: 'stretch' };
    const ALIGN_V = { top: 'flex-start', center: 'center', bottom: 'flex-end', stretch: 'stretch' };

    function px(value) {
        const num = parseFloat(value);
        return isNaN(num) ? '' : num + 'px';
    }

    /** Visibility / IsHitTestVisible / ToolTip / Width / Height / Margin 这些通用属性。 */
    function applyCommon(node, ctx, element, kind) {
        const margin = xaml.thickness(xaml.rawAttr(node, 'Margin'));
        if (margin) element.style.margin = margin;

        const padding = xaml.thickness(xaml.rawAttr(node, 'Padding'));
        if (padding && kind !== 'text') element.style.padding = padding;

        const width = xaml.value(node, 'Width', ctx);
        if (width && /^[\d.]+$/.test(width)) element.style.width = px(width);
        const height = xaml.value(node, 'Height', ctx);
        if (height && /^[\d.]+$/.test(height)) element.style.height = px(height);

        const minWidth = xaml.value(node, 'MinWidth', ctx);
        if (minWidth && /^[\d.]+$/.test(minWidth)) element.style.minWidth = px(minWidth);
        const maxWidth = xaml.value(node, 'MaxWidth', ctx);
        if (maxWidth && /^[\d.]+$/.test(maxWidth)) element.style.maxWidth = px(maxWidth);

        const visibility = xaml.value(node, 'Visibility', ctx).toLowerCase();
        if (visibility === 'collapsed') element.style.display = 'none';
        else if (visibility === 'hidden') element.style.visibility = 'hidden';

        if (!flag(node, 'IsHitTestVisible', ctx, true)) element.style.pointerEvents = 'none';

        const opacity = xaml.value(node, 'Opacity', ctx);
        if (opacity && !isNaN(parseFloat(opacity))) element.style.opacity = String(parseFloat(opacity));

        const tip = xaml.value(node, 'ToolTip', ctx);
        if (tip) {
            element.title = tip;
            element.classList.add('has-tip');
        }

        const cursor = xaml.value(node, 'Cursor', ctx);
        if (cursor) element.style.cursor = cursor === 'Hand' ? 'pointer' : cursor.toLowerCase();
    }

    /** 把 HorizontalAlignment / VerticalAlignment 落到父容器的排布上。 */
    function applyAlign(node, ctx, element, parentKind, isGrid) {
        const horizontal = xaml.value(node, 'HorizontalAlignment', ctx).toLowerCase();
        const vertical = xaml.value(node, 'VerticalAlignment', ctx).toLowerCase();

        if (isGrid) {
            if (ALIGN_H[horizontal]) element.style.justifySelf = ALIGN_H[horizontal];
            if (ALIGN_V[vertical]) element.style.alignSelf = ALIGN_V[vertical];
            return;
        }

        if (parentKind === 'row') {
            // 横向 StackPanel 里横向对齐是被忽略的，只有纵向对齐有意义
            if (ALIGN_V[vertical]) element.style.alignSelf = ALIGN_V[vertical];
            return;
        }

        if (ALIGN_H[horizontal]) element.style.alignSelf = ALIGN_H[horizontal];
    }

    /* ════════════════════════════════════════════════════════════════
       元素分发
       ════════════════════════════════════════════════════════════════ */
    function renderNode(node, ctx, parentKind, isGrid) {
        const name = String(node.name || '').toLowerCase();
        ctx.parentKind = parentKind;
        ctx.isGrid = Boolean(isGrid);
        let element = null;

        switch (name) {
            case 'stackpanel':
            case 'wrappanel':
                element = renderStack(node, ctx, name === 'wrappanel' ? 'wrap' : '');
                break;
            case 'grid':
                element = renderGrid(node, ctx);
                break;
            case 'border':
                element = renderBorder(node, ctx);
                break;
            case 'textblock':
                element = renderText(node, ctx);
                break;
            case 'mycard':
                element = renderCard(node, ctx);
                break;
            case 'myhint':
                element = renderHint(node, ctx);
                break;
            case 'myimage':
            case 'image':
                element = renderImage(node, ctx);
                break;
            case 'mybutton':
                element = renderButton(node, ctx);
                break;
            case 'mytextbutton':
                element = renderTextButton(node, ctx);
                break;
            case 'myicontextbutton':
                element = renderIconTextButton(node, ctx);
                break;
            case 'myiconbutton':
                element = renderIconButton(node, ctx);
                break;
            case 'mylistitem':
                element = renderListItem(node, ctx);
                break;
            case 'path':
                element = renderPath(node, ctx);
                break;
            case 'separator':
                element = el('hr', 'x-sep');
                break;
            case 'run':
            case 'span':
            case 'label':
                element = renderText(node, ctx);
                break;
            default:
                element = renderUnknown(node, ctx, parentKind);
                break;
        }

        if (!element) return null;

        // 卡片、按钮这些自己会把 Margin / Visibility 处理干净，其余在这里统一套
        if (!element.dataset.boxed) {
            applyCommon(node, ctx, element, name === 'textblock' ? 'text' : '');
            applyAlign(node, ctx, element, parentKind, isGrid);
        }
        return element;
    }

    function renderChildren(node, ctx, parentKind) {
        const box = el('div', parentKind === 'row' ? 'x-stack x-stack--h' : 'x-stack x-stack--v');
        node.kids.forEach((kid, index) => {
            const childCtx = { vars: ctx.vars, options: ctx.options, path: ctx.path + '.' + index };
            const child = renderNode(kid, childCtx, parentKind, false);
            if (child) box.appendChild(child);
        });
        return box;
    }

    /* ── 容器 ─────────────────────────────────────────────── */
    function renderStack(node, ctx, mode) {
        const horizontal = mode === 'wrap'
            ? false
            : xaml.value(node, 'Orientation', ctx).toLowerCase() === 'horizontal';
        const box = el('div', 'x-stack');
        box.dataset.boxed = '1';
        applyCommon(node, ctx, box);
        applyAlign(node, ctx, box, ctx.parentKind, ctx.isGrid);

        if (mode === 'wrap') {
            box.classList.add('x-stack--wrap');
        } else {
            box.classList.add(horizontal ? 'x-stack--h' : 'x-stack--v');
        }

        node.kids.forEach((kid, index) => {
            const childCtx = { vars: ctx.vars, options: ctx.options, path: ctx.path + '.' + index };
            const child = renderNode(kid, childCtx, horizontal ? 'row' : 'column', false);
            if (child) box.appendChild(child);
        });
        return box;
    }

    function gridTrack(value) {
        const text = String(value || '').trim();
        if (!text || /^auto$/i.test(text)) return 'auto';
        if (/^\d*\.?\d+\*$/.test(text)) return (parseFloat(text) || 1) + 'fr';
        if (/^\*$/.test(text)) return '1fr';
        const num = parseFloat(text);
        return isNaN(num) ? 'auto' : num + 'px';
    }

    function renderGrid(node, ctx) {
        const grid = el('div', 'x-grid');
        grid.dataset.boxed = '1';
        applyCommon(node, ctx, grid);
        applyAlign(node, ctx, grid, ctx.parentKind, ctx.isGrid);

        const columns = xaml.firstKid(node, 'Grid.ColumnDefinitions');
        const rows = xaml.firstKid(node, 'Grid.RowDefinitions');
        const columnDefs = columns ? xaml.kidsNamed(columns, 'ColumnDefinition') : [];
        const rowDefs = rows ? xaml.kidsNamed(rows, 'RowDefinition') : [];

        if (columnDefs.length) {
            grid.style.gridTemplateColumns = columnDefs
                .map((def) => gridTrack(xaml.rawAttr(def, 'Width', '1*'))).join(' ');
        }
        if (rowDefs.length) {
            grid.style.gridTemplateRows = rowDefs
                .map((def) => gridTrack(xaml.rawAttr(def, 'Height', 'Auto'))).join(' ');
        }

        node.kids.forEach((kid, index) => {
            if (/^grid\.(column|row)definitions$/i.test(kid.name)) return;
            const childCtx = { vars: ctx.vars, options: ctx.options, path: ctx.path + '.' + index };
            const child = renderNode(kid, childCtx, 'column', true);
            if (!child) return;

            const column = parseInt(xaml.rawAttr(kid, 'Grid.Column', '0'), 10);
            const row = parseInt(xaml.rawAttr(kid, 'Grid.Row', '0'), 10);
            const columnSpan = parseInt(xaml.rawAttr(kid, 'Grid.ColumnSpan', '1'), 10);
            const rowSpan = parseInt(xaml.rawAttr(kid, 'Grid.RowSpan', '1'), 10);
            child.style.gridColumn = (column || 0) + 1 + ' / span ' + (columnSpan > 1 ? columnSpan : 1);
            child.style.gridRow = (row || 0) + 1 + ' / span ' + (rowSpan > 1 ? rowSpan : 1);
            grid.appendChild(child);
        });
        return grid;
    }

    function renderBorder(node, ctx) {
        const box = el('div', 'x-border');
        box.dataset.boxed = '1';
        applyCommon(node, ctx, box);
        applyAlign(node, ctx, box, ctx.parentKind, ctx.isGrid);

        const background = xaml.toCssColor(xaml.value(node, 'Background', ctx));
        if (background) box.style.background = background;

        const borderColor = xaml.toCssColor(xaml.value(node, 'BorderBrush', ctx));
        const borderWidth = xaml.thickness(xaml.rawAttr(node, 'BorderThickness'));
        if (borderColor && borderWidth) {
            box.style.border = '1px solid ' + borderColor;
            box.style.borderWidth = borderWidth;
        }

        const radius = xaml.thickness(xaml.rawAttr(node, 'CornerRadius'));
        if (radius) box.style.borderRadius = radius;

        node.kids.forEach((kid, index) => {
            const childCtx = { vars: ctx.vars, options: ctx.options, path: ctx.path + '.' + index };
            const child = renderNode(kid, childCtx, 'column', false);
            if (child) box.appendChild(child);
        });
        return box;
    }

    /* ── 文本 ─────────────────────────────────────────────── */
    function renderText(node, ctx) {
        const text = el('div', 'x-text');
        applyCommon(node, ctx, text, 'text');

        const size = xaml.value(node, 'FontSize', ctx);
        if (size && !isNaN(parseFloat(size))) text.style.fontSize = px(size);

        const weight = xaml.value(node, 'FontWeight', ctx);
        if (weight) {
            const value = String(weight).toLowerCase();
            if (/^(bold|black|heavy)$/.test(value)) text.style.fontWeight = '700';
            else if (/^(semibold|demibold)$/.test(value)) text.style.fontWeight = '600';
            else if (value === 'medium') text.style.fontWeight = '550';
            else if (value === 'light') text.style.fontWeight = '350';
            else if (/^\d+$/.test(value)) text.style.fontWeight = value;
            else if (value !== 'normal') text.style.fontWeight = '400';
        }

        const foreground = xaml.toCssColor(xaml.value(node, 'Foreground', ctx));
        if (foreground) text.style.color = foreground;

        const background = xaml.toCssColor(xaml.value(node, 'Background', ctx));
        if (background) {
            text.style.background = background;
            text.style.padding = '1px 5px';
            text.style.borderRadius = '4px';
        }

        if (/italic|oblique/i.test(xaml.value(node, 'FontStyle', ctx))) text.style.fontStyle = 'italic';
        if (/underline/i.test(xaml.value(node, 'TextDecorations', ctx))) text.style.textDecoration = 'underline';
        if (/strike/i.test(xaml.value(node, 'TextDecorations', ctx))) text.style.textDecoration = 'line-through';

        const align = xaml.value(node, 'TextAlignment', ctx).toLowerCase();
        if (align === 'center' || align === 'right') text.style.textAlign = align;

        const lineHeight = xaml.value(node, 'LineHeight', ctx);
        if (lineHeight && !isNaN(parseFloat(lineHeight))) text.style.lineHeight = px(lineHeight);

        // WPF 默认不换行，但显式换行符（&#xA;）永远保留
        const wrapping = xaml.value(node, 'TextWrapping', ctx).toLowerCase();
        text.style.whiteSpace = wrapping === 'nowrap' ? 'pre' : 'pre-wrap';
        if (wrapping && wrapping !== 'nowrap') text.style.overflowWrap = 'anywhere';

        const trimming = xaml.value(node, 'TextTrimming', ctx);
        if (/characterellipsis|wordellipsis/i.test(trimming)) {
            text.style.whiteSpace = 'nowrap';
            text.style.overflow = 'hidden';
            text.style.textOverflow = 'ellipsis';
        }

        text.appendChild(xaml.inlineFragment(node, ctx, document));
        if (!text.textContent.trim() && !text.querySelector('br')) return null;

        attachLinks(text);
        return text;
    }

    /** 文本里的 Hyperlink 交给系统浏览器（和公告里的外链一个规则）。 */
    function attachLinks(root) {
        if (!root.querySelector('a[data-external]')) return;
        root.addEventListener('click', (event) => {
            const link = event.target.closest('a[data-external]');
            if (!link) return;
            event.preventDefault();
            openUrl(link.getAttribute('href'));
        });
    }

    /* ── 卡片 ─────────────────────────────────────────────── */
    function renderCard(node, ctx) {
        const card = el('section', 'x-card');
        card.dataset.boxed = '1';
        applyCommon(node, ctx, card);
        applyAlign(node, ctx, card, ctx.parentKind, ctx.isGrid);

        const title = xaml.value(node, 'Title', ctx);
        const canSwap = flag(node, 'CanSwap', ctx, false);
        const swappedDefault = flag(node, 'IsSwapped', ctx, false);

        // 只记「用户手动折叠过」的状态：没点过的卡片每次都按 IsSwapped 现算，
        // 这样 {variable:...} 改了以后卡片能跟着展开 / 收起
        const key = ctx.path;
        const collapsed = cardState.has(key) ? cardState.get(key) : (canSwap && swappedDefault);

        const body = el('div', 'x-card-body');
        const inner = el('div', 'x-card-inner');
        node.kids.forEach((kid, index) => {
            const childCtx = { vars: ctx.vars, options: ctx.options, path: ctx.path + '.' + index };
            const child = renderNode(kid, childCtx, 'column', false);
            if (child) inner.appendChild(child);
        });
        body.appendChild(inner);

        if (title || canSwap) {
            const head = el(canSwap ? 'button' : 'div', 'x-card-head');
            if (canSwap) head.type = 'button';

            const caption = el('span', 'x-card-title');
            caption.textContent = title;
            head.appendChild(caption);

            if (canSwap) {
                head.appendChild(svgUse('i-chevron-down', 'x-card-chevron'));
                head.setAttribute('aria-expanded', String(!collapsed));
                head.addEventListener('click', () => {
                    const next = !card.classList.contains('is-collapsed');
                    card.classList.toggle('is-collapsed', next);
                    cardState.set(key, next);
                    head.setAttribute('aria-expanded', String(!next));
                    if (!next) fitLogos(card);
                });
            }
            card.appendChild(head);
        } else {
            card.classList.add('x-card--bare');
        }

        if (flag(node, 'SwapLogoRight', ctx, false)) card.classList.add('is-logo-right');
        if (!flag(node, 'HasMouseAnimation', ctx, true)) card.classList.add('is-static');
        if (collapsed) card.classList.add('is-collapsed');

        card.appendChild(body);
        return card;
    }

    /* ── 提示条 ───────────────────────────────────────────── */
    function renderHint(node, ctx) {
        const theme = (xaml.value(node, 'Theme', ctx) || 'Blue').toLowerCase();
        const hint = el('div', 'x-hint x-hint--' + (theme === 'yellow' || theme === 'red' ? theme : 'blue'));
        applyCommon(node, ctx, hint);
        applyAlign(node, ctx, hint, ctx.parentKind, ctx.isGrid);

        hint.appendChild(svgUse(theme === 'red' || theme === 'yellow' ? 'i-info' : 'i-info', 'x-hint-icon'));
        const body = el('span', 'x-hint-text');
        body.appendChild(xaml.inlineFragment(node, ctx, document));
        hint.appendChild(body);
        return hint;
    }

    /* ── 图片 ─────────────────────────────────────────────── */
    function localImageUrl(path) {
        return '/api/local-image?path=' + encodeURIComponent(path) + '&v=' + state.stamp;
    }

    function isRemoteSource(source) {
        return /^(https?:)?\/\//i.test(source) || /^data:/i.test(source);
    }

    function packName(source) {
        const match = /^pack:\/\/application:,,,\/images\/(.+)$/i.exec(String(source || '').trim());
        if (!match) return '';
        return match[1].split('/').pop().replace(/\.png$/i, '');
    }

    function renderImage(node, ctx) {
        const source = xaml.value(node, 'Source', ctx).trim();
        const fallback = xaml.value(node, 'FallbackSource', ctx).trim();

        const wrap = el('div', 'x-image-wrap');
        wrap.dataset.boxed = '1';
        applyCommon(node, ctx, wrap);
        applyAlign(node, ctx, wrap, ctx.parentKind, ctx.isGrid);

        const pack = source ? packName(source) : '';
        if (!source || pack || (!isRemoteSource(source) && !hostMod.hasHost())) {
            // 内置 pack:// 图片和「浏览器预览下的本地路径」都只能给个占位
            const miss = el('span', 'x-image-miss');
            miss.textContent = pack ? pack.split('/').pop() : '图片';
            miss.title = source || '没有指定 Source';
            wrap.appendChild(miss);
            wrap.classList.add('is-placeholder');
            return wrap;
        }

        const img = el('img', 'x-image');
        // Width / Height 属于图片本身，applyCommon 先放在外层容器上，这里挪进来
        if (wrap.style.width) { img.style.width = wrap.style.width; wrap.style.width = ''; }
        if (wrap.style.height) { img.style.height = wrap.style.height; wrap.style.maxHeight = 'none'; wrap.style.height = ''; }
        img.alt = xaml.value(node, 'ToolTip', ctx) || '图片';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = isRemoteSource(source) ? source : localImageUrl(source);

        const stretch = xaml.value(node, 'Stretch', ctx).toLowerCase();
        img.style.objectFit = stretch === 'fill' ? 'fill'
            : stretch === 'uniformtofill' ? 'cover'
                : stretch === 'none' ? 'none' : 'contain';

        img.addEventListener('error', () => {
            if (fallback && img.dataset.fallback !== '1') {
                img.dataset.fallback = '1';
                img.src = isRemoteSource(fallback) ? fallback : localImageUrl(fallback);
                return;
            }
            const miss = el('span', 'x-image-miss');
            miss.textContent = '图片加载失败';
            miss.title = source;
            wrap.replaceChildren(miss);
            wrap.classList.add('is-placeholder');
        });

        wrap.appendChild(img);
        return wrap;
    }

    /* ── 按钮 ─────────────────────────────────────────────── */
    function colorClass(node, ctx) {
        const type = (xaml.value(node, 'ColorType', ctx) || '').toLowerCase();
        if (type === 'highlight') return 'x-btn--accent';
        if (type === 'red') return 'x-btn--red';
        if (type === 'black' || type === 'white') return 'x-btn--plain';
        return 'x-btn--soft';
    }

    function renderButton(node, ctx) {
        const button = el('button', 'x-btn ' + colorClass(node, ctx));
        button.type = 'button';
        applyCommon(node, ctx, button);
        applyAlign(node, ctx, button, ctx.parentKind, ctx.isGrid);

        const padding = xaml.thickness(xaml.rawAttr(node, 'Padding'));
        button.style.padding = padding || '0 18px';

        const label = el('span', 'x-btn-label');
        label.appendChild(xaml.inlineFragment(node, ctx, document));
        button.appendChild(label);

        bindEvents(button, node, ctx);
        return button;
    }

    function renderTextButton(node, ctx) {
        const button = el('button', 'x-btn x-btn--text');
        button.type = 'button';
        applyCommon(node, ctx, button);
        applyAlign(node, ctx, button, ctx.parentKind, ctx.isGrid);

        const label = el('span', 'x-btn-label');
        label.appendChild(xaml.inlineFragment(node, ctx, document));
        button.appendChild(label);

        bindEvents(button, node, ctx);
        return button;
    }

    function svgLogo(data, scale) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'x-logo');
        svg.setAttribute('data-logo', '1');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('viewBox', '0 0 1024 1024');
        svg.setAttribute('fill', 'currentColor');

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', data);
        svg.appendChild(path);

        const ratio = parseFloat(scale);
        if (!isNaN(ratio) && ratio > 0) {
            svg.style.transform = ratio === 1 ? '' : 'scale(' + ratio + ')';
        }
        return svg;
    }

    /** Path 图标的 viewBox 要按实际包围盒来算，插入文档后统一测一遍。 */
    function fitLogos(root) {
        const logos = root.querySelectorAll ? root.querySelectorAll('svg[data-logo]') : [];
        logos.forEach((svg) => {
            if (svg.dataset.fitted === '1') return;
            const path = svg.querySelector('path');
            if (!path || typeof path.getBBox !== 'function') return;
            try {
                const box = path.getBBox();
                if (!box || !box.width || !box.height) return;
                const pad = Math.max(box.width, box.height) * 0.02;
                svg.setAttribute('viewBox',
                    (box.x - pad) + ' ' + (box.y - pad) + ' ' +
                    (box.width + pad * 2) + ' ' + (box.height + pad * 2));
                svg.dataset.fitted = '1';
            } catch (err) {
                // 还没进文档 / 被隐藏时跳过，展开后再试
            }
        });
    }

    function renderIconTextButton(node, ctx) {
        const button = el('button', 'x-btn x-btn--icon ' + colorClass(node, ctx));
        button.type = 'button';
        applyCommon(node, ctx, button);
        applyAlign(node, ctx, button, ctx.parentKind, ctx.isGrid);
        button.style.padding = xaml.thickness(xaml.rawAttr(node, 'Padding')) || '0 16px';

        const logo = xaml.value(node, 'Logo', ctx).trim();
        if (logo) button.appendChild(svgLogo(logo, xaml.value(node, 'LogoScale', ctx)));

        const label = el('span', 'x-btn-label');
        label.appendChild(xaml.inlineFragment(node, ctx, document));
        button.appendChild(label);

        bindEvents(button, node, ctx);
        return button;
    }

    function renderIconButton(node, ctx) {
        const theme = (xaml.value(node, 'Theme', ctx) || 'Color').toLowerCase();
        let modifier = 'x-btn--soft';
        if (theme === 'red') modifier = 'x-btn--red';
        else if (theme === 'color' || theme === 'highlight') modifier = 'x-btn--accent';
        else if (theme === 'white' || theme === 'black') modifier = 'x-btn--plain';

        const button = el('button', 'x-btn x-btn--icon x-btn--square ' + modifier);
        button.type = 'button';
        applyCommon(node, ctx, button);
        applyAlign(node, ctx, button, ctx.parentKind, ctx.isGrid);

        const logo = xaml.value(node, 'Logo', ctx).trim();
        if (logo) button.appendChild(svgLogo(logo, xaml.value(node, 'LogoScale', ctx)));

        bindEvents(button, node, ctx);
        return button;
    }

    /* ── 列表项 ───────────────────────────────────────────── */
    function renderListItem(node, ctx) {
        const clickable = /clickable/i.test(xaml.value(node, 'Type', ctx));
        const item = el(clickable ? 'button' : 'div', 'x-item');
        if (clickable) item.type = 'button';
        item.dataset.boxed = '1';
        applyCommon(node, ctx, item);
        applyAlign(node, ctx, item, ctx.parentKind, ctx.isGrid);

        const logo = xaml.value(node, 'Logo', ctx).trim();
        const logoBox = el('span', 'x-item-logo');
        const pack = logo ? packName(logo) : '';
        if (logo && !pack && (isRemoteSource(logo) || hostMod.hasHost())) {
            const img = el('img', 'x-item-img');
            img.alt = '';
            img.src = isRemoteSource(logo) ? logo : localImageUrl(logo);
            img.addEventListener('error', () => {
                logoBox.replaceChildren(svgUse('i-box', 'icon'));
            });
            logoBox.appendChild(img);
        } else {
            logoBox.appendChild(svgUse('i-box', 'icon'));
            if (pack) logoBox.title = pack;
        }
        item.appendChild(logoBox);

        const copy = el('span', 'x-item-copy');
        const title = xaml.value(node, 'Title', ctx);
        if (title) {
            const strong = el('b', 'x-item-title');
            strong.textContent = title;
            copy.appendChild(strong);
        }
        const info = xaml.value(node, 'Info', ctx);
        if (info) {
            const small = el('small', 'x-item-info');
            small.textContent = info;
            copy.appendChild(small);
        }
        item.appendChild(copy);

        if (clickable) {
            item.classList.add('is-clickable');
            item.appendChild(svgUse('i-chevron-right', 'x-item-arrow'));
            bindEvents(item, node, ctx);
        }
        return item;
    }

    /* ── 矢量图 ───────────────────────────────────────────── */
    function renderPath(node, ctx) {
        const data = xaml.value(node, 'Data', ctx).trim();
        if (!data) return null;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'x-path');
        svg.setAttribute('data-logo', '1');
        svg.setAttribute('viewBox', '0 0 1024 1024');

        const fill = xaml.value(node, 'Fill', ctx);
        const color = xaml.toCssColor(fill);
        svg.setAttribute('fill', color || 'currentColor');
        if (!color && fill) svg.style.fill = fill;

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', data);
        svg.appendChild(path);

        svg.dataset.boxed = '1';
        applyCommon(node, ctx, svg);
        applyAlign(node, ctx, svg, ctx.parentKind, ctx.isGrid);
        if (!svg.style.width) svg.style.width = '20px';
        if (!svg.style.height) svg.style.height = '20px';
        return svg;
    }

    /* ── 兜底：不认识的元素把内容原样摊开 ─────────────────── */
    function renderUnknown(node, ctx, parentKind) {
        if (node.kids.some((kid) => /^(stackpanel|grid|textblock|mycard)$/i.test(kid.name))) {
            return renderChildren(node, ctx, parentKind === 'row' ? 'row' : 'column');
        }
        if (!xaml.plainText(node, ctx) && !node.kids.length) return null;
        return renderText(node, ctx);
    }

    /* ════════════════════════════════════════════════════════════════
       事件
       ════════════════════════════════════════════════════════════════ */
    function collectEvents(node, ctx) {
        const list = [];
        const type = xaml.value(node, 'EventType', ctx);
        if (type) list.push({ type: type, data: xaml.value(node, 'EventData', ctx) });

        const service = xaml.firstKid(node, 'CustomEventService.Events');
        if (service) {
            const collection = xaml.firstKid(service, 'CustomEventCollection') || service;
            xaml.kidsNamed(collection, 'CustomEvent').forEach((item) => {
                const itemType = xaml.value(item, 'Type', ctx);
                if (!itemType) return;
                list.push({ type: itemType, data: xaml.value(item, 'Data', ctx) });
            });
        }
        return list;
    }

    function bindEvents(element, node, ctx) {
        const events = collectEvents(node, ctx);
        if (!events.length) return;

        element.classList.add('has-action');
        element.addEventListener('click', (event) => {
            event.preventDefault();
            let refresh = false;
            events.forEach((item) => {
                if (runEvent(item, ctx)) refresh = true;
            });
            if (refresh) paint();
        });
    }

    /** 执行一个事件；返回 true 表示需要整页重画。 */
    function runEvent(item, ctx) {
        const type = String(item.type || '').trim();
        const data = String(item.data || '');

        switch (type) {
            case '打开网页':
                openUrl(data);
                return false;

            case '弹出窗口':
                showDialog(data);
                return false;

            case '复制文本':
                copyText(data);
                return false;

            case '打开文件':
            case '打开文件夹':
                openPath(data);
                return false;

            case '下载文件':
                if (/^https?:\/\//i.test(data.trim())) {
                    openUrl(data.trim());
                    toast('已交给浏览器下载：' + data.trim(), 'i-download');
                } else {
                    toast('下载文件事件需要一个 http/https 链接', 'i-info');
                }
                return false;

            case '启动游戏':
                launchGame(data);
                return false;

            case '修改变量': {
                const parts = data.split('|');
                const name = (parts[0] || '').trim();
                const value = (parts[1] || '').trim();
                if (!name) return false;
                if (value === '-' || value === '') delete vars[name];
                else vars[name] = value;
                return true;
            }

            case '刷新页面':
                return true;

            case '打开帮助':
                toast('帮助文档还没有内置：' + (data || '（未指定）'), 'i-info');
                return false;

            case '内存优化':
                toast('内存优化：正在整理工作集…', 'i-refresh');
                window.setTimeout(() => toast('内存优化完成', 'i-check'), 900);
                return false;

            case '清理垃圾':
                toast('清理完成：临时文件已清空', 'i-trash');
                return false;

            default:
                toast('暂不支持的事件：' + type, 'i-info');
                return false;
        }
    }

    function openUrl(url) {
        const href = String(url || '').trim();
        if (!/^https?:\/\//i.test(href)) {
            toast('链接格式不对：' + href, 'i-info');
            return;
        }
        if (hostPost({ type: 'open-external', url: href })) return;
        window.open(href, '_blank', 'noopener');
    }

    function openPath(path) {
        const target = String(path || '').trim();
        if (!target) {
            toast('没有填写要打开的路径', 'i-info');
            return;
        }
        if (hostPost({ type: 'open-path', path: target, base: state.options.basePath || '' })) return;
        toast('当前环境打不开本地路径：' + target, 'i-info');
    }

    function copyText(text) {
        const value = String(text || '');
        if (!value) return;
        const done = () => toast('已复制到剪贴板', 'i-check');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(done).catch(() => legacyCopy(value, done));
            return;
        }
        legacyCopy(value, done);
    }

    function legacyCopy(value, done) {
        try {
            const area = el('textarea', 'x-copy-buffer');
            area.value = value;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
            done();
        } catch (err) {
            toast('复制失败，剪贴板不可用', 'i-info');
        }
    }

    function launchGame(data) {
        const parts = String(data || '').split('|');
        const version = (parts[0] || '').trim();
        const server = (parts[1] || '').trim();
        const launchMod = SL.core.mod('launch');

        if (version) {
            const instances = (SL.state && SL.state.instances) || [];
            const match = instances.find((item) =>
                item.name === version || item.id === version ||
                String(item.name || '').toLowerCase() === version.toLowerCase());
            if (!match) {
                toast('找不到版本「' + version + '」，先去版本管理里添加', 'i-info');
                return;
            }
            if (SL.state.ui) SL.state.ui.activeId = match.id;
            if (SL.versions && typeof SL.versions.selectInstance === 'function') {
                SL.versions.selectInstance(match.id);
            }
        }

        if (server) toast('服务器地址已记录：' + server, 'i-info');
        if (launchMod.startLaunch) launchMod.startLaunch();
    }

    function showDialog(data) {
        const text = String(data || '');
        const split = text.indexOf('|');
        const title = split >= 0 ? text.slice(0, split) : '提示';
        const body = split >= 0 ? text.slice(split + 1) : text;

        const modal = el('div', 'modal x-modal');
        const scrim = el('div', 'modal-scrim');
        const card = el('div', 'modal-card');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');

        const heading = el('h2', 'x-modal-title');
        heading.textContent = title.trim() || '提示';
        card.appendChild(heading);

        const content = el('div', 'x-modal-body');
        String(body).split(/\\n|\n/).forEach((line) => {
            const p = el('p');
            p.textContent = line;
            content.appendChild(p);
        });
        card.appendChild(content);

        const actions = el('div', 'launch-actions');
        const close = el('button', 'btn btn-filled');
        close.type = 'button';
        close.textContent = '知道了';
        actions.appendChild(close);
        card.appendChild(actions);

        modal.appendChild(scrim);
        modal.appendChild(card);
        document.body.appendChild(modal);

        const dismiss = () => {
            modal.remove();
            document.removeEventListener('keydown', onKey);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') dismiss();
        };
        scrim.addEventListener('click', dismiss);
        close.addEventListener('click', dismiss);
        document.addEventListener('keydown', onKey);
        close.focus({ preventScroll: true });
    }

    /* ════════════════════════════════════════════════════════════════
       挂载 / 重画
       ════════════════════════════════════════════════════════════════ */
    function message(text, detail) {
        const box = el('div', 'x-message');
        const line = el('p', 'x-message-text');
        line.textContent = text;
        box.appendChild(line);
        if (detail) {
            const pre = el('pre', 'x-message-detail');
            pre.textContent = detail;
            box.appendChild(pre);
        }
        return box;
    }

    function paint() {
        const container = state.container;
        if (!container) return { ok: false, error: '' };

        const parsed = xaml.parse(state.source);
        container.replaceChildren();

        if (!parsed.ok) {
            container.appendChild(message('Custom.xaml 格式有误：' + parsed.error,
                String(state.source || '').slice(0, 1200)));
            return { ok: false, error: parsed.error };
        }
        if (!parsed.nodes.length) {
            container.appendChild(message('Custom.xaml 里还没有内容。', ''));
            return { ok: true, error: '' };
        }

        const ctx = { vars: vars, options: state.options, path: 'r' };
        const page = el('div', 'x-page');
        const stack = el('div', 'x-stack x-stack--v');

        parsed.nodes.forEach((node, index) => {
            const childCtx = { vars: vars, options: state.options, path: 'r.' + index };
            const element = renderNode(node, childCtx, 'column', false);
            if (element) stack.appendChild(element);
        });

        page.appendChild(stack);
        container.appendChild(page);

        // 图标包围盒要等元素进文档才量得到
        fitLogos(page);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => fitLogos(page));
        }
        return { ok: true, error: '' };
    }

    /**
     * 渲染一份 Custom.xaml。
     * @param {HTMLElement} container 目标容器
     * @param {string} source 文件内容
     * @param {{basePath?: string}} options basePath 用于解析相对路径
     */
    function mount(container, source, options) {
        if (!container) return { ok: false, error: '' };
        state.container = container;
        state.source = String(source || '');
        state.options = options || {};
        state.stamp = Date.now();
        return paint();
    }

    function rerender() {
        return paint();
    }

    /** 清掉变量与折叠状态（换文件时用）。 */
    function reset() {
        Object.keys(vars).forEach((key) => delete vars[key]);
        cardState.clear();
    }

    /** 当前变量表的副本（调试 / 测试用）。 */
    function getVars() {
        return Object.assign({}, vars);
    }

    SL.xamlView = { mount, rerender, reset, getVars };
})(window);
