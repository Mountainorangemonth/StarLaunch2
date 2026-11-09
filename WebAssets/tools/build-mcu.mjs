/**
 * 把 @material/material-color-utilities 打包成可直接 <script> 引用的经典脚本。
 *
 * 为什么不用 ESM：WebView2 以 file:// 加载页面时，浏览器会因为 CORS 拒绝
 * <script type="module">，启动器会白屏。这里把 jsDelivr 已经打好的 Rollup
 * 产物（单文件、无顶层 import）的尾部 `export{a as B,...}` 改写成
 * `window.MaterialColorUtilities = {B: a, ...}`，再用 IIFE 包起来。
 *
 * 用法：node tools/build-mcu.mjs
 * 产物：mcu.js（离线可用，无需联网）
 */
import { writeFileSync } from 'node:fs';

const VERSION = '0.4.0';
const SOURCE_URL = `https://cdn.jsdelivr.net/npm/@material/material-color-utilities@${VERSION}/+esm`;

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`下载失败：${res.status} ${SOURCE_URL}`);
let src = await res.text();

if (/^\s*import\s/m.test(src)) throw new Error('产物里出现了顶层 import，需要换一种打包方式');
const exportMatch = src.match(/export\s*\{([^}]*)\};?\s*(?:\/\/# sourceMappingURL=.*)?\s*$/);
if (!exportMatch) throw new Error('没有找到尾部的 export 语句');

const entries = exportMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
        const m = part.match(/^(\S+)\s+as\s+(\S+)$/);
        const local = m ? m[1] : part;
        const exported = m ? m[2] : part;
        return `${JSON.stringify(exported)}: ${local}`;
    });

const body = src.slice(0, exportMatch.index).replace(/\/\/# sourceMappingURL=.*$/m, '');
const out = `/*!
 * Material Color Utilities v${VERSION} — Apache-2.0, Copyright 2021 Google LLC
 * 由 tools/build-mcu.mjs 从 ${SOURCE_URL} 生成，请勿手改。
 * 经典脚本版本：暴露 window.MaterialColorUtilities，file:// 下可直接使用。
 */
(function (global) {
'use strict';
${body}
global.MaterialColorUtilities = {
${entries.map((line) => '    ' + line).join(',\n')}
};
})(typeof window !== 'undefined' ? window : globalThis);
`;
writeFileSync(new URL('../mcu.js', import.meta.url), out);
console.log('已生成 mcu.js：', out.length, 'bytes，导出', entries.length, '项');
