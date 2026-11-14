/* =====================================================================
   StarLaunch · 下拉框
   ---------------------------------------------------------------------
   原生 <select> 的弹出列表由浏览器自己画：底色、圆角、阴影、字号都不受
   CSS 控制，放在玻璃面板和深色模式里像是从别的年份贴过来的。

   这里的做法是「保留数据、换掉外观」：
     · <select> 原样留在 DOM 里当数据源，value / change / disabled 全都照旧，
       其它模块一行代码都不用改；
     · 外观换成自绘的玻璃触发器（.sl-select-trigger）和浮层列表（.sl-menu），
       浮层复用 .inst-pop 那套浮材质，和主页的实例选择器、确认框同一个手感。

   与原生下拉的差别只在「长什么样、怎么点开」，语义上仍然是同一个 select：
   select.value = x 会同步文字，动态重建 <option> 也会同步（MutationObserver）。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;
    const { $$, escapeHtml } = SL.core;

    const MENU_ID = 'slSelectMenu';
    const MIN_MENU_WIDTH = 168;
    const VIEWPORT_PAD = 8;

    /** select -> { wrap, trigger, valueEl } */
    const metas = new WeakMap();
    /** 当前打开的浮层：{ select, trigger, wrap, index } */
    let open = null;
    let menu = null;
    let placeFrame = 0;

    /* -----------------------------------------------------------------
       取值
       ----------------------------------------------------------------- */
    function optionList(select) {
        return Array.prototype.slice.call(select.options);
    }

    function currentLabel(select) {
        const option = select.options[select.selectedIndex] || select.options[0];
        return option ? String(option.textContent || '').trim() : '';
    }

    function currentIndex(select) {
        return select.selectedIndex >= 0 ? select.selectedIndex : 0;
    }

    /* -----------------------------------------------------------------
       浮层
       -----------------------------------------------------------------
       全局只建一个节点，开合时只换内容、换位置：既不反复造 DOM，
       也不会在滚动容器里被裁掉（position: fixed + 每次重算位置）。
       ----------------------------------------------------------------- */
    function ensureMenu() {
        if (menu) return menu;

        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'sl-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'listbox');

        // 点选项的时候别把焦点从触发器上抢走，键盘和鼠标才能共用一套状态
        menu.addEventListener('pointerdown', (event) => event.preventDefault());
        menu.addEventListener('click', (event) => {
            const option = event.target.closest('.sl-option');
            if (!option || !open) return;
            pick(Number(option.dataset.index));
        });

        document.body.appendChild(menu);
        return menu;
    }

    function paintMenu() {
        if (!open) return;
        const items = optionList(open.select);
        menu.innerHTML = items.map((option, index) => {
            const active = index === open.select.selectedIndex;
            return '<button type="button" class="sl-option' + (active ? ' is-selected' : '') + '"' +
                ' role="option" aria-selected="' + active + '" data-index="' + index + '"' +
                (option.disabled ? ' disabled' : '') + '>' +
                '<span class="sl-option-label">' + escapeHtml(String(option.textContent || '').trim()) + '</span>' +
                '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' +
                '</button>';
        }).join('');
    }

    /** 贴着触发器放：默认向下，下面放不下就翻到上面，左右不越界。 */
    function place() {
        if (!open || !menu) return;
        const box = open.trigger.getBoundingClientRect();
        if (!box.width && !box.height) return;

        const width = Math.max(box.width, MIN_MENU_WIDTH);
        menu.style.width = width + 'px';

        const height = menu.offsetHeight;
        const gap = 6;
        const roomBelow = window.innerHeight - box.bottom - VIEWPORT_PAD;
        const roomAbove = box.top - VIEWPORT_PAD;
        const up = height > roomBelow && roomAbove > roomBelow;
        const maxWidth = Math.max(MIN_MENU_WIDTH, window.innerWidth - VIEWPORT_PAD * 2);
        const left = Math.min(Math.max(VIEWPORT_PAD, box.left), VIEWPORT_PAD + maxWidth - width);

        menu.classList.toggle('is-up', up);
        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(up ? Math.max(VIEWPORT_PAD, box.top - height - gap) : box.bottom + gap) + 'px';
    }

    function schedulePlace() {
        if (placeFrame) return;
        placeFrame = global.requestAnimationFrame(() => {
            placeFrame = 0;
            place();
        });
    }

    /* -----------------------------------------------------------------
       开 / 关 / 选
       ----------------------------------------------------------------- */
    function openFor(select, startIndex) {
        const meta = metas.get(select);
        if (!meta || select.disabled) return;
        if (open && open.select === select) return;

        close();
        if (!select.options.length) return;

        ensureMenu();
        menu.setAttribute('aria-labelledby', meta.trigger.id);
        open = { select, trigger: meta.trigger, wrap: meta.wrap, index: currentIndex(select) };
        paintMenu();
        menu.hidden = false;
        menu.style.width = Math.max(meta.trigger.getBoundingClientRect().width, MIN_MENU_WIDTH) + 'px';
        menu.style.left = '0px';
        menu.style.top = '0px';

        meta.wrap.classList.add('is-open');
        meta.trigger.setAttribute('aria-expanded', 'true');

        place();
        highlight(startIndex == null ? currentIndex(select) : startIndex, true);
    }

    function close() {
        if (!open) return;
        const meta = metas.get(open.select);
        if (meta) {
            meta.wrap.classList.remove('is-open');
            meta.trigger.setAttribute('aria-expanded', 'false');
        }
        if (menu) {
            menu.hidden = true;
            menu.innerHTML = '';
            menu.classList.remove('is-up');
        }
        open = null;
    }

    /** 高亮某一项：只挪 class 和滚动位置，不动焦点。 */
    function highlight(index, quiet) {
        if (!open || !menu) return;
        const items = $$('.sl-option', menu);
        if (!items.length) return;

        const total = items.length;
        const next = ((index % total) + total) % total;
        open.index = next;
        items.forEach((item, i) => item.classList.toggle('is-active', i === next));

        if (quiet) return;
        const item = items[next];
        const top = item.offsetTop;
        const bottom = top + item.offsetHeight;
        if (top < menu.scrollTop) menu.scrollTop = top - 6;
        else if (bottom > menu.scrollTop + menu.clientHeight) {
            menu.scrollTop = bottom - menu.clientHeight + 6;
        }
    }

    function pick(index) {
        if (!open) return;
        const trigger = open.trigger;
        apply(open.select, index);
        close();
        if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    }

    /** 写 value + 派发 change，和用户点原生列表时完全一样。 */
    function apply(select, index) {
        const items = optionList(select);
        if (index < 0 || index >= items.length || items[index].disabled) return false;
        if (select.selectedIndex === index) return true;
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh(select);
        return true;
    }

    /* 打字搜索：和原生下拉一致，连打的字母会拼成一个词 */
    let typed = '';
    let typedAt = 0;

    function typeAhead(char, select, isOpen) {
        const now = Date.now();
        typed = now - typedAt > 700 ? char : typed + char;
        typedAt = now;

        const items = optionList(select);
        if (!items.length) return false;
        const needle = typed.toLowerCase();
        const start = isOpen ? open.index : currentIndex(select);

        for (let step = 1; step <= items.length; step += 1) {
            const index = (start + step) % items.length;
            const text = String(items[index].textContent || '').trim().toLowerCase();
            if (items[index].disabled || text.indexOf(needle) === -1) continue;
            if (isOpen) highlight(index);
            else apply(select, index);
            return true;
        }
        return false;
    }

    /* -----------------------------------------------------------------
       键盘
       -----------------------------------------------------------------
       焦点始终留在触发器上（浮层只是画出来的层），所以：
         · 收起时 ↓ / ↑ / 回车 / 空格 打开；
         · 展开时 ↑↓ 换行、Home/End 到头尾、回车选中、Esc 关掉、Tab 直接走掉；
         · 打字按前缀跳转（收起时直接选中，展开时只挪高亮）。
       ----------------------------------------------------------------- */
    function onKeydown(event, select) {
        const isOpen = open && open.select === select;
        const key = event.key;

        if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (typeAhead(key, select, isOpen)) event.preventDefault();
            return;
        }

        if (!isOpen) {
            if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ' || key === 'Spacebar') {
                event.preventDefault();
                const last = optionList(select).length - 1;
                openFor(select, key === 'ArrowUp' ? last : currentIndex(select));
            }
            return;
        }

        if (key === 'ArrowDown') {
            event.preventDefault();
            highlight(open.index + 1);
        } else if (key === 'ArrowUp') {
            event.preventDefault();
            highlight(open.index - 1);
        } else if (key === 'Home') {
            event.preventDefault();
            highlight(0);
        } else if (key === 'End') {
            event.preventDefault();
            highlight(optionList(select).length - 1);
        } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
            event.preventDefault();
            pick(open.index);
        } else if (key === 'Escape') {
            // 页面的 Esc 是关浮层的，这里先自己吃掉，免得顺带关掉别的东西
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (key === 'Tab') {
            close();
        }
    }

    /* -----------------------------------------------------------------
       同步
       ----------------------------------------------------------------- */
    /** 把 select 的当前值写到触发器上；disabled 也跟着走。 */
    function refresh(select) {
        const meta = metas.get(select);
        if (!meta) return;
        const label = currentLabel(select);
        if (meta.valueEl.textContent !== label) meta.valueEl.textContent = label;
        meta.trigger.title = label;
        const disabled = Boolean(select.disabled);
        if (meta.trigger.disabled !== disabled) meta.trigger.disabled = disabled;
        // 选项被整体换掉时列表可能是旧内容了，干脆收掉，下次点开重新画
        if (open && open.select === select) close();
    }

    function enhance(select) {
        if (!select || select.nodeType !== 1) return;
        if (metas.has(select)) return;
        // 多选 / 列表框保持原生：它们的交互不是「选一个」
        if (select.multiple || select.size > 1) return;

        const wrap = document.createElement('span');
        wrap.className = 'sl-select';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'sl-select-trigger';
        trigger.id = (select.id || 'slSelect') + 'Trigger';
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', MENU_ID);
        const name = select.getAttribute('aria-label');
        if (name) trigger.setAttribute('aria-label', name);
        trigger.innerHTML = '<span class="sl-select-value"></span>' +
            '<svg class="icon sl-select-caret" aria-hidden="true"><use href="#i-chevron-down"/></svg>';

        wrap.appendChild(trigger);

        const meta = { wrap, trigger, valueEl: trigger.firstElementChild };
        metas.set(select, meta);
        select.dataset.slSelect = '1';

        // 原来的 <label> 是隐式关联 select 的，现在真正的控件是按钮，改绑到按钮上，
        // 点「版本隔离」「来源」这些文字也能打开列表。
        const label = select.closest('label');
        if (label && !label.hasAttribute('for')) label.htmlFor = trigger.id;

        // select.value = x 由代理透传，顺手刷新文字（设置页回填、切换文件夹都走这条路）
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        if (descriptor && descriptor.get && descriptor.set) {
            Object.defineProperty(select, 'value', {
                configurable: true,
                get() { return descriptor.get.call(this); },
                set(value) {
                    descriptor.set.call(this, value);
                    refresh(this);
                }
            });
        }

        // 选项被重建（下载页切分类会重写 innerHTML）或 disabled 变化时跟进
        const observer = new MutationObserver(() => refresh(select));
        observer.observe(select, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ['disabled']
        });

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (open && open.select === select) close();
            else openFor(select);
        });
        trigger.addEventListener('keydown', (event) => onKeydown(event, select));

        refresh(select);
    }

    /* -----------------------------------------------------------------
       入口
       ----------------------------------------------------------------- */
    function bindSelects(root) {
        $$('select', root).forEach(enhance);
    }

    /** 换页 / 开场动画前后，浮层位置要重新算一遍 */
    function reposition() {
        if (open) schedulePlace();
    }

    function bindGlobal() {
        // 点别处就收起；点触发器本身交给 click 做开合，避免关了又开
        document.addEventListener('pointerdown', (event) => {
            if (!open) return;
            if (menu && menu.contains(event.target)) return;
            if (open.trigger.contains(event.target)) return;
            if (open.wrap.contains(event.target)) return;
            close();
        }, true);

        // 面板、页面滚动时跟着走；滚出可视区就收掉
        document.addEventListener('scroll', () => {
            if (!open) return;
            const box = open.trigger.getBoundingClientRect();
            if (box.bottom < 0 || box.top > window.innerHeight) close();
            else schedulePlace();
        }, true);

        window.addEventListener('resize', reposition);
        window.addEventListener('blur', close);
    }

    bindGlobal();

    SL.select = Object.assign(SL.select || {}, {
        bindSelects, enhance, refresh, reposition, open: openFor, close
    });
})(window);
