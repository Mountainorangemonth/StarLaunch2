# StarLaunch · WebAssets

参考「Monica Launcher」的玻璃拟态风格重做的 Minecraft 启动器界面，包含主页 / 版本管理 / 下载中心 / 设置四个页面。

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构、内联 SVG 图标、四个视图 |
| `style.css` | 设计变量、玻璃卡片、响应式布局（保留原有 `.custom-titlebar` 拖拽规则） |
| `app.js` | 路由、时钟、实例切换、下载列表、设置项、启动进度与性能选项 |
| `assets/` | 壁纸目录 |

## 本次重点

- 修复点击任意位置都会弹出「主题色已切换」的问题（原因：`<html data-accent>` 也被误绑定了点击）；
- 版本管理改用内容高度布局，右下角按钮不再重叠；
- 公告卡改成紧凑的「缩略图 + 列表」，本机配置精简为 6 行；
- 实例选择浮层提高层级，稳定盖在公告卡之上；
- 头像移出导航胶囊，变成下方独立圆形按钮；
- 下载页从卡片网格改为列表，并在列表内显示安装中 / 已安装状态；
- 新增本周游戏时长、快捷操作、头像经验环、拖放换背景、性能模式。

## 换背景

**方式一（推荐，持久生效）**

1. 把背景图命名为 `wallpaper.png` 放进 `assets/`；
2. 重新生成项目即可。`StarLaunch.csproj` 已加入 `WebAssets\assets\**\*` 的嵌入规则，`MainWindow.xaml.cs` 也已支持 `png / jpg / webp / gif / svg` 的 Content-Type。

**方式二（即时预览，无需重新生成）**

- 「设置 → 外观 → 背景图 → 选择图片」；
- 也可以直接把图片拖进窗口，松开即可换背景。

选择本地图片时会先缩到最长边 2560px 再转 WebP，避免 4K 原图常驻解码缓存。找不到 `assets/wallpaper.png` 时会显示内置的 CSS 粉蓝天空作为兜底。

## 性能 / 内存

- 默认毛玻璃 18px，只在高层面板（卡片 / 导航 / 浮层）保留 `backdrop-filter`，移除了按钮、搜索框、Chip 等大量小图层；
- 「设置 → 外观 → 性能模式」会关闭全部毛玻璃与背景动画，适合低配机器；
- 窗口最小化后，`MainWindow.xaml.cs` 会调用 WebView2 的 `TrySuspendAsync()` 暂停渲染、计时器和网络活动；
- 下载页只渲染当前分类的列表行（原先 14 张卡片常驻 DOM）；
- 窗口切到后台时会暂停云朵 / 花瓣等装饰动画；
- 背景图有图时直接 `display:none` 掉 CSS 场景层，不再持续合成。

## 标题栏

标题栏继续使用原来的 `.custom-titlebar`：

- 整条标题栏 `app-region: drag`（同时写了 `-webkit-app-region`）；
- `.custom-titlebar button` 设为 `no-drag`，所以右侧三个圆钮可以点击；
- `MainWindow.xaml.cs` 已开启 WebView2 的 `IsNonClientRegionSupportEnabled`，并监听网页通过 `postMessage` 发来的 `window-control` 消息，实现最小化 / 最大化 / 关闭。

如果宿主自己接管窗口，可以在 `app.js` 顶部注释对应的位置替换成自己的 IPC；网页端会优先调用 `window.starLaunch.window.minimize()` 等 API。

## 数据位置

- `app.js` 里的 `INSTANCES`：主页实例选择浮层与详情面板的数据来源；版本管理列表的 9 行是 HTML 示例，新增实例时复制一行即可。
- `DOWNLOAD_DATA`：下载列表的全部版本 / 整合包 / 模组 / 资源包数据，按分类自动渲染。
- 外观设置保存在 `starlaunch.appearance.v2`（旧版 v1 已不再读取，首次打开会回到默认天蓝 + 18px 毛玻璃）。

## 预览

`preview/` 下是主要页面的渲染截图，可以直接打开对照。
