# StarLaunch

一款基于 **WPF + WebView2** 的 Minecraft 启动器。UI 为玻璃拟态风格的纯前端页面，由 C# 宿主导航到虚拟域名 `https://app.local/` 托管渲染。

<div align="center">

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE.txt)
[![.NET](https://img.shields.io/badge/.NET-10%20(windows)-512BD4.svg)](#-环境要求)
[![Vue](https://img.shields.io/badge/Vue-3-42b883.svg)](frontend/package.json)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](frontend/package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078d6.svg)](#-环境要求)

</div>

**注意**：项目当前处于 `refactor/html-to-vue3` 分支，前端已迁移为 Vue 3 + Vue Router + Pinia + SCSS（构建产物输出到 `WebAssets/`）。此 README 描述的是迁移后的最新结构。

---

## 项目简介

- **宿主层（C#/WPF）**：`MainWindow.xaml.cs` 只负责窗口与 WebView2 托管，不做任何业务逻辑。
- **前端层（WebAssets/）**：构建产物目录，由 `frontend/` 工程（Vite + Vue3）构建生成；通过 `StarLaunch.csproj` 的 `<EmbeddedResource>` 嵌入程序集，磁盘上不存站点，请求经 `https://app.local/` 虚拟域名由宿主返回。
- 图标、样式、交互全部离线自包含，无外部网络依赖。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Windows | 项目为 WPF，仅支持 Windows |
| .NET 10 SDK | 目标框架 `net10.0-windows`；解决方案为 `StarLaunch.slnx`（新 XML 格式，需 VS2022 17.13+ 打开） |
| WebView2 Runtime | 运行机器需已安装 |
| Node.js ≥ 20.19 + npm（须在 PATH） | 构建必需：`dotnet build` 会自动执行前端打包（Vite 7） |

## 构建流程

`dotnet build` 会**自动完成前端打包**：`StarLaunch.csproj` 的 `BuildFrontend` target 在编译前执行 `npm install`（按需）+ `npm run build`，刷新 `WebAssets/` 产物后嵌入程序集，无需手动分步。

```bash
dotnet build -c Release
# 或直接运行
dotnet run
```

`npm run build` 会先清空 `WebAssets/`，再执行 Vite 构建，产出固定的 `index.html` / `app.js` / `style.css` 及静态资源（`README.md`、`assets/` 由 `frontend/public/` 原样拷贝）；`StarLaunch.csproj` 显式嵌入 `index.html`/`style.css`/`app.js`（资源名 `StarLaunch.WebAssets.*`），`assets/` 下的静态资源则在构建完成后重新扫描嵌入。请求由 `MainWindow.xaml.cs` 的 `OnWebResourceRequested` 按路径映射返回。

> 修改任何前端源码后，只需重新 `dotnet build` 即生效（界面会重新嵌入程序集）。

### 纯前端开发（可选）

想跳过宿主单独迭代前端时：

```bash
cd frontend
npm install        # 首次或依赖变更后执行
npm run build      # 手动构建，等价于 dotnet build 里的自动步骤
```

> ⚠️ 构建机器必须安装 Node.js ≥ 20.19 并将 npm 加入 PATH；首次构建会联网执行 `npm install`。

## 运行与调试

| 场景 | 方式 |
| --- | --- |
| 正式运行 | `dotnet run`（释放模式，加载内嵌前端） |
| 纯前端迭代 | 直接用浏览器打开 `WebAssets/index.html`：代码不依赖宿主，`window.starLaunch` / `chrome.webview` 缺失时会优雅降级，窗口控制按钮退化为 toast 提示 |
| 前后端联调（热更新） | 终端 1：`cd frontend && npm run dev`（默认 `http://localhost:5173`）；终端 2：`STARLAUNCH_DEV_URL=http://localhost:5173 dotnet run`（仅 Debug 构建读取该环境变量，Release 忽略） |

**注意点**

- WebView2 托管下路由使用 hash 模式（`#/home` 等），不会触发整页导航。
- 宿主对 `app.local` 响应追加 `Cache-Control: no-store`，避免前端产物因文件名固定而命中磁盘缓存。
- 后台/最小化时会暂停装饰动画与 WebView2 渲染（`TrySuspendAsync`）以降低占用。

## 目录结构

```text
StarLaunch/
├─ App.xaml(.cs)            # WPF 应用入口
├─ MainWindow.xaml(.cs)     # 窗口 + WebView2 托管/虚拟域资源路由（不含业务逻辑）
├─ StarLaunch.csproj        # 工程文件（嵌入 WebAssets 产物）
├─ StarLaunch.slnx          # 解决方案（新 XML 格式）
├─ LICENSE.txt              # Apache 2.0
├─ README.md
├─ CLAUDE.md                # Claude Code 项目指引（也是一种项目文档）
│
├─ WebAssets/               # 前端构建产物（由 frontend/ 生成，git 不入库，勿手改）
│  ├─ index.html
│  ├─ app.js
│  ├─ style.css
│  ├─ README.md             # 界面设计说明（构建时由 public/ 拷贝，勿手改）
│  └─ assets/
│     └─ README.txt         # 壁纸/静态资源说明
│
└─ frontend/                # Vue 3 前端源码工程（Vite）
   ├─ package.json          # 依赖与脚本（vue3 / vue-router / pinia / vite / sass）
   ├─ vite.config.js        # 固定产物名 app.js / style.css，outDir ../WebAssets
   ├─ index.html            # Vite 源入口（<div id="app">）
   ├─ public/               # 静态资源，构建时原样拷贝到 WebAssets/
   │  ├─ README.md
   │  └─ assets/README.txt
   └─ src/
      ├─ main.js            # createApp + Pinia + Router + main.scss
      ├─ App.vue            # 壳层（壁纸/标题栏/导航/路由出口/浮层/Toast）
      ├─ router/index.js    # hash 路由与页面元信息
      ├─ stores/            # Pinia：instance/download/launch/appearance/ui/toast/wallpaper
      ├─ composables/       # useClock / useWindowControl（三级降级协议）
      ├─ data/              # 实例、下载列表、语录等静态数据
      ├─ views/             # Home / Versions / Download / Settings
      ├─ components/        # 壳层与控件组件
      └─ styles/            # SCSS partials（源自 style.css，按分区拆分）
```

## 相关文档

- `WebAssets/README.md` — 界面设计说明与数据来源（被嵌入前由 `frontend/public/` 提供）。
- `WebAssets/assets/README.txt` — 壁纸与静态资源说明。

## 许可证

本项目以 [Apache License 2.0](LICENSE.txt) 开源。

---

> 视觉风格参考「Monica Launcher」，仅用于学习交流；请从官网或官方渠道下载安装包。