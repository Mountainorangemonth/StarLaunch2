/* =====================================================================
   StarLaunch · XAML 解析
   ---------------------------------------------------------------------
   把 PCL 的 Custom.xaml 读成节点树，供 17-xaml-view.js 渲染。

   和标准 XAML 的差别（都是 PCL 文件的实际样子）：
   · 文件有多个顶层元素，外面没有根节点 —— 这里套一层假根再交给 DOMParser；
   · 文件不声明 xmlns —— 这里补上 PCL 默认的四个命名空间；
   · 用户手写的 & 不是合法实体 —— 解析前先补成 &amp;。

   只处理「读」这一侧：不认识的元素/属性一律忽略，不让整份文件失效。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    /* PCL 默认的四个命名空间，见 Custom.xaml 末尾的说明。
       注意 local 的 URI 里带空格（assembly=Plain Craft Launcher 2），XML 规范
       要求命名空间是合法 URI，Chromium 会因此判整份文件不合法，所以空格要
       转义成 %20；命名空间本身不参与渲染，元素是按 localName 匹配的。 */
    const NAMESPACES = ' xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"' +
        ' xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"' +
        ' xmlns:sys="clr-namespace:System;assembly=mscorlib"' +
        ' xmlns:local="clr-namespace:PCL;assembly=Plain%20Craft%20Launcher%202"';

    const VARIABLE_RE = /^\{\s*variable\s*:\s*([^:}]+?)\s*(?::([^}]*))?\}$/i;
    const RESOURCE_RE = /^\{\s*(?:DynamicResource|StaticResource)\s+([^}]+?)\s*\}$/i;

    /* ════════════════════════════════════════════════════════════════
       1. 解析
       ════════════════════════════════════════════════════════════════ */
    function normalizeSource(src) {
        let text = String(src == null ? '' : src).replace(/^\uFEFF/, '');
        // 去掉 XML 声明：套假根之后它就不再合法了
        text = text.replace(/<\?xml[\s\S]*?\?>/gi, '');
        // 裸 & 会让解析直接失败，先补成实体（已经是实体的不动）
        text = text.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;');
        // 文件自己写的 clr-namespace 里也可能有空格（复制 PCL 的写法很常见），
        // 同样得转义，否则整个文档解析不过
        text = text.replace(/(xmlns:[\w.-]+\s*=\s*")(clr-namespace:[^"]*)(")/gi, (all, head, uri, tail) =>
            head + uri.replace(/\s+/g, '%20') + tail);
        return text;
    }

    function toNode(el) {
        const props = {};
        for (let i = 0; i < el.attributes.length; i += 1) {
            const attr = el.attributes[i];
            props[attr.name] = attr.value;
        }

        const node = {
            name: el.localName || el.nodeName,
            prefix: el.prefix || '',
            props: props,
            kids: [],
            text: ''
        };

        for (let i = 0; i < el.childNodes.length; i += 1) {
            const child = el.childNodes[i];
            if (child.nodeType === 1) {
                node.kids.push(toNode(child));
            } else if (child.nodeType === 3 || child.nodeType === 4) {
                node.text += child.nodeValue;
            }
        }
        return node;
    }

    function parse(src) {
        const text = normalizeSource(src);
        if (!text.trim()) return { ok: true, nodes: [], error: '' };

        let doc = null;
        try {
            doc = new DOMParser().parseFromString('<sl-root' + NAMESPACES + '>' + text + '</sl-root>', 'application/xml');
        } catch (err) {
            return { ok: false, nodes: [], error: 'XML 解析失败：' + err.message };
        }

        const errorNode = doc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            const detail = String(errorNode.textContent || '').replace(/\s+/g, ' ').trim();
            return { ok: false, nodes: [], error: detail || 'XML 格式有误' };
        }

        const root = doc.documentElement;
        if (!root) return { ok: false, nodes: [], error: 'XML 解析失败' };

        const nodes = [];
        for (let i = 0; i < root.childNodes.length; i += 1) {
            const child = root.childNodes[i];
            if (child.nodeType === 1) nodes.push(toNode(child));
        }
        return { ok: true, nodes: nodes, error: '' };
    }

    /* ════════════════════════════════════════════════════════════════
       2. 属性读取
       ════════════════════════════════════════════════════════════════ */
    /** 读原始属性值；XAML 属性区分大小写，但写法不规范时容错一次。 */
    function rawAttr(node, name, fallback) {
        if (!node || !node.props) return fallback === undefined ? '' : fallback;
        if (Object.prototype.hasOwnProperty.call(node.props, name)) return node.props[name];
        const lower = String(name).toLowerCase();
        const keys = Object.keys(node.props);
        for (let i = 0; i < keys.length; i += 1) {
            if (keys[i].toLowerCase() === lower) return node.props[keys[i]];
        }
        return fallback === undefined ? '' : fallback;
    }

    function hasAttr(node, name) {
        if (!node || !node.props) return false;
        if (Object.prototype.hasOwnProperty.call(node.props, name)) return true;
        const lower = String(name).toLowerCase();
        return Object.keys(node.props).some((key) => key.toLowerCase() === lower);
    }

    /** 找指定名字的子元素（属性元素，比如 Grid.ColumnDefinitions）。 */
    function kidsNamed(node, name) {
        if (!node || !node.kids) return [];
        const lower = String(name).toLowerCase();
        return node.kids.filter((kid) => String(kid.name).toLowerCase() === lower);
    }

    function firstKid(node, name) {
        return kidsNamed(node, name)[0] || null;
    }

    /* ════════════════════════════════════════════════════════════════
       3. 值的解析：标记扩展 / 颜色 / 尺寸 / 布尔
       ════════════════════════════════════════════════════════════════ */

    /* 主题色浓度：ColorBrush1 最浓（就是主题色），8 最淡 */
    const BRAND_STEPS = { 1: 100, 2: 82, 3: 66, 4: 52, 5: 40, 6: 28, 7: 18, 8: 9 };

    const NAMED_COLORS = {
        black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080',
        red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047',
        blue: '#1e88e5', purple: '#8e24aa', pink: '#ec407a', brown: '#8d6e63',
        silver: '#c0c0c0', navy: '#001f3f', teal: '#009688', gold: '#ffd700',
        transparent: 'transparent'
    };

    function brandColor(index) {
        const step = BRAND_STEPS[Number(index)] || 60;
        return 'color-mix(in srgb, var(--brand) ' + step + '%, var(--m3-surface))';
    }

    /** #RGB / #ARGB / #RRGGBB / #AARRGGBB、颜色名 → CSS 颜色；不认识就返回空串。 */
    function toCssColor(value) {
        const text = String(value || '').trim();
        if (!text) return '';

        if (text.charAt(0) === '#') {
            const hex = text.slice(1);
            if (!/^[0-9a-fA-F]+$/.test(hex)) return '';
            if (hex.length === 3) {
                return '#' + hex.split('').map((ch) => ch + ch).join('');
            }
            if (hex.length === 4) {
                const a = Math.round((parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255) * 1000) / 1000;
                const r = parseInt(hex.charAt(1) + hex.charAt(1), 16);
                const g = parseInt(hex.charAt(2) + hex.charAt(2), 16);
                const b = parseInt(hex.charAt(3) + hex.charAt(3), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
            }
            if (hex.length === 6) return '#' + hex.toLowerCase();
            if (hex.length === 8) {
                const a = Math.round((parseInt(hex.slice(0, 2), 16) / 255) * 1000) / 1000;
                const r = parseInt(hex.slice(2, 4), 16);
                const g = parseInt(hex.slice(4, 6), 16);
                const b = parseInt(hex.slice(6, 8), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
            }
            return '';
        }

        const named = NAMED_COLORS[text.toLowerCase()];
        if (named) return named;
        if (/^(rgb|rgba|hsl|hsla|color-mix)\(/i.test(text)) return text;
        return '';
    }

    /**
     * 解析属性值：{variable:名字:默认值}、{DynamicResource ColorBrushN}，
     * 以及 [日期] [时间] [启动器版本] 这类替换标记。
     */
    function resolveValue(value, ctx) {
        const text = String(value == null ? '' : value);
        if (!text.trim()) return '';

        const variable = VARIABLE_RE.exec(text.trim());
        if (variable) {
            const name = variable[1].trim();
            const vars = (ctx && ctx.vars) || {};
            if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name]);
            return variable[2] == null ? '' : variable[2];
        }

        const resource = RESOURCE_RE.exec(text.trim());
        if (resource) {
            const brush = /^ColorBrush(\d)$/i.exec(resource[1].trim());
            return brush ? brandColor(brush[1]) : '';
        }

        // 其余 {…} 是不支持的标记扩展：留空，别把花括号画到界面上
        if (/^\{[\s\S]*\}$/.test(text.trim())) return '';

        return replaceMarkers(text);
    }

    /** 文本里的替换标记（PCL 叫法），只做我们能算出来的那几个。 */
    function replaceMarkers(text) {
        if (text.indexOf('[') < 0) return text;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const map = {
            '日期': now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
            '时间': pad(now.getHours()) + ':' + pad(now.getMinutes()),
            '启动器版本': launcherVersion(),
            '启动器': 'StarLaunch'
        };
        return text.replace(/\[([^[\]]{1,12})\]/g, (match, name) => {
            return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : match;
        });
    }

    function launcherVersion() {
        const badge = document.querySelector('[data-launcher-version]');
        if (badge && badge.dataset.launcherVersion) return badge.dataset.launcherVersion;
        return 'StarLaunch';
    }

    /** 读一个属性并解析，返回字符串。 */
    function value(node, name, ctx) {
        return resolveValue(rawAttr(node, name), ctx);
    }

    function boolAttr(node, name, fallback) {
        const raw = rawAttr(node, name, '');
        if (!raw) return Boolean(fallback);
        const text = String(raw).trim().toLowerCase();
        if (text === 'true' || text === '1' || text === 'yes') return true;
        if (text === 'false' || text === '0' || text === 'no') return false;
        return Boolean(fallback);
    }

    function numAttr(node, name, fallback) {
        const raw = parseFloat(rawAttr(node, name, ''));
        return isNaN(raw) ? fallback : raw;
    }

    /** WPF Thickness → CSS 简写（内部顺序是 左,上,右,下）。 */
    function thickness(valueText) {
        const parts = String(valueText || '').split(',').map((part) => part.trim()).filter(Boolean);
        if (!parts.length) return '';
        const nums = parts.map((part) => {
            const num = parseFloat(part);
            return isNaN(num) ? 0 : num;
        });
        let top;
        let right;
        let bottom;
        let left;
        if (nums.length === 1) {
            top = right = bottom = left = nums[0];
        } else if (nums.length === 2) {
            top = bottom = nums[1];
            right = left = nums[0];
        } else {
            left = nums[0];
            top = nums[1];
            right = nums[2];
            bottom = nums[3] === undefined ? nums[1] : nums[3];
        }
        return [top, right, bottom, left].map((num) => (num === 0 ? '0' : num + 'px')).join(' ');
    }

    /* ════════════════════════════════════════════════════════════════
       4. 内联文本（TextBlock 的 Run / Bold / Hyperlink / LineBreak）
       ════════════════════════════════════════════════════════════════ */
    /**
     * 把 TextBlock 的内容渲染成 DocumentFragment：
     * Text 属性优先，没有就遍历子节点里的文本与 Run 系元素。
     */
    function inlineFragment(node, ctx, doc) {
        const fragment = doc.createDocumentFragment();

        const walk = (current, into) => {
            current.kids.forEach((kid) => {
                const name = String(kid.name).toLowerCase();
                if (name === 'linebreak') {
                    into.appendChild(doc.createElement('br'));
                    return;
                }
                if (name === 'run' || name === 'span' || name === 'label' || name === 'textblock') {
                    const text = resolveValue(rawAttr(kid, 'Text'), ctx);
                    if (text) {
                        const span = doc.createElement('span');
                        const color = toCssColor(resolveValue(rawAttr(kid, 'Foreground'), ctx));
                        if (color) span.style.color = color;
                        const weight = rawAttr(kid, 'FontWeight');
                        if (weight) span.style.fontWeight = /bold|black|semibold/i.test(weight) ? '700' : '';
                        span.textContent = text;
                        into.appendChild(span);
                    } else {
                        walk(kid, into);
                    }
                    return;
                }
                if (name === 'bold' || name === 'b' || name === 'italic' || name === 'i' ||
                    name === 'underline' || name === 'u' || name === 'hyperlink') {
                    const wrapper = doc.createElement(name === 'hyperlink' ? 'a' : 'span');
                    if (name === 'bold' || name === 'b') wrapper.style.fontWeight = '700';
                    if (name === 'italic' || name === 'i') wrapper.style.fontStyle = 'italic';
                    if (name === 'underline' || name === 'u') wrapper.style.textDecoration = 'underline';
                    if (name === 'hyperlink') {
                        const uri = resolveValue(rawAttr(kid, 'NavigateUri'), ctx);
                        if (/^https?:\/\//i.test(uri)) {
                            wrapper.href = uri;
                            wrapper.dataset.external = '';
                        }
                    }
                    const text = resolveValue(rawAttr(kid, 'Text'), ctx);
                    if (text) wrapper.textContent = text;
                    else walk(kid, wrapper);
                    into.appendChild(wrapper);
                    return;
                }
                walk(kid, into);
            });
        };

        const direct = resolveValue(rawAttr(node, 'Text'), ctx);
        if (direct) {
            fragment.appendChild(doc.createTextNode(direct));
            return fragment;
        }

        const own = String(node.text || '').trim();
        if (own) fragment.appendChild(doc.createTextNode(replaceMarkers(own)));
        walk(node, fragment);
        return fragment;
    }

    /** TextBlock 的纯文本版本（给 tooltip、列表项之类的地方用）。 */
    function plainText(node, ctx) {
        const direct = resolveValue(rawAttr(node, 'Text'), ctx);
        if (direct) return direct;
        let out = String(node.text || '').trim();
        node.kids.forEach((kid) => {
            const text = resolveValue(rawAttr(kid, 'Text'), ctx);
            if (text) out += text;
            else if (String(kid.name).toLowerCase() !== 'linebreak') out += plainText(kid, ctx);
        });
        return out;
    }

    SL.xaml = {
        parse,
        normalizeSource,
        rawAttr,
        hasAttr,
        kidsNamed,
        firstKid,
        value,
        boolAttr,
        numAttr,
        thickness,
        toCssColor,
        brandColor,
        resolveValue,
        replaceMarkers,
        inlineFragment,
        plainText
    };
})(window);
