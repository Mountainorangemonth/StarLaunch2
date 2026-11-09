# StarLaunch

> 用 Web 技术写界面、用 WPF + WebView2 做外壳的 Minecraft 启动器原型。  
> 整套 Material You 配色由 [Material Color Utilities](https://github.com/material-foundation/material-color-utilities) 在本地实时计算，不依赖任何在线主题服务。

![启动页（浅色）](WebAssets/preview/home-light.png)

## 目录

- [特性](#特性)
- [界面预览](#界面预览)
- [技术栈](#技术栈)
- [整体架构](#整体架构)
- [Material You 配色](#material-you-配色)
- [目录结构](#目录结构)
- [构建与运行](#构建与运行)
- [调试与预览](#调试与预览)
- [常见问题](#常见问题)
- [当前限制](#当前限制)
- [许可证与致谢](#许可证与致谢)

## 特性

- **四个页面**：启动、版本、下载、设置，全部离线可用。
- **Material You 动态配色**：源色 → HCT → M3 Scheme → CSS 变量，切换源色/变体/明暗/对比度即时生效。
- **从壁纸取色**：选择或拖入一张图片，自动压缩、量化、打分选出源色，并按壁纸亮度推算遮罩。
- **琉璃式材质**：玻璃层只挂在最外层，浮层保持不透明，避免“玻璃叠玻璃”。
- **启动器外壳**：无边框自定义标题栏、拖拽区、最小化/最大化/关闭桥接，最小化时暂停 WebView2。
- **零前端依赖**：HTML + CSS + 原生 JS，无框架、无打包步骤；UI 可以直接双击 `WebAssets/index.html` 预览。
- **网页资源内嵌**：HTML/CSS/JS 全部编进程序集，由宿主通过虚拟域名 `https://app.local/` 提供，不依赖外部文件目录。

## 界面预览

| 启动页（浅色） | 启动页（深色） |
| --- | --- |
| ![启动页浅色](WebAssets/preview/home-light.png) | ![启动页深色](WebAssets/preview/home-dark.png) |

| 版本页 | 下载页 |
| --- | --- |
| ![版本页](WebAssets/preview/versions-light.png) | ![下载页](WebAssets/preview/download-light.png) |

| 实例选择 | 启动进度 |
| --- | --- |
| ![实例选择](WebAssets/preview/instance-picker-dark.png) | ![启动进度](WebAssets/preview/launch-modal.png) |

| 设置页 | 壁纸取色 |
| --- | --- |
| ![设置页](WebAssets/preview/settings-light.png) | ![壁纸取色](WebAssets/preview/wallpaper-colors.png) |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 外壳 | .NET 10 / WPF（`net10.0-windows`） |
| 浏览器控件 | Microsoft.Web.WebView2 `1.0.4314.35` |
| 界面 | HTML5 + CSS + 原生 JavaScript（无框架、无构建） |
| 配色 | `@material/material-color-utilities` `0.4.0`（Apache-2.0） |
| 配色打包 | Node.js 脚本 `WebAssets/tools/build-mcu.mjs` |

## 整体架构

```
┌─────────────────────────── WPF 宿主进程 ───────────────────────────┐
│  MainWindow.xaml / MainWindow.xaml.cs                              │
│                                                                    │
│  ┌────────────────────────┐        https://app.local/*             │
│  │  WebView2 (Chromium)   │ ──────────────────────────┐             │
│  │  WebAssets 页面         │                           ▼             │
│  └────────────────────────┘                 WebResourceRequested    │
│            ▲                                从程序集读取嵌入资源     │
│            │ postMessage                    StarLaunch.WebAssets.*  │
│            │ { type: 'window-control' }                             │
│  ┌─────────┴──────────┐                                             │
│  │ 最小化 / 最大化 / 关闭 │                                             │
│  └────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 虚拟主机而不是 file://

宿主启动后导航到 `https://app.local/index.html`。这个域名在磁盘上并不存在，所有请求都由
`MainWindow.OnWebResourceRequested` 拦截：

| 请求路径 | 程序集资源名 |
| --- | --- |
| `/index.html` | `StarLaunch.WebAssets.index.html` |
| `/style.css` | `StarLaunch.WebAssets.style.css` |
| `/app.js` | `StarLaunch.WebAssets.app.js` |
| `/theme.js` | `StarLaunch.WebAssets.theme.js` |
| `/mcu.js` | `StarLaunch.WebAssets.mcu.js` |
| `/assets/wallpaper.png` | `StarLaunch.WebAssets.assets.wallpaper.png` |

映射规则：把请求路径的 `/` 换成 `.`，加上 `StarLaunch.WebAssets.` 前缀，再从程序集里取流。
找不到时返回 404，方便在页面里直接看到缺哪个文件。

**新增网页资源时必须同时加入 `StarLaunch.csproj`**，否则编译后的 exe 里没有它：

```xml
<EmbeddedResource Include="WebAssets\app.js">
  <LogicalName>StarLaunch.WebAssets.app.js</LogicalName>
</EmbeddedResource>
```

> 这是本项目最容易踩的坑：直接用浏览器打开 `index.html` 一切正常，但编译后如果漏嵌了
> 某个 `<script>` / `<link>` / 图片，宿主只会返回 404，对应功能会静默失效。
> `mcu.js` 和 `theme.js` 曾经就因为漏嵌，导致 exe 里主题引擎完全没有启动。

### 窗口桥接

网页标题栏按钮按顺序尝试：

1. `window.starLaunch.window.minimize()`（可选的原生 API 注入）；
2. `window.chrome.webview.postMessage({ type: 'window-control', action })`（WebView2）；
3. `CustomEvent('starlaunch:window-control')`（纯浏览器回退）。

宿主在 `OnWebMessageReceived` 里解析 `window-control` 消息并执行窗口操作。

### 宿主行为

- 无边框窗口（`WindowStyle="None"`），通过 `IsNonClientRegionSupportEnabled` + CSS
  `app-region: drag` 实现标题栏拖拽；
- 禁用默认右键菜单、DevTools 和浏览器快捷键（发布版更接近原生应用）；
- 最小化时调用 `TrySuspendAsync()` 暂停渲染与计时器，恢复时 `Resume()`；
- 用户数据目录放在 `%LOCALAPPDATA%\StarLaunch\WebView2`，避免安装在 `Program Files`
  等只读目录时启动失败；
- 资源响应带 `Cache-Control: no-store`，重新编译后不会读到缓存里的旧页面。

## Material You 配色

### 为什么用 Material Color Utilities

[Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
是 Google 的 Material 3 色彩库：输入一个源色，输出整套符合 M3 规范的颜色角色。
本项目用它替换“写死一套主题色”的做法：

- 换源色、换变体、切明暗、调对比度，所有界面颜色一起重新派生；
- 从壁纸取色时，用同一套算法把图片的主色变成可用的 M3 源色；
- 全部在本地计算，不请求网络，不需要预先准备多套色板。

### mcu.js 是怎么来的

官方产物是 ESM。为了让 `file://`、WebView2 和普通浏览器都能直接 `<script>` 引用，
`WebAssets/tools/build-mcu.mjs` 做了三件事：

1. 从 jsDelivr 下载 `@material/material-color-utilities@0.4.0/+esm` 的单文件 Rollup 产物；
2. 把文件末尾的 `export { a as B, ... }` 改写成 `window.MaterialColorUtilities = { B: a, ... }`；
3. 用 IIFE 包起来，生成 `WebAssets/mcu.js`（约 104 KB，离线可用）。

生成的文件头部保留了 Apache-2.0 版权声明。需要升级版本时：

```bash
node WebAssets/tools/build-mcu.mjs
```

然后同步更新 `WebAssets/index.html` 里“关于”页的版本文字。

### 配色管线

```
源色 #7c6ce6
  └─ MCU.argbFromHex → MCU.Hct.fromInt          进入 HCT 色彩空间
       └─ new SchemeTonalSpot(hct, isDark, contrast)
            └─ MaterialDynamicColors.<role>.getArgb(scheme)
                 └─ 35 个核心角色写入 CSS 变量
```

核心代码在 `WebAssets/theme.js`：

```js
const sourceHct = MCU.Hct.fromInt(MCU.argbFromHex(state.seed));
const scheme = schemeFor(sourceHct, isDark);      // 7 种 Scheme 之一
const roles = readRoles(scheme);                  // MaterialDynamicColors
root.style.setProperty('--m3-primary', roles.primary.hex);
```

`style.css` 里不出现硬编码颜色，只消费 `--m3-*`、`--brand`、`--glass-*` 等变量。

### 7 种色调变体

| id | 界面名称 | MCU Scheme |
| --- | --- | --- |
| `tonalSpot` | 柔和 | `SchemeTonalSpot` |
| `expressive` | 表现 | `SchemeExpressive` |
| `vibrant` | 鲜艳 | `SchemeVibrant` |
| `content` | 内容 | `SchemeContent` |
| `fidelity` | 保真 | `SchemeFidelity` |
| `neutral` | 中性 | `SchemeNeutral` |
| `monochrome` | 单色 | `SchemeMonochrome` |

对比度滑杆对应 Scheme 构造函数的第三个参数（`-1` 到 `1`）。此外还可以分别指定
强调色、选中项、主视觉使用 `primary` / `secondary` / `tertiary` 中的哪一档。

### 从壁纸取色

1. 图片先缩到最长边 1920px 并转 WebP，写入 `localStorage`（避免 4K 原图常驻解码缓存）；
2. 用 Canvas 读取像素，交给 `MCU.QuantizerCelebi.quantize(pixels, 64)` 量化成 64 色；
3. 用 `MCU.Score.score(...)` 打分，选出最有代表性的颜色作为新的源色；
4. 同时按 sRGB 相对亮度估算整张图的明暗，给壁纸遮罩一个下限，亮色壁纸也不会糊字。

如果 Canvas 因跨源限制拿不到像素，取色会失败并保留当前源色，壁纸本身仍然正常显示。

### 材质规则

从参考主题移植过来的三条硬规则（详见 `WebAssets/README.md`）：

1. **唯一材质源**：玻璃层只用 `--glass` + `--glass-blur`，不写死 `rgba()` 数值；
2. **玻璃只挂在最外层**：导航、面板、卡片才有 `backdrop-filter`，内部列表行一律透明；
3. **浮层必须不透明**：菜单、对话框、Toast 用面层级容器，避免正文从半透明菜单后透出来。

设置里的“性能模式”会一次性关闭模糊、泛光和背景动画，并改用不透明底色。

## 目录结构

```
StarLaunch/
├─ App.xaml / App.xaml.cs          # WPF 应用入口
├─ MainWindow.xaml                 # 无边框窗口 + 单个 WebView2
├─ MainWindow.xaml.cs              # 虚拟主机、资源映射、窗口消息、挂起/恢复
├─ StarLaunch.csproj               # net10.0-windows + WebView2 + 嵌入资源
├─ StarLaunch.slnx                 # 解决方案文件
├─ LICENSE.txt                     # Apache-2.0
├─ WebAssets/                      # 界面层（全部离线）
│  ├─ index.html                   # 页面结构、内联 SVG 图标、四个视图
│  ├─ style.css                    # 设计令牌、材质层、响应式布局
│  ├─ app.js                       # 路由、实例、下载队列、启动进度、设置
│  ├─ theme.js                     # 配色引擎：M3 角色、壁纸取色、CSS 变量
│  ├─ mcu.js                       # Material Color Utilities 经典脚本（勿手改）
│  ├─ assets/                      # 默认壁纸等静态资源（嵌入 exe）
│  ├─ preview/                     # README 截图（不嵌入）
│  ├─ tools/build-mcu.mjs          # 重新生成 mcu.js
│  └─ README.md                    # 界面层深入说明
└─ bin/ obj/                       # 构建产物
```

## 当前限制

这是一个**界面原型**，还没有接入真正的启动核心：

- 实例列表、下载数据是 `app.js` 里的静态数据，尚未从宿主 IPC 拉取；
- 下载进度、启动进度与日志是模拟动画，不会真的下载或启动 Minecraft；
- 账户、皮肤、Java 检测、版本清单等仍是界面占位；
- 窗口固定大小，未实现多显示器/缩放适配；
- 无自动更新、无代码签名。

后续接入真实启动逻辑时，把 `INSTANCES` / `DOWNLOADS` 换成宿主 IPC 数据，
并保留现有的事件与渲染函数即可。

## 许可证与致谢

- 本项目基于 [Apache License 2.0](LICENSE.txt) 发布。
- 配色库：[material-color-utilities](https://github.com/material-foundation/material-color-utilities)
  （Apache-2.0，Copyright 2021 Google LLC），`mcu.js` 头部保留原始版权声明。
- 视觉语言参考：[qqnt-liuli-theme](https://github.com/LilycleHeart/qqnt-liuli-theme) 的「琉璃」风格，
  并按 Material Design 3 规范重写。
- 图标为内联 SVG，字体使用系统字体，界面不依赖任何外部 CDN。

更细的界面层说明（材质规则、数据位置、已知取舍）见 [`WebAssets/README.md`](WebAssets/README.md)。
