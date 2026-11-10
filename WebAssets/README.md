# StarLaunch · WebAssets

Minecraft 启动器（WebView2 宿主）的界面层。**Material You 动态配色**由
[Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
在本地实时计算，材质语言参照 [qqnt-liuli-theme](https://github.com/LilycleHeart/qqnt-liuli-theme)
的「琉璃」风格重写。

包含启动 / 版本 / 下载 / 设置四个页面，全部离线可用。

![启动页（浅色）](preview/home-light.png)

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构、内联 SVG 图标、四个视图 |
| `style.css` | 设计令牌、材质层、响应式布局（保留 `.custom-titlebar` 拖拽规则） |
| `theme.js` | 配色引擎：源色 → M3 色板 → CSS 变量，壁纸库轮播与取色缓存 |
| `app.js` | 路由、时钟、实例切换、下载队列、设置项、启动进度 |
| `mcu.js` | Material Color Utilities 0.4.0 的经典脚本打包（勿手改，见下） |
| `tools/build-mcu.mjs` | 重新生成 `mcu.js` |
| `preview/` | 各页面实机截图 |

## 配色是怎么来的

打开页面时 `theme.js` 会做一次完整的 M3 派生：

```
源色 #7c6ce6
  → Hct.fromInt              换到 HCT 色彩空间（色相 / 彩度 / 色调）
  → SchemeTonalSpot(light|dark, contrast)
  → 56 个 MaterialDynamicColors 角色
  → 写入 --m3-* / --brand / --glass-* 等 CSS 变量
```

界面里所有颜色都读变量，`style.css` 中**没有任何硬编码色值**，
换源色 / 换变体 / 切明暗时不需要改样式表。

### 7 种色调变体

设置页可以切换 `tonalSpot`（柔和）、`expressive`（表现）、`vibrant`（鲜艳）、
`content`（内容）、`fidelity`（保真）、`neutral`（中性）、`monochrome`（单色），
都直接对应 MCU 的 `Scheme*` 实现。

### 三个颜色角色

强调色、选中项、主视觉可以各自指定用 `primary` / `secondary` / `tertiary`，
和参考主题的「颜色角色」设置同构。对比度滑杆对应 MCU 构造函数的第三个参数
（`-1` 到 `1`，M3 的对比度级别）。

![设置页](preview/settings-light.png)

## 壁纸库与轮播

壁纸不再从网页里选文件或拖放，而是由宿主扫描一个独立文件夹：

```
<exe 所在目录>\wallpapers
```

如果该目录不可写（例如装在 Program Files），宿主自动退回
`%LOCALAPPDATA%\StarLaunch\wallpapers`。设置页的「打开文件夹」会打开实际使用的目录。

宿主启动后按需扫描该目录，并通过 `/wallpapers/manifest.json` 返回图片清单。
前端拿到清单后：

1. 先预加载目标图片再切换，避免换图时白闪；
2. 用 MCU 的 `QuantizerCelebi` 把像素量化成 64 色，再用 `Score` 打分选源色
   —— **不是平均色**，平均色会把鲜艳的图算成一坨灰；
3. 取色结果按图片 URL 缓存在内存里，随机轮播回到同一张时不重复计算；
4. 自动切换支持「随机 / 顺序」，间隔可选 1 / 5 / 10 / 30 分钟；
   窗口切到后台时暂停，回到前台后按剩余时间继续；
5. 换图使用双图层交叉淡入（700ms），手动选择和自动轮播走同一条路径。

图片不再转成 dataURL 写进 `localStorage`，避免大图常驻内存和反复序列化。
设置页的「打开文件夹」「重新扫描」分别对应宿主消息和重新拉取 manifest。

![壁纸取色](preview/wallpaper-colors.png)

## 材质规则

从参考主题移植过来的三条硬规则，缺一条观感就会崩：

1. **唯一材质源**：所有玻璃层都从 `--glass-rgb` / `--glass-a` 派生
   （`--glass`、`--glass-strong`、`--glass-weak`），不写死 `rgba()` 数值；
   因此「材质不透明度」滑杆会同时作用于导航、面板、设置块和列表卡片。
2. **模糊只挂在最外层**：导航栏和浮层保留 `backdrop-filter`；
   大块面板改用半透明底色，减少多个大面积图层同时合成导致的卡顿。
   面板内部的列表行、mini 卡片一律 `transparent`，避免「玻璃叠玻璃」。
3. **中间容器全部打透**，让壁纸和氛围光透出来。

例外是**浮层**（菜单、弹窗、toast）：它们必须不透明。
半透明菜单后面透出列表文字时，实测对比度仍有 1.14:1，logo 和标题会隐约浮在菜单上，
看起来像没擦干净。这里按 Material 3 规范处理 —— menu / dialog 用面层级容器，
只有承载层才是「有模糊的半透明」。

## 宿主桥接

标题栏继续沿用 `.custom-titlebar`（整条 `app-region: drag`，按钮 `no-drag`），
点最小化 / 最大化 / 关闭时按顺序尝试：

```js
window.starLaunch.window.minimize()                       // 1. 注入的宿主 API
window.chrome.webview.postMessage({ type: 'window-control', action })  // 2. WebView2
new CustomEvent('starlaunch:window-control', { detail: { action } })   // 3. DOM 事件
```

`MainWindow.xaml.cs` 已开启 `IsNonClientRegionSupportEnabled`，监听 `window-control`
消息，并额外处理 `open-wallpapers`（打开壁纸目录）。网页端不用改就能用。

## 关于 mcu.js

`mcu.js` 不是手写的，是 `tools/build-mcu.mjs` 从 jsDelivr 的 Rollup 产物改写的：

**为什么不用 `<script type="module">`**：直接用浏览器打开 `index.html` 时是 `file://`，
ESM 会被 CORS 拦下来，界面直接白屏。所以把它转成经典脚本，
挂在 `window.MaterialColorUtilities` 上。

需要升级版本时：

```bash
node tools/build-mcu.mjs
```

脚本会下载、改写尾部 `export {…}`、套一层 IIFE 并写出 `mcu.js`。
文件里保留了 Apache-2.0 许可头和来源地址。

## 性能

- 大块面板不再实时 `backdrop-filter`，改用更实的半透明底色；
  只有导航栏和最外层浮层保留模糊，减少同时合成的大面积图层；
- 移除了全屏遮罩层和噪点层，切换页面时不再整屏重绘；
- 滑杆输入合并到 `requestAnimationFrame`，且玻璃 / 模糊 / 泛光只更新材质变量，
  不重算 56 个 M3 颜色角色；松手时才写一次 `localStorage`；
- 色板条、源色圆点、变体 chip 只在源色 / 变体 / 明暗 / 角色变化时重建；
- 壁纸取色结果按 URL 缓存，轮播前预加载下一张，换图用双图层交叉淡入；
- 切换页面时主要区块按 DOM 顺序以 40ms 递增延迟浮入，单个动画 460ms；
- 「设置 → 性能模式」一次性关掉模糊、泛光和背景动画，并改用不透明底色；
- 窗口切到后台时 `.is-idle` 暂停装饰动画，壁纸轮播也暂停；
- 遵循 `prefers-reduced-motion`。

## 数据位置

- `app.js` 的 `INSTANCES`：主页实例浮层、版本列表、详情面板的唯一数据源；
- `app.js` 的 `DOWNLOADS`：下载中心全部分类；
- 外观设置 `starlaunch.theme.v4`，界面偏好 `starlaunch.ui.v3`，
  启动参数 `starlaunch.launch.v3`；
- 壁纸只在宿主的 `wallpapers` 目录中（exe 同级，不可写时退回
  `%LOCALAPPDATA%\StarLaunch\wallpapers`），网页端不保存图片数据，
  只保存当前图片名和轮播设置。

## 预览

| 浅色 | 深色 |
| --- | --- |
| ![浅色](preview/home-light.png) | ![深色](preview/home-dark.png) |

| 版本 | 下载 |
| --- | --- |
| ![版本](preview/versions-light.png) | ![下载](preview/download-light.png) |

![实例浮层](preview/instance-picker-dark.png)
![启动进度](preview/launch-modal.png)

## 已知取舍

- 壁纸取色依赖 Canvas `getImageData`。宿主用 `https://app.local` 提供图片，
  正常情况同源可用；如果直接用浏览器打开 `index.html`，读不到 manifest，
  壁纸库会显示为空，背景回退到氛围光。
- 实例列表、下载数据目前是 `app.js` 里的静态数据，接宿主时替换成 IPC 拉取即可。
