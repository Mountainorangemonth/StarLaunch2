/* =====================================================================
   StarLaunch · 主页时钟与问候
   ---------------------------------------------------------------------
   整分对齐调度 + 竖向滚轮数字。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    const { $, pad2 } = SL.core;

    /* -----------------------------------------------------------------
       时间 / 问候
       ----------------------------------------------------------------- */
    const WEEK_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const LAST_LOGIN_KEY = 'starlaunch.lastLogin.v1';

    // 上一次真正渲染出来的「分钟」（epoch 分钟数）。用它判断时间有没有变，
    // 而不是无条件重写 DOM —— 回调被多触发几次也不会闪。
    let clockMinute = -1;
    let clockTimer = 0;

    /**
     * 把系统时间渲染到主页。
     * 每次都以 new Date() 为唯一真相，不累加、不缓存时间差，所以定时器被节流、
     * 被系统挂起、或者秒数漂移都不会让显示和系统时间跑偏。
     * @param {boolean} [force] 忽略「同一分钟」的短路，强制重画（回前台 / 唤醒时用）
     * @param {boolean} [animate] 传 false 时不做跳变动画（首帧渲染用，避免和入场动画叠在一起）
     */
    function tickClock(force, animate) {
        const now = new Date();
        const minuteKey = Math.floor(now.getTime() / 60000);
        if (!force && minuteKey === clockMinute) return;
        clockMinute = minuteKey;

        const dateEl = $('#heroDate');
        const greetEl = $('#heroGreeting');

        const dateText = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 ' + WEEK_LABEL[now.getDay()];
        if (dateEl && dateEl.textContent !== dateText) dateEl.textContent = dateText;

        paintClock(now, animate);

        if (greetEl) {
            const h = now.getHours();
            const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
            if (greetEl.textContent !== greet) greetEl.textContent = greet;
        }
    }

    /* -----------------------------------------------------------------
       滚轮时钟：每位数字一条竖向滚轮
       -----------------------------------------------------------------
       每位 = .reel（可视窗，overflow: hidden）+ .reel-track（0-9 排两圈）。
       跳变时把 track 往上推 n × 5%（20 个数字 → 每个 5%），所以 9→0 也是
       往前滚一格，而不是倒着跳回去。滚动结束后悄悄回退一整圈，眼睛看不出。
       全程只改 transform，走合成层，不触发布局和重绘。 */

    const REEL_ROWS = 20;            // 0-9 排两圈
    const REEL_STEP = 100 / REEL_ROWS;
    const REEL_ROLL_MS = 620;
    let clockReels = null;
    let clockText = '';

    function buildClockReels(el) {
        if (clockReels || !el) return;
        el.textContent = '';
        const reels = [];
        ['h', 'h', ':', 'm', 'm'].forEach((slot) => {
            if (slot === ':') {
                const colon = document.createElement('span');
                colon.className = 'colon';
                colon.textContent = ':';
                colon.setAttribute('aria-hidden', 'true');
                el.appendChild(colon);
                return;
            }
            const reel = document.createElement('span');
            reel.className = 'reel';
            reel.setAttribute('aria-hidden', 'true');
            const track = document.createElement('span');
            track.className = 'reel-track';
            for (let i = 0; i < REEL_ROWS; i++) {
                const face = document.createElement('i');
                face.textContent = String(i % 10);
                track.appendChild(face);
            }
            reel.appendChild(track);
            el.appendChild(reel);
            reels.push({ track, index: 0 });
        });
        clockReels = reels;
    }

    /** 只移动变化的那几位；animate=false 时直接定位，不走过渡。 */
    function setReel(reel, digit, animate) {
        const delta = (digit - (reel.index % 10) + 10) % 10;
        const next = reel.index + delta;
        reel.index = next;
        moveReel(reel, next, animate);
        if (next < 10) return;
        // 滚到第二圈了：等动画收尾后回退一整圈（两圈内容一样，视觉无差别）
        window.setTimeout(() => {
            if (reel.index !== next) return; // 期间又变了，交给下一轮处理
            reel.index = next - 10;
            moveReel(reel, reel.index, false);
        }, REEL_ROLL_MS + 40);
    }

    function moveReel(reel, position, animate) {
        const track = reel.track;
        if (animate === false) track.classList.add('is-instant');
        track.style.transform = 'translate3d(0, ' + (-position * REEL_STEP) + '%, 0)';
        if (animate === false) {
            void track.offsetHeight; // 强制重排，让「瞬间定位」立刻生效
            track.classList.remove('is-instant');
        }
    }

    function paintClock(now, animate) {
        const el = $('#heroClock');
        if (!el) return;
        buildClockReels(el);
        const text = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        if (text === clockText) return;
        clockText = text;
        const digits = [text.charAt(0), text.charAt(1), text.charAt(3), text.charAt(4)];
        digits.forEach((digit, index) => {
            if (clockReels[index]) setReel(clockReels[index], Number(digit), animate);
        });
        // 滚轮本身对读屏软件无意义，整块给一个可读的文本标签
        el.setAttribute('aria-label', text);
        el.setAttribute('title', text);
    }

    /**
     * 把下一次刷新精确安排在下一分钟的整点上。
     * delay = 60000 - 当前时间在本分钟内的偏移 + 30ms 余量，
     * 余量用来吸收定时器精度和渲染耗时，保证醒来那一刻已经跨过整分。
     * 每次都重新对时而不是 setTimeout(f, 60000) 循环，因此不会累积漂移。
     */
    function scheduleClock() {
        window.clearTimeout(clockTimer);
        const delay = 60000 - (Date.now() % 60000) + 30;
        clockTimer = window.setTimeout(pumpClock, delay);
    }

    /** 定时器到点：只有真的进入新的一分钟才重画，然后重新对齐下一分钟。 */
    function pumpClock() {
        if (Math.floor(Date.now() / 60000) !== clockMinute) tickClock();
        scheduleClock();
    }

    function startClock() {
        tickClock(true, false); // 首帧直接显示，不播跳变动画
        scheduleClock();
    }

    /** 从睡眠 / 最小化 / 切后台回来时立刻纠正，不等下一个整分。 */
    function resyncClock() {
        clockMinute = -1;
        tickClock(true);
        scheduleClock();
    }

    /**
     * 「上次登录」不是实时数据，只在启动时渲染一次：
     * 显示上一次启动的时间，然后把本次启动时间写回存储供下次使用。
     */
    function renderLastLogin() {
        const el = $('#acctLast');
        if (!el) return;
        let last = 0;
        try { last = Number(window.localStorage.getItem(LAST_LOGIN_KEY)) || 0; } catch (e) { last = 0; }
        el.textContent = formatLoginTime(last || Date.now());
        try { window.localStorage.setItem(LAST_LOGIN_KEY, String(Date.now())); } catch (e) { /* 隐私模式忽略 */ }
    }

    function formatLoginTime(ts) {
        const date = new Date(ts);
        const hm = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
        const now = new Date();
        const stamp = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        const day = stamp(date);
        if (day === stamp(now)) return '今天 ' + hm;
        if (day === stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return '昨天 ' + hm;
        return (date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + hm;
    }


    /* 事件绑定 */
    function bindClock() {
        /* 时钟：对齐到整分钟，并在回前台 / 唤醒后自动纠偏 */
        startClock();
        renderLastLogin();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) resyncClock();
        });
        window.addEventListener('focus', resyncClock);
        window.addEventListener('pageshow', resyncClock);
    }

    SL.clock = Object.assign(SL.clock || {}, { WEEK_LABEL, LAST_LOGIN_KEY, REEL_ROWS, REEL_STEP, REEL_ROLL_MS, tickClock, buildClockReels, setReel, moveReel, paintClock, scheduleClock, pumpClock, startClock, resyncClock, renderLastLogin, formatLoginTime, bindClock });
})(window);
