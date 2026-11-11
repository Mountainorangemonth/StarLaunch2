/* =====================================================================
   StarLaunch · 核心工具
   ---------------------------------------------------------------------
   所有模块共用的地基：命名空间、DOM 选择器、localStorage 读写。

   模块约定
   --------
   每个文件是一个 IIFE，从 global.SL 上取用别人的东西，
   结束时把自己对外的东西挂到 SL.<模块名> 上：

       (function (global) {
           const SL = global.SL;
           const { $ } = SL.core;
           function foo() { ... }
           SL.foo = Object.assign(SL.foo || {}, { bar: foo });
       })(window);

   为什么不用 ESM：页面既要能在 WebView2 里跑，也要能直接双击 index.html
   打开（file:// 下 import 会被 CORS 拦掉，界面直接白屏）。
   加载顺序由 index.html 的 <script> 标签决定，见那里的注释。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL || (global.SL = {});

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const pad2 = (n) => String(n).padStart(2, '0');
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

    const STORE = {
        launchPrefs: 'starlaunch.launch.v3',
        uiPrefs: 'starlaunch.ui.v3',
        notice: 'starlaunch.notice.v1',
        noticeRead: 'starlaunch.notice.read.v1',
        launchLog: 'starlaunch.launchlog.v1'
    };

    function readStore(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? Object.assign({}, fallback, parsed) : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function readArray(key, fallback) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key));
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) { /* 本地存储不可用时静默 */ }
    }

    /**
     * 取一个模块对象。模块之间互相引用（ui ↔ launch ↔ router）时，
     * 直接解构会拿到 undefined —— 这里先把空壳建出来，各模块加载完再填内容。
     */
    const mod = (name) => SL[name] || (SL[name] = {});

    SL.core = Object.assign(SL.core || {}, { mod,
        $, $$, pad2, escapeHtml, STORE, readStore, readArray, writeStore
    });
})(window);
