/* =====================================================================
   StarLaunch · 交互脚本
   ---------------------------------------------------------------------
   · 零依赖，file:// / WebView2 / Electron 都能直接打开
   · 配色全部交给 theme.js（Material Color Utilities），这里只读不写色值
   · 窗口按钮优先调用宿主 API，其次 postMessage，最后发 DOM 事件：
       window.starLaunch.window.minimize / maximize / close
       window.chrome.webview.postMessage({ type: 'window-control', action })
       window.dispatchEvent(new CustomEvent('starlaunch:window-control', { detail:{ action } }))
   ===================================================================== */
(function () {
    'use strict';

    /* -----------------------------------------------------------------
       基础工具
       ----------------------------------------------------------------- */
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

    /* -----------------------------------------------------------------
       数据
       ----------------------------------------------------------------- */
    const INSTANCES = [
        {
            id: 'winter', name: '冬夜生存', loader: 'NeoForge', loaderName: 'NeoForge 20.4.237',
            mc: '1.20.4', mods: 82, mem: 8, java: '21.0.8', kind: 'modded', tone: 'winter',
            last: '2 小时前', path: 'D:\\Games\\.minecraft\\versions\\winter-night',
            modPreview: ['Create', 'JEI', 'Iris']
        },
        {
            id: 'sky', name: '天空工厂', loader: 'Fabric', loaderName: 'Fabric 0.16.5',
            mc: '1.21.1', mods: 46, mem: 6, java: '21.0.8', kind: 'modded', tone: 'sky',
            last: '昨天 21:04', path: 'D:\\Games\\.minecraft\\versions\\sky-factory',
            modPreview: ['Sodium', 'Lithium', 'Iris']
        },
        {
            id: 'vanilla', name: '原版 1.21.4', loader: 'Vanilla', loaderName: 'Vanilla',
            mc: '1.21.4', mods: 0, mem: 4, java: '21.0.8', kind: 'vanilla', tone: 'plain',
            last: '3 天前', path: 'D:\\Games\\.minecraft\\versions\\1.21.4',
            modPreview: []
        },
        {
            id: 'beta', name: '星辉旅人', loader: 'Forge', loaderName: 'Forge 43.4.0',
            mc: '1.19.2', mods: 128, mem: 10, java: '17.0.13', kind: 'modded', tone: 'violet',
            last: '尚未启动', path: 'D:\\Games\\.minecraft\\versions\\star-traveler',
            modPreview: ['Twilight Forest', 'Botania', 'JEI']
        },
        {
            id: 'depth', name: '深岩之下', loader: 'Fabric', loaderName: 'Fabric 0.15.11',
            mc: '1.20.6', mods: 37, mem: 6, java: '21.0.8', kind: 'modded', tone: 'deep',
            last: '5 天前', path: 'D:\\Games\\.minecraft\\versions\\deep-rock',
            modPreview: ['Create', "Farmer's Delight", 'Jade']
        },
        {
            id: 'diner', name: '像素餐厅', loader: 'Forge', loaderName: 'Forge 40.2.21',
            mc: '1.18.2', mods: 210, mem: 12, java: '17.0.13', kind: 'modded', tone: 'sunset',
            last: '上周', path: 'D:\\Games\\.minecraft\\versions\\pixel-diner',
            modPreview: ['Create', "Farmer's Delight", 'MineMenu']
        },
        {
            id: 'end', name: '末地远征', loader: 'Fabric', loaderName: 'Fabric 0.16.5',
            mc: '1.21.1', mods: 64, mem: 8, java: '21.0.8', kind: 'modded', tone: 'sky',
            last: '3 周前', path: 'D:\\Games\\.minecraft\\versions\\end-expedition',
            modPreview: ['End Remastered', 'Trinkets', 'Cloth Config']
        },
        {
            id: 'redstone', name: '红石工坊', loader: 'Forge', loaderName: 'Forge 36.2.39',
            mc: '1.16.5', mods: 96, mem: 8, java: '11.0.22', kind: 'modded', tone: 'ember',
            last: '1 个月前', path: 'D:\\Games\\.minecraft\\versions\\redstone-workshop',
            modPreview: ['Create', 'Immersive Engineering', 'ProjectE']
        },
        {
            id: 'creative', name: '创造沙盒', loader: 'Vanilla', loaderName: 'Vanilla',
            mc: '1.21.1', mods: 0, mem: 4, java: '21.0.8', kind: 'vanilla', tone: 'plain',
            last: '2 周前', path: 'D:\\Games\\.minecraft\\versions\\creative-sandbox',
            modPreview: []
        }
    ];

    const QUOTES = [
        '方块堆成星海，夜晚就有了归处。',
        '先挖三块木头，再去想远方。',
        '把家建在出生点，把梦建在云端。',
        '世界没有存档，但今天可以重来。',
        '一间木屋，一盏南瓜灯，就够了。'
    ];

    const ROUTES = {
        home: { crumb: '启动', title: 'StarLaunch' },
        versions: { crumb: '版本', title: '版本 · StarLaunch' },
        download: { crumb: '下载', title: '下载 · StarLaunch' },
        settings: { crumb: '设置', title: '设置 · StarLaunch' }
    };

    const DOWNLOADS = [
        { id: 'mc-1214', cat: 'version', name: 'Minecraft 1.21.4', sub: '冬季更新 · 正式版 · 2024-12-03 · Java 21', size: '386 MB', tile: '1.21.4', tone: 'a', badge: '最新' },
        { id: 'mc-1211', cat: 'version', name: 'Minecraft 1.21.1', sub: '正式版 · 2024-08-08 · Java 21', size: '372 MB', tile: '1.21.1', tone: 'b' },
        { id: 'mc-1206', cat: 'version', name: 'Minecraft 1.20.6', sub: '正式版 · 2024-04-29 · Java 21', size: '358 MB', tile: '1.20.6', tone: 'c' },
        { id: 'mc-1201', cat: 'version', name: 'Minecraft 1.20.1', sub: '模组黄金版 · 2023-06-12 · Java 17', size: '312 MB', tile: '1.20.1', tone: 'd', badge: '热门' },
        { id: 'mc-1192', cat: 'version', name: 'Minecraft 1.19.2', sub: '稳定版 · 2022-08-05 · Java 17', size: '298 MB', tile: '1.19.2', tone: 'e' },
        { id: 'mc-1165', cat: 'version', name: 'Minecraft 1.16.5', sub: '经典版 · 2021-01-15 · Java 11', size: '264 MB', tile: '1.16.5', tone: 'f' },
        { id: 'pack-winter', cat: 'modpack', name: '冬夜生存', sub: 'NeoForge 1.20.4 · 82 个模组', size: '1.8 GB', tile: '冬夜', tone: 'a', badge: '推荐' },
        { id: 'pack-sky', cat: 'modpack', name: '天空工厂', sub: 'Fabric 1.21.1 · 空岛整合 · 46 个模组', size: '960 MB', tile: '天空', tone: 'b' },
        { id: 'pack-star', cat: 'modpack', name: '星辉旅人', sub: 'Forge 1.19.2 · 冒险整合 · 128 个模组', size: '2.4 GB', tile: '星辉', tone: 'd' },
        { id: 'mod-sodium', cat: 'mod', name: 'Sodium 钠', sub: 'Fabric 1.21.x · 渲染优化', size: '1.2 MB', tile: 'Na', tone: 'c' },
        { id: 'mod-iris', cat: 'mod', name: 'Iris Shaders', sub: 'Fabric 1.21.x · 光影加载', size: '6.8 MB', tile: 'Iris', tone: 'e' },
        { id: 'mod-jei', cat: 'mod', name: 'JEI 物品管理器', sub: 'Forge 1.20.x · 实用工具', size: '3.4 MB', tile: 'JEI', tone: 'a' },
        { id: 'mod-create', cat: 'mod', name: 'Create 机械动力', sub: 'Forge 1.20.1 · 科技模组', size: '18.6 MB', tile: 'C+', tone: 'f' },
        { id: 'rp-dawn', cat: 'resource', name: '晨曦 128×', sub: '通用 · 1.20+ · 清新光影向', size: '64 MB', tile: '晨', tone: 'e' },
        { id: 'rp-mint', cat: 'resource', name: '薄荷 64×', sub: '通用 · 1.20+ · 清爽低配向', size: '28 MB', tile: '薄荷', tone: 'c' }
    ];

    const QUEUE_SEED = [
        { id: 'q-1214', name: 'Minecraft 1.21.4', phase: 'assets · 12.4 MB/s', eta: '约 2 分钟', progress: 68, state: 'running' },
        { id: 'q-neo', name: 'NeoForge 20.4.237', phase: '排队中 · 0 B/s', eta: '—', progress: 0, state: 'queued' }
    ];

    /* 原版游戏：PCL 风格的版本分组 */
    const VERSION_GROUPS = [
        {
            key: 'release', label: '正式版', note: '稳定版本，适合日常游玩',
            items: [
                { id: 'mc-1214', version: '1.21.4', date: '2024/12/03 18:20', size: '386 MB', tag: '最新正式版' },
                { id: 'mc-1211', version: '1.21.1', date: '2024/08/08', size: '372 MB' },
                { id: 'mc-1206', version: '1.20.6', date: '2024/04/29', size: '358 MB' },
                { id: 'mc-1201', version: '1.20.1', date: '2023/06/12', size: '312 MB' },
                { id: 'mc-1192', version: '1.19.2', date: '2022/08/05', size: '298 MB' },
                { id: 'mc-1165', version: '1.16.5', date: '2021/01/15', size: '264 MB' }
            ]
        },
        {
            key: 'snapshot', label: '预览版', note: '开发中的快照，可能不稳定',
            items: [
                { id: 'mc-1215-s4', version: '1.21.5-snapshot-4', date: '2025/01/15 21:08', size: '392 MB', tag: '最新预览版' },
                { id: 'mc-1215-s3', version: '1.21.5-snapshot-3', date: '2025/01/09', size: '390 MB' },
                { id: 'mc-1215-s2', version: '1.21.5-snapshot-2', date: '2025/01/07', size: '389 MB' },
                { id: 'mc-1214-rc3', version: '1.21.4-rc3', date: '2024/11/28', size: '384 MB' }
            ]
        },
        {
            key: 'old', label: '远古版', note: '经典版本与旧版整合包常用版本',
            items: [
                { id: 'mc-1122', version: '1.12.2', date: '2017/09/18', size: '178 MB' },
                { id: 'mc-189', version: '1.8.9', date: '2015/12/09', size: '152 MB' },
                { id: 'mc-1710', version: '1.7.10', date: '2014/05/14', size: '128 MB' },
                { id: 'mc-164', version: '1.6.4', date: '2013/09/19', size: '116 MB' },
                { id: 'mc-152', version: '1.5.2', date: '2013/05/01', size: '104 MB' },
                { id: 'mc-b173', version: 'b1.7.3', date: '2011/07/08', size: '42 MB' },
                { id: 'mc-a126', version: 'a1.2.6', date: '2010/12/02', size: '18 MB' }
            ]
        },
        {
            key: 'april', label: '愚人节版', note: '愚人节玩笑版本，仅作收藏',
            items: [
                { id: 'mc-20w14inf', version: '20w14∞', date: '2020/04/01', size: '96 MB' },
                { id: 'mc-3dshare', version: '3D Shareware v1.34', date: '2019/04/01', size: '88 MB' },
                { id: 'mc-1rv', version: '1.RV-Pre1', date: '2016/03/31', size: '76 MB' },
                { id: 'mc-15w14a', version: '15w14a', date: '2015/04/01', size: '72 MB' }
            ]
        }
    ];

    const VERSIONS = VERSION_GROUPS.reduce((list, group) => list.concat(
        group.items.map((item) => Object.assign({ cat: 'version', name: 'Minecraft ' + item.version, group: group.key }, item))
    ), []);

    const LATEST_VERSION_IDS = ['mc-1214', 'mc-1215-s4'];

    /* Mod：PCL 风格的结果数据，cat 是分类标签 */
    const MODS = [
        { id: 'mod-sodium', name: '钠', en: 'Sodium', cat: '性能优化', desc: '高性能渲染引擎替换，显著提高帧率并减少卡顿。', loaders: ['Fabric', 'NeoForge'], versions: '1.16+', downloads: '2.51 亿', updated: '2 天前', source: 'Modrinth', tile: 'Na', tone: 'a' },
        { id: 'mod-iris', name: 'Iris Shaders', en: 'Iris', cat: '性能优化', desc: '现代光影加载器，兼容 OptiFine 格式的光影包。', loaders: ['Fabric', 'NeoForge'], versions: '1.16+', downloads: '1.94 亿', updated: '41 天前', source: 'Modrinth', tile: 'Iris', tone: 'b' },
        { id: 'mod-entityculling', name: '实体渲染机制优化', en: 'Entity Culling', cat: '性能优化', desc: '用异步路径追踪隐藏不可见的方块和实体，减少渲染开销。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.12+', downloads: '1.87 亿', updated: '32 天前', source: 'Modrinth', tile: 'EC', tone: 'c' },
        { id: 'mod-cloth', name: 'Cloth Config API', en: 'Cloth Config', cat: '支持库', desc: '为模组提供统一配置界面的前置支持库。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.14+', downloads: '1.85 亿', updated: '48 天前', source: 'Modrinth', tile: 'CC', tone: 'd' },
        { id: 'mod-ferritecore', name: '铁氧体磁芯', en: 'FerriteCore', cat: '性能优化', desc: '优化内存占用，降低大型整合包的内存压力。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '1.42 亿', updated: '12 天前', source: 'Modrinth', tile: 'FC', tone: 'e' },
        { id: 'mod-create', name: '机械动力', en: 'Create', cat: '科技', desc: '围绕旋转动力与自动化展开的机械科技模组。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.18.2+', downloads: '9 800 万', updated: '5 天前', source: 'CurseForge', tile: 'C+', tone: 'f' },
        { id: 'mod-jei', name: '物品管理器', en: 'JEI', cat: '实用', desc: '查询物品用途与合成配方的物品管理器。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.12+', downloads: '3.2 亿', updated: '3 天前', source: 'CurseForge', tile: 'JEI', tone: 'a' },
        { id: 'mod-farmers', name: '农夫乐事', en: "Farmer's Delight", cat: '农业', desc: '扩展农业、烹饪与食物系统的轻量模组。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '8 600 万', updated: '7 天前', source: 'Modrinth', tile: 'FD', tone: 'b' },
        { id: 'mod-jade', name: '玉', en: 'Jade', cat: '实用', desc: '在准星旁显示方块与实体信息的提示模组。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '9 200 万', updated: '9 天前', source: 'Modrinth', tile: 'Jade', tone: 'c' },
        { id: 'mod-xaero', name: '小地图', en: "Xaero's Minimap", cat: '辅助', desc: '小地图、路径点与生物追踪。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '2.1 亿', updated: '6 天前', source: 'CurseForge', tile: 'XM', tone: 'd' },
        { id: 'mod-appleskin', name: '苹果皮', en: 'AppleSkin', cat: '辅助', desc: '显示饱和度、饥饿值与食物恢复量。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '1.2 亿', updated: '20 天前', source: 'Modrinth', tile: 'AS', tone: 'e' },
        { id: 'mod-terralith', name: '地形扩展', en: 'Terralith', cat: '世界生成', desc: '用原版方块重绘世界生成，加入大量新地形。', loaders: ['Fabric', 'NeoForge'], versions: '1.18+', downloads: '5 400 万', updated: '15 天前', source: 'Modrinth', tile: 'TR', tone: 'f' },
        { id: 'mod-twilight', name: '暮色森林', en: 'Twilight Forest', cat: '冒险', desc: '新增暮色森林维度、Boss 与冒险内容。', loaders: ['Forge', 'NeoForge'], versions: '1.16+', downloads: '1.1 亿', updated: '25 天前', source: 'CurseForge', tile: 'TF', tone: 'a' },
        { id: 'mod-botania', name: '植物魔法', en: 'Botania', cat: '魔法', desc: '以植物与花朵为核心的魔法科技模组。', loaders: ['Forge', 'NeoForge'], versions: '1.16+', downloads: '7 800 万', updated: '33 天前', source: 'CurseForge', tile: 'BT', tone: 'b' },
        { id: 'mod-voicechat', name: '简单语音', en: 'Simple Voice Chat', cat: '社交', desc: '近距离语音聊天，支持服务器分组频道。', loaders: ['Fabric', 'Forge', 'NeoForge'], versions: '1.16+', downloads: '6 700 万', updated: '4 天前', source: 'Modrinth', tile: 'VC', tone: 'c' }
    ];

    /* 整合包：PCL 风格搜索结果 */
    const MODPACKS = [
        { id: 'pack-winter', name: '冬夜生存', en: 'Winter Night', cat: '生存', desc: '寒冷群系生存整合，附带任务与季节系统。', loaders: ['NeoForge'], versions: '1.20.4', meta: 'NeoForge 1.20.4 · 82 个模组', downloads: '1 240 万', updated: '2 天前', source: 'Modrinth', tile: '冬', tone: 'a' },
        { id: 'pack-sky', name: '天空工厂', en: 'Sky Factory', cat: '空岛', desc: '从一棵树开始，在空岛上搭建自动化生产线。', loaders: ['Fabric'], versions: '1.21.1', meta: 'Fabric 1.21.1 · 46 个模组', downloads: '980 万', updated: '5 天前', source: 'Modrinth', tile: '天', tone: 'b' },
        { id: 'pack-star', name: '星辉旅人', en: 'Star Traveler', cat: '冒险', desc: '以探索与战斗为主的冒险整合包。', loaders: ['Forge'], versions: '1.19.2', meta: 'Forge 1.19.2 · 128 个模组', downloads: '760 万', updated: '8 天前', source: 'CurseForge', tile: '星', tone: 'd' },
        { id: 'pack-depth', name: '深岩之下', en: 'Deep Rock', cat: '生存', desc: '围绕地下探索与洞穴生存展开的轻量整合。', loaders: ['Fabric'], versions: '1.20.6', meta: 'Fabric 1.20.6 · 37 个模组', downloads: '540 万', updated: '12 天前', source: 'Modrinth', tile: '岩', tone: 'c' },
        { id: 'pack-diner', name: '像素餐厅', en: 'Pixel Diner', cat: '休闲', desc: '经营、烹饪与建造结合的休闲整合包。', loaders: ['Forge'], versions: '1.18.2', meta: 'Forge 1.18.2 · 210 个模组', downloads: '430 万', updated: '15 天前', source: 'CurseForge', tile: '餐', tone: 'f' },
        { id: 'pack-end', name: '末地远征', en: 'End Expedition', cat: '冒险', desc: '重做末地维度与终局战斗的冒险整合。', loaders: ['Fabric'], versions: '1.21.1', meta: 'Fabric 1.21.1 · 64 个模组', downloads: '390 万', updated: '18 天前', source: 'Modrinth', tile: '末', tone: 'e' },
        { id: 'pack-redstone', name: '红石工坊', en: 'Redstone Workshop', cat: '科技', desc: '红石机械与自动化科技整合包。', loaders: ['Forge'], versions: '1.16.5', meta: 'Forge 1.16.5 · 96 个模组', downloads: '680 万', updated: '21 天前', source: 'CurseForge', tile: '红', tone: 'a' },
        { id: 'pack-creative', name: '创造沙盒', en: 'Creative Sandbox', cat: '休闲', desc: '无压力创造与建筑向整合，启动即用。', loaders: ['Vanilla'], versions: '1.21.1', meta: 'Vanilla 1.21.1 · 无模组', downloads: '210 万', updated: '30 天前', source: 'Modrinth', tile: '创', tone: 'b' },
        { id: 'pack-rlcraft', name: 'RLCraft', en: 'RLCraft', cat: '硬核', desc: '高难度生存整合，强调真实感与死亡惩罚。', loaders: ['Forge'], versions: '1.12.2', meta: 'Forge 1.12.2 · 187 个模组', downloads: '2 400 万', updated: '60 天前', source: 'CurseForge', tile: 'RL', tone: 'd' },
        { id: 'pack-atm9', name: 'All the Mods 9', en: 'ATM 9', cat: '科技', desc: '大型科技整合，包含数百个模组与任务线。', loaders: ['NeoForge'], versions: '1.20.1', meta: 'NeoForge 1.20.1 · 400+ 个模组', downloads: '1 800 万', updated: '4 天前', source: 'CurseForge', tile: 'ATM', tone: 'c' },
        { id: 'pack-bettermc', name: 'Better MC', en: 'Better MC', cat: '冒险', desc: '在原版基础上扩展冒险、地牢与生物群系。', loaders: ['Fabric'], versions: '1.20.1', meta: 'Fabric 1.20.1 · 350 个模组', downloads: '1 500 万', updated: '6 天前', source: 'Modrinth', tile: 'BMC', tone: 'e' },
        { id: 'pack-cobblemon', name: 'Cobblemon', en: 'Cobblemon', cat: '休闲', desc: '把宝可梦收集与对战带进 Minecraft。', loaders: ['Fabric'], versions: '1.21.1', meta: 'Fabric 1.21.1 · 120 个模组', downloads: '1 100 万', updated: '9 天前', source: 'Modrinth', tile: '宝', tone: 'f' },
        { id: 'pack-vault', name: 'Vault Hunters', en: 'Vault Hunters', cat: '冒险', desc: '地牢探险与战利品构筑的长期冒险整合。', loaders: ['Forge'], versions: '1.18.2', meta: 'Forge 1.18.2 · 250 个模组', downloads: '920 万', updated: '11 天前', source: 'CurseForge', tile: 'VH', tone: 'a' },
        { id: 'pack-astral', name: 'Create: Astral', en: 'Create: Astral', cat: '科技', desc: '以机械动力为核心的天空科技整合包。', loaders: ['Forge'], versions: '1.18.2', meta: 'Forge 1.18.2 · 300 个模组', downloads: '870 万', updated: '14 天前', source: 'CurseForge', tile: 'CA', tone: 'b' }
    ];

    /* 资源包 */
    const RESOURCES = [
        { id: 'rp-dawn', name: '晨曦', en: 'Dawn 128×', cat: '清新', desc: '柔和的高分辨率材质，适合日常生存。', versions: '1.20+', meta: '1.20+ · 128× · 64 MB', downloads: '820 万', updated: '6 天前', source: 'Modrinth', tile: '晨', tone: 'e' },
        { id: 'rp-mint', name: '薄荷', en: 'Mint 64×', cat: '清新', desc: '清爽低配向材质，长时间游戏不刺眼。', versions: '1.20+', meta: '1.20+ · 64× · 28 MB', downloads: '640 万', updated: '9 天前', source: 'Modrinth', tile: '薄', tone: 'c' },
        { id: 'rp-vanilla', name: '原版增强', en: 'Vanilla Plus', cat: '原版', desc: '保持原版风格，只提升细节与清晰度。', versions: '1.20+', meta: '1.20+ · 32× · 18 MB', downloads: '1 200 万', updated: '4 天前', source: 'CurseForge', tile: '原', tone: 'a' },
        { id: 'rp-realistic', name: '写实主义', en: 'Realistic 256×', cat: '写实', desc: '高分辨率写实材质，适合光影截图。', versions: '1.20+', meta: '1.20+ · 256× · 186 MB', downloads: '530 万', updated: '12 天前', source: 'CurseForge', tile: '实', tone: 'b' },
        { id: 'rp-cartoon', name: '卡通世界', en: 'Toon World', cat: '卡通', desc: '明快卡通风格，适合休闲与建筑存档。', versions: '1.19+', meta: '1.19+ · 64× · 42 MB', downloads: '310 万', updated: '20 天前', source: 'Modrinth', tile: '卡', tone: 'd' },
        { id: 'rp-medieval', name: '中世纪城堡', en: 'Medieval 128×', cat: '写实', desc: '中世纪建筑与装备风格材质包。', versions: '1.18+', meta: '1.18+ · 128× · 98 MB', downloads: '470 万', updated: '25 天前', source: 'CurseForge', tile: '堡', tone: 'f' },
        { id: 'rp-lite', name: '低配精简', en: 'Lite 16×', cat: '低配', desc: '极简材质，最大程度减少显存与帧率压力。', versions: '1.16+', meta: '1.16+ · 16× · 6 MB', downloads: '890 万', updated: '3 天前', source: 'Modrinth', tile: '低', tone: 'e' },
        { id: 'rp-darkui', name: '暗色界面', en: 'Dark UI', cat: '原版', desc: '把原版界面替换为低对比暗色风格。', versions: '1.20+', meta: '1.20+ · 32× · 12 MB', downloads: '260 万', updated: '7 天前', source: 'Modrinth', tile: '暗', tone: 'c' },
        { id: 'rp-pixel', name: '像素复古', en: 'Pixel Retro', cat: '卡通', desc: '复古像素风，还原早期 Minecraft 的质感。', versions: '1.8+', meta: '1.8+ · 16× · 4 MB', downloads: '720 万', updated: '40 天前', source: 'CurseForge', tile: '像', tone: 'a' },
        { id: 'rp-future', name: '未来科技', en: 'Future Tech', cat: '写实', desc: '霓虹与金属质感的科技风材质包。', versions: '1.20+', meta: '1.20+ · 128× · 76 MB', downloads: '180 万', updated: '17 天前', source: 'Modrinth', tile: '未', tone: 'b' },
        { id: 'rp-nature', name: '自然风光', en: 'Nature 128×', cat: '清新', desc: '以自然与植被为主题的柔和材质。', versions: '1.19+', meta: '1.19+ · 128× · 88 MB', downloads: '350 万', updated: '22 天前', source: 'CurseForge', tile: '自', tone: 'd' },
        { id: 'rp-summer', name: '清新夏日', en: 'Summer 64×', cat: '清新', desc: '明亮清爽的夏日配色，适合海岛存档。', versions: '1.20+', meta: '1.20+ · 64× · 34 MB', downloads: '290 万', updated: '8 天前', source: 'Modrinth', tile: '夏', tone: 'f' }
    ];

    /* 光影包 */
    const SHADERS = [
        { id: 'shader-complementary', name: 'Complementary', en: 'Reimagined', cat: '写实', desc: '综合表现均衡的写实光影，兼容性好。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中高配', downloads: '3 800 万', updated: '5 天前', source: 'Modrinth', tile: 'CR', tone: 'a' },
        { id: 'shader-bsl', name: 'BSL', en: 'Shaders', cat: '写实', desc: '经典的柔和光照与水面效果。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中配', downloads: '2 600 万', updated: '9 天前', source: 'Modrinth', tile: 'BSL', tone: 'b' },
        { id: 'shader-seus', name: 'SEUS', en: 'PTGI', cat: '写实', desc: '路径追踪光影，画面接近真实光线。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 高配', downloads: '1 900 万', updated: '40 天前', source: 'CurseForge', tile: 'SEUS', tone: 'c' },
        { id: 'shader-sildur', name: 'Sildur', en: 'Vibrant', cat: '卡通', desc: '鲜艳明快的色彩，适合卡通材质包。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中配', downloads: '1 500 万', updated: '13 天前', source: 'CurseForge', tile: 'SV', tone: 'd' },
        { id: 'shader-makeup', name: 'MakeUp', en: 'Ultra Fast', cat: '低配', desc: '极致轻量的光影，核显也能稳定运行。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 低配', downloads: '2 200 万', updated: '6 天前', source: 'Modrinth', tile: 'MU', tone: 'e' },
        { id: 'shader-chocapic', name: 'Chocapic13', en: 'Chocapic13', cat: '写实', desc: '层次分明的光照与阴影，配置档位丰富。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中高配', downloads: '1 300 万', updated: '18 天前', source: 'CurseForge', tile: 'C13', tone: 'f' },
        { id: 'shader-rethinking', name: 'Rethinking', en: 'Voxels', cat: '写实', desc: '体素光照与体积雾，适合高端显卡。', versions: '1.20+', meta: 'Iris · 1.20+ · 高配', downloads: '980 万', updated: '2 天前', source: 'Modrinth', tile: 'RV', tone: 'a' },
        { id: 'shader-bliss', name: 'Bliss', en: 'Bliss', cat: '梦幻', desc: '梦幻色调与柔和光晕，适合风景截图。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中配', downloads: '760 万', updated: '11 天前', source: 'Modrinth', tile: 'BL', tone: 'b' },
        { id: 'shader-solas', name: 'Solas', en: 'Shader', cat: '写实', desc: '干净的光照与自然色彩，性能开销适中。', versions: '1.20+', meta: 'Iris · 1.20+ · 中高配', downloads: '690 万', updated: '7 天前', source: 'Modrinth', tile: 'SO', tone: 'c' },
        { id: 'shader-vanillaplus', name: 'Vanilla Plus', en: 'Vanilla Plus', cat: '低配', desc: '只做轻微增强的原版风光影。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 低配', downloads: '1 100 万', updated: '16 天前', source: 'CurseForge', tile: 'VP', tone: 'd' },
        { id: 'shader-photon', name: 'Photon', en: 'Shader', cat: '写实', desc: '高质量光照与天气效果，适合录制。', versions: '1.20+', meta: 'Iris · 1.20+ · 中高配', downloads: '850 万', updated: '10 天前', source: 'Modrinth', tile: 'PH', tone: 'e' },
        { id: 'shader-nostalgia', name: 'Nostalgia', en: 'Shader', cat: '梦幻', desc: '怀旧滤镜与暖色调，营造旧日氛围。', versions: '1.20+', meta: 'Iris / OptiFine · 1.20+ · 中配', downloads: '520 万', updated: '24 天前', source: 'CurseForge', tile: 'NS', tone: 'f' }
    ];

    const CATALOG = { mod: MODS, modpack: MODPACKS, resource: RESOURCES, shader: SHADERS };

    const LOADER_TYPES = [
        ['all', '全部'], ['Fabric', 'Fabric'], ['Forge', 'Forge'],
        ['NeoForge', 'NeoForge'], ['Quilt', 'Quilt']
    ];

    const CATALOG_META = {
        mod: {
            title: '搜索 Mod', noun: 'Mod', action: '安装',
            placeholder: '中文名 / 英文名 / 关键词', types: LOADER_TYPES
        },
        modpack: {
            title: '搜索整合包', noun: '整合包', action: '安装',
            placeholder: '整合包名称 / 关键词', types: LOADER_TYPES
        },
        resource: {
            title: '搜索资源包', noun: '资源包', action: '下载',
            placeholder: '资源包名称 / 风格',
            types: [['all', '全部'], ['原版', '原版'], ['写实', '写实'], ['卡通', '卡通'], ['清新', '清新'], ['低配', '低配']]
        },
        shader: {
            title: '搜索光影', noun: '光影包', action: '下载',
            placeholder: '光影名称 / 风格',
            types: [['all', '全部'], ['写实', '写实'], ['卡通', '卡通'], ['梦幻', '梦幻'], ['低配', '低配']]
        }
    };

    const CATALOG_PAGE_SIZE = 10;


    /* -----------------------------------------------------------------
       运行时状态
       ----------------------------------------------------------------- */
    const ui = readStore(STORE.uiPrefs, {
        activeId: 'winter', instFilter: 'all', dlCat: 'version', source: 'BMCLAPI', setTab: 'appearance'
    });
    const launchPrefs = readStore(STORE.launchPrefs, {
        mem: 8, updater: true, minimize: false, concurrency: 8, cleanCache: true,
        launcherUpdate: true, rememberWindow: true, tray: false, winStyle: 'right',
        isolation: 'all', windowTitle: '', customInfo: 'StarLaunch',
        visibility: 'unchanged', priority: 'normal',
        windowMode: 'custom', winW: 854, winH: 480,
        memMode: 'auto', memOptimize: true,
        jvmArgs: '-XX:+OmitStackTraceInFastThrow -Djdk.lang.Process.allowAmbiguousCommands=True -Dfml.ignoreInvalidMinecraftCertificates=True -Dfml.ignorePatchDiscrepancies=True',
        gameArgs: '', preCommand: '', javaList: 'java21', memoryManager: 'g1',
        disableWrapper: false, disableUnsafe: false, highPerfGpu: true,
        advancedOpen: true, advancedNote: true
    });
    const noticePrefs = readStore(STORE.notice, {
        source: 'preset',
        format: 'md',
        preset: '',
        filePath: '',
        fileName: '',
        fileText: '',
        fileFormat: 'md'
    });
    const launchLog = readArray(STORE.launchLog, []);
    const downloadState = new Map();
    const queue = QUEUE_SEED.slice();
    const versionOpen = new Set(['release']);
    const versionTotal = VERSIONS.length;
    const catalogState = {
        mod: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        modpack: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        resource: { name: '', source: 'all', version: '', type: 'all', page: 1 },
        shader: { name: '', source: 'all', version: '', type: 'all', page: 1 }
    };
    let catalogPageCount = 1;

    let launchTimers = [];
    let launchState = 'idle';
    let lastFocus = null;
    let quoteIndex = 0;

    const getInstance = (id) => INSTANCES.find((item) => item.id === id) || INSTANCES[0];
    const activeInstance = () => getInstance(ui.activeId);
    const modsLabel = (inst) => (inst.mods > 0 ? inst.mods + ' 个模组' : '无模组');

    /* -----------------------------------------------------------------
       Toast
       ----------------------------------------------------------------- */
    function toast(message, icon) {
        const host = $('#toasts');
        if (!host) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + escapeHtml(message) + '</span>';
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-in'));
        while (host.children.length > 3) host.firstElementChild.remove();
        window.setTimeout(() => {
            el.classList.remove('is-in');
            window.setTimeout(() => el.remove(), 220);
        }, 2600);
    }

    /* -----------------------------------------------------------------
       时间 / 问候
       ----------------------------------------------------------------- */
    function tickClock() {
        const now = new Date();
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
        const dateEl = $('#heroDate');
        const clockEl = $('#heroClock');
        const greetEl = $('#heroGreeting');
        if (dateEl) dateEl.textContent = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 ' + week;
        if (clockEl) clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        if (greetEl) {
            const h = now.getHours();
            greetEl.textContent = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
        }
        const acctLast = $('#acctLast');
        if (acctLast) acctLast.textContent = '今天 ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    }

    /* -----------------------------------------------------------------
       标题栏 / 宿主桥接
       ----------------------------------------------------------------- */
    function handleWindowControl(action) {
        const labels = { minimize: '最小化', maximize: '最大化', close: '关闭' };
        const api = window.starLaunch && window.starLaunch.window;
        if (api && typeof api[action] === 'function') {
            api[action]();
            return;
        }
        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
            window.chrome.webview.postMessage({ type: 'window-control', action: action });
            return;
        }
        const event = new CustomEvent('starlaunch:window-control', { cancelable: true, detail: { action: action } });
        const handled = !window.dispatchEvent(event);
        if (!handled) toast('已发送「' + labels[action] + '」窗口指令', 'i-info');
    }

    function detectHost() {
        const ua = navigator.userAgent;
        const host = $('#heroHost');
        if (!host) return;
        let label = 'Windows 11';
        if (/Windows NT 10/.test(ua)) label = 'Windows 11';
        else if (/Windows NT 6\.3/.test(ua)) label = 'Windows 8.1';
        else if (/Mac OS X/.test(ua)) label = 'macOS';
        else if (/Linux/.test(ua)) label = 'Linux';
        if (/Edg\//.test(ua)) label += ' · Edge WebView2';
        host.textContent = label;

        const engine = $('#engineInfo');
        if (engine) {
            const match = ua.match(/Chrom(e|ium)\/(\d+)/);
            engine.textContent = match ? 'Chromium ' + match[2] : 'Chromium';
        }
    }

    /* -----------------------------------------------------------------
       路由
       ----------------------------------------------------------------- */
    function routeName() {
        const hash = (location.hash || '').replace(/^#\/?/, '');
        return Object.prototype.hasOwnProperty.call(ROUTES, hash) ? hash : 'home';
    }

    function staggerView(view) {
        if (!view) return;
        const blocks = $$('.page-head, .hero, .slab, .panel, .feature, .set-head, .set-block, .about, .tip', view);
        blocks.forEach((el, index) => {
            el.style.setProperty('--stagger', String(Math.min(index, 7)));
        });
    }

    function applyRoute() {
        const name = routeName();
        const route = ROUTES[name];
        const previous = $('.view.is-active');
        const previousName = previous ? previous.dataset.view : null;
        $$('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === name));
        $$('.rail-item[data-nav]').forEach((btn) => {
            const active = btn.dataset.nav === name;
            btn.classList.toggle('is-active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        const crumb = $('#tbCrumb');
        if (crumb) crumb.textContent = route.crumb;
        document.title = route.title;
        const stage = $('#stage');
        if (stage) stage.scrollTop = 0;
        if (name !== previousName) staggerView($('.view.is-active'));
        closePopovers();
    }

    function go(view) {
        if (!ROUTES[view]) return;
        if (location.hash === '#' + view) applyRoute();
        else location.hash = view;
    }

    /* -----------------------------------------------------------------
       主页：实例
       ----------------------------------------------------------------- */
    function renderInstanceOptions() {
        const host = $('#instOptions');
        if (!host) return;
        host.innerHTML = INSTANCES.map((inst) => {
            const active = inst.id === ui.activeId;
            return '<button class="inst-option' + (active ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + active + '" data-pick="' + inst.id + '">' +
                '<span class="inst-option-tile tile--' + inst.tone + '" aria-hidden="true"><svg class="cube"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-option-copy">' +
                    '<span class="inst-option-name">' + escapeHtml(inst.name) + '</span>' +
                    '<span class="inst-option-meta">' + escapeHtml(inst.loader) + ' · ' + escapeHtml(inst.mc) + ' · ' + escapeHtml(modsLabel(inst)) + '</span>' +
                '</span>' +
                '<svg class="icon inst-option-check" aria-hidden="true"><use href="#i-check"/></svg>' +
            '</button>';
        }).join('');
        const count = $('#instCount');
        if (count) count.textContent = INSTANCES.length + ' 个';
    }

    function paintRange(input) {
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value || 0);
        const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
        input.style.setProperty('--p', pct.toFixed(2) + '%');
    }

    function syncMem(inst) {
        const homeRange = $('#homeMemRange');
        const vRange = $('#vMemRange');
        const curText = $('#curMemText');
        const vLabel = $('#vMemLabel');
        if (curText) curText.textContent = inst.mem + ' / 32 GB';
        if (homeRange && inst.id === ui.activeId) { homeRange.value = String(inst.mem); paintRange(homeRange); }
        if (vRange && inst.id === ui.activeId) { vRange.value = String(inst.mem); paintRange(vRange); }
        if (vLabel) vLabel.textContent = inst.mem + ' GB';
        const row = $('[data-instance-row="' + inst.id + '"] .inst-row-side');
        if (row) row.textContent = inst.mem + ' GB';
    }

    function renderInstanceList() {
        const host = $('#instList');
        if (!host) return;
        host.innerHTML = INSTANCES.map((inst) => {
            const active = inst.id === ui.activeId;
            return '<article class="inst-row' + (active ? ' is-active' : '') + '" data-instance-row="' + inst.id + '" data-kind="' + inst.kind + '" tabindex="0" role="button" aria-pressed="' + active + '">' +
                '<span class="inst-row-tile tile--' + inst.tone + '" aria-hidden="true"><svg class="cube"><use href="#i-cube"/></svg></span>' +
                '<span class="inst-row-main">' +
                    '<span class="inst-row-name">' + escapeHtml(inst.name) + '<span class="badge">' + escapeHtml(inst.loader) + '</span></span>' +
                    '<span class="inst-row-meta">' + escapeHtml(inst.mc) + ' · ' + escapeHtml(modsLabel(inst)) + ' · ' + escapeHtml(inst.last) + '</span>' +
                '</span>' +
                '<span class="inst-row-side num">' + inst.mem + ' GB</span>' +
                '<button class="icon-btn inst-row-more" type="button" data-toast="实例操作：设为默认 / 打开目录 / 删除" aria-label="更多操作">' +
                    '<svg class="icon"><use href="#i-more"/></svg>' +
                '</button>' +
            '</article>';
        }).join('');
        filterInstances();
    }

    function selectInstance(id, options) {
        const inst = getInstance(id);
        ui.activeId = inst.id;
        writeStore(STORE.uiPrefs, ui);

        const nameEl = $('#curInstName');
        if (nameEl) nameEl.textContent = inst.name;
        const metaEl = $('#curInstMeta');
        if (metaEl) metaEl.textContent = inst.loader + ' · ' + inst.mc + ' · ' + modsLabel(inst);
        const tile = $('#curInstTile');
        if (tile) tile.className = 'inst-tile tile--' + inst.tone;

        $$('[data-instance-row]').forEach((row) => {
            const active = row.dataset.instanceRow === ui.activeId;
            row.classList.toggle('is-active', active);
            row.setAttribute('aria-pressed', String(active));
        });

        const hero = $('#detailHero');
        if (hero) hero.dataset.tone = inst.tone;
        const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
        setText('#vHeroMc', 'MINECRAFT ' + inst.mc);
        setText('#vHeroName', inst.name);
        setText('#vPath', inst.path);
        setText('#vMc', 'Minecraft ' + inst.mc);
        setText('#vLoader', inst.loaderName);
        setText('#vMods', inst.mods > 0 ? inst.mods + ' 个' : '无模组');
        setText('#vJava', inst.java + ' · Microsoft');
        setText('#vLast', inst.last);
        setText('#vModsCount', inst.mods > 0 ? inst.mods + ' 个' : '无模组');

        const chips = $('#vModChips');
        if (chips) {
            if (inst.mods > 0) {
                const preview = inst.modPreview.slice(0, 3);
                const rest = inst.mods - preview.length;
                chips.innerHTML = preview.map((n) => '<span>' + escapeHtml(n) + '</span>').join('') +
                    (rest > 0 ? '<span class="is-more">+' + rest + '</span>' : '');
            } else {
                chips.innerHTML = '<span class="is-empty">纯净原版 · 未安装模组</span>';
            }
        }

        syncMem(inst);
        renderInstanceOptions();

        if (options && options.toast) toast('已切换到「' + inst.name + '」');
    }

    function filterInstances() {
        const query = (($('#instSearch') && $('#instSearch').value) || '').trim().toLowerCase();
        let visible = 0;
        $$('[data-instance-row]').forEach((row) => {
            const inst = getInstance(row.dataset.instanceRow);
            const kindOk = ui.instFilter === 'all' || inst.kind === ui.instFilter;
            const text = (inst.name + ' ' + inst.mc + ' ' + inst.loader + ' ' + inst.loaderName).toLowerCase();
            const show = kindOk && (!query || text.indexOf(query) !== -1);
            row.hidden = !show;
            if (show) visible += 1;
        });
        const empty = $('#instEmpty');
        if (empty) empty.hidden = visible > 0;
    }

    /* -----------------------------------------------------------------
       浮层
       ----------------------------------------------------------------- */
    function closePopovers() {
        const instPop = $('#instPop');
        const instTrigger = $('#instPicker');
        if (instPop) instPop.hidden = true;
        if (instTrigger) instTrigger.setAttribute('aria-expanded', 'false');
        const slab = $('.slab--launch');
        if (slab) slab.classList.remove('is-expanded');
        const accountPop = $('#accountPop');
        const accountTrigger = $('#railAvatar');
        if (accountPop) accountPop.hidden = true;
        if (accountTrigger) accountTrigger.setAttribute('aria-expanded', 'false');
    }

    function positionAccountPop() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = pop.offsetWidth || 288;
        const left = Math.min(window.innerWidth - width - 14, rect.right + 12);
        pop.style.left = Math.max(14, left) + 'px';
        pop.style.bottom = Math.max(14, window.innerHeight - rect.bottom - 6) + 'px';
        pop.style.top = 'auto';
    }

    function toggleInstancePicker() {
        const pop = $('#instPop');
        const trigger = $('#instPicker');
        const slab = $('.slab--launch');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            renderInstanceOptions();
            const accountPop = $('#accountPop');
            if (accountPop) accountPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (slab) slab.classList.toggle('is-expanded', willOpen);
    }

    function toggleAccountPopover() {
        const pop = $('#accountPop');
        const trigger = $('#railAvatar');
        if (!pop || !trigger) return;
        const willOpen = pop.hidden;
        if (willOpen) {
            const instPop = $('#instPop');
            if (instPop) instPop.hidden = true;
        }
        pop.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) positionAccountPop();
    }

    /* -----------------------------------------------------------------
       公告：全部已读后的自定义内容（Markdown / XAML）与启动日志
       ----------------------------------------------------------------- */
    const NOTICE_FORMAT_LABEL = { md: 'Markdown', xaml: 'XAML', txt: '纯文本' };
    let noticeSaveTimer = 0;
    let noticeSilentReload = false;

    function saveNoticePrefs() {
        writeStore(STORE.notice, noticePrefs);
    }

    function noticeFormatFromPath(name) {
        const ext = String(name || '').toLowerCase().split('.').pop();
        if (ext === 'xaml' || ext === 'xml') return 'xaml';
        if (ext === 'md' || ext === 'markdown') return 'md';
        return 'txt';
    }

    function hostPost(message) {
        const webview = window.chrome && window.chrome.webview;
        if (webview && typeof webview.postMessage === 'function') {
            webview.postMessage(message);
            return true;
        }
        return false;
    }

    /* ── Markdown ────────────────────────────────────────── */
    function mdInline(text) {
        const codes = [];
        let out = escapeHtml(text);
        out = out.replace(/`([^`]+)`/g, (m, code) => {
            codes.push(code);
            return '\u0001' + (codes.length - 1) + '\u0001';
        });
        out = out
            .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-external rel="noreferrer">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        return out.replace(/\u0001(\d+)\u0001/g, (m, index) => '<code>' + codes[Number(index)] + '</code>');
    }

    function renderMarkdown(src) {
        const blocks = [];
        let text = String(src || '').replace(/\r\n?/g, '\n');

        // 先抽出围栏代码块，避免里面的 #、* 被当成 Markdown 语法
        text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (m, lang, code) => {
            blocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
            return '\n\u0000' + (blocks.length - 1) + '\u0000\n';
        });

        const lines = text.split('\n');
        const out = [];
        let para = [];
        let list = null;

        const flushPara = () => {
            if (!para.length) return;
            out.push('<p>' + mdInline(para.join('\n')) + '</p>');
            para = [];
        };
        const closeList = () => {
            if (!list) return;
            out.push('</' + list + '>');
            list = null;
        };
        const openList = (tag) => {
            if (list === tag) return;
            closeList();
            out.push('<' + tag + '>');
            list = tag;
        };

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                flushPara();
                closeList();
                i += 1;
                continue;
            }

            const placeholder = trimmed.match(/^\u0000(\d+)\u0000$/);
            if (placeholder) {
                flushPara();
                closeList();
                out.push(blocks[Number(placeholder[1])] || '');
                i += 1;
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
            if (heading) {
                flushPara();
                closeList();
                // 面板本身已经有 h2 标题，正文从 h3 起更协调
                const level = Math.min(heading[1].length + 1, 4);
                out.push('<h' + level + '>' + mdInline(heading[2]) + '</h' + level + '>');
                i += 1;
                continue;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushPara();
                closeList();
                out.push('<hr>');
                i += 1;
                continue;
            }

            if (/^>\s?/.test(line)) {
                const quote = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^\s*>\s?/, ''));
                    i += 1;
                }
                flushPara();
                closeList();
                out.push('<blockquote>' + mdInline(quote.join('\n')) + '</blockquote>');
                continue;
            }

            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (ul || ol) {
                flushPara();
                openList(ul ? 'ul' : 'ol');
                out.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
                i += 1;
                continue;
            }

            para.push(line);
            i += 1;
        }

        flushPara();
        closeList();
        return out.join('\n');
    }

    /* ── XAML（只解析文字相关的安全子集） ─────────────────── */
    function renderXaml(src) {
        let doc = null;
        try {
            doc = new DOMParser().parseFromString(String(src || ''), 'application/xml');
        } catch (err) {
            doc = null;
        }

        if (!doc || (doc.getElementsByTagName && doc.getElementsByTagName('parsererror').length)) {
            return '<pre><code>' + escapeHtml(src) + '</code></pre>';
        }

        const textOf = (el) => (el.getAttribute('Text') || el.getAttribute('Content') || '').trim();

        const inlineOf = (el) => {
            const parts = [];
            Array.from(el.childNodes).forEach((child) => {
                if (child.nodeType === 3) {
                    const value = child.nodeValue;
                    if (value.trim()) parts.push(escapeHtml(value));
                    return;
                }
                if (child.nodeType !== 1) return;

                const name = child.localName;
                if (name === 'LineBreak') {
                    parts.push('<br>');
                    return;
                }

                const inner = inlineOf(child);
                if (name === 'Bold' || name === 'B') parts.push('<strong>' + inner + '</strong>');
                else if (name === 'Italic' || name === 'I') parts.push('<em>' + inner + '</em>');
                else if (name === 'Underline' || name === 'U') parts.push('<u>' + inner + '</u>');
                else if (name === 'Hyperlink') {
                    const uri = child.getAttribute('NavigateUri') || '';
                    if (/^https?:\/\//i.test(uri)) {
                        parts.push('<a href="' + escapeHtml(uri) + '" data-external rel="noreferrer">' + inner + '</a>');
                    } else {
                        parts.push(inner);
                    }
                } else if (name === 'Run' || name === 'Span' || name === 'Label') {
                    parts.push(textOf(child) ? escapeHtml(textOf(child)) : inner);
                } else {
                    parts.push(inner);
                }
            });
            return parts.join('');
        };

        const blockOf = (el) => {
            const name = el.localName;

            if (name === 'TextBlock') {
                const attrText = textOf(el);
                const text = attrText ? escapeHtml(attrText) : inlineOf(el);
                if (!text) return '';
                const style = (el.getAttribute('Style') || '').toLowerCase();
                const size = Number(el.getAttribute('FontSize')) || 0;
                let tag = 'p';
                if (/title/.test(style) || size >= 22) tag = 'h2';
                else if (/subtitle/.test(style) || size >= 17) tag = 'h3';
                else if (el.getAttribute('FontWeight') === 'Bold' && attrText.length <= 40) tag = 'h3';
                return '<' + tag + '>' + text + '</' + tag + '>';
            }

            if (name === 'Separator') return '<hr>';

            if (name === 'Image') {
                const alt = el.getAttribute('Alt') || el.getAttribute('ToolTip') || '图片';
                return '<p class="xaml-note">[图片：' + escapeHtml(alt) + ']</p>';
            }

            if (/^(Button|CheckBox|RadioButton|ComboBoxItem|ListItem|ListBoxItem|Chip)$/.test(name)) {
                const attrText = textOf(el);
                const text = attrText ? escapeHtml(attrText) : inlineOf(el);
                return text ? '<span class="xaml-chip">' + text + '</span>' : '';
            }

            const direct = textOf(el);
            if (direct) return '<p>' + escapeHtml(direct) + '</p>';

            const inner = Array.from(el.childNodes).map((child) => {
                if (child.nodeType === 3) {
                    const value = child.nodeValue.trim();
                    return value ? '<p>' + escapeHtml(value) + '</p>' : '';
                }
                return child.nodeType === 1 ? blockOf(child) : '';
            }).join('');

            return inner ? '<div class="xaml-block">' + inner + '</div>' : '';
        };

        const root = doc.documentElement;
        if (!root) return '';
        return blockOf(root) || '<p class="xaml-note">XAML 中没有可显示的文字。</p>';
    }

    /* ── 公告视图 ────────────────────────────────────────── */
    function noticeIsCustom() {
        const panel = $('#noticePanel');
        return Boolean(panel && panel.classList.contains('is-custom'));
    }

    function getNoticeIds() {
        return $$('.notice-item[data-notice-id]').map((item) => item.dataset.noticeId);
    }

    function readNoticeIds() {
        return readArray(STORE.noticeRead, []);
    }

    function noticesAllRead() {
        const ids = getNoticeIds();
        if (!ids.length) return false;
        const read = new Set(readNoticeIds());
        return ids.every((id) => read.has(id));
    }

    function markAllNoticesRead() {
        $$('.notice-item').forEach((item) => item.classList.remove('is-unread'));
        const count = $('#unreadCount');
        if (count) count.textContent = '0 条未读';

        const read = new Set(readNoticeIds());
        getNoticeIds().forEach((id) => read.add(id));
        writeStore(STORE.noticeRead, Array.from(read));
    }

    function restoreNoticeUnread() {
        let unread = 0;
        $$('.notice-item').forEach((item) => {
            const isUnread = item.dataset.noticeUnread === 'true';
            item.classList.toggle('is-unread', isUnread);
            if (isUnread) unread += 1;
        });
        const count = $('#unreadCount');
        if (count) count.textContent = unread + ' 条未读';
    }

    function initNoticeView() {
        const title = $('#noticeTitle');
        if (noticesAllRead()) {
            if (title) title.textContent = '自定义内容';
            showNoticeCustom();
            return;
        }
        restoreNoticeUnread();
        if (title) title.textContent = '公告';
        showNoticeDefault();
    }

    function renderNoticeBody() {
        const body = $('#noticeBody');
        if (!body) return;

        const isFile = noticePrefs.source === 'file';
        const raw = isFile ? noticePrefs.fileText : noticePrefs.preset;
        const format = isFile ? noticePrefs.fileFormat : noticePrefs.format;
        const label = NOTICE_FORMAT_LABEL[format] || String(format || '').toUpperCase() || '文本';

        const badge = $('#noticeSourceBadge');
        if (badge) badge.textContent = (isFile ? '本地文件' : '空白预设') + ' · ' + label;

        if (!raw || !String(raw).trim()) {
            body.innerHTML = '<div class="notice-empty">' +
                '<span>' + (isFile ? '还没有选择本地文件，或文件内容为空。' : '空白预设还没有内容。') + '</span>' +
                '<button class="btn btn-tonal btn-sm" type="button" data-notice-config>去设置里填写自定义内容</button>' +
                '</div>';
            return;
        }

        if (format === 'xaml') body.innerHTML = renderXaml(raw);
        else if (format === 'md') body.innerHTML = renderMarkdown(raw);
        else body.innerHTML = '<pre><code>' + escapeHtml(raw) + '</code></pre>';
    }

    function showNoticeCustom() {
        const panel = $('#noticePanel');
        if (!panel) return;
        panel.classList.add('is-custom');
        const title = $('#noticeTitle');
        if (title) title.textContent = '自定义内容';
        const layout = $('#noticeDefault');
        if (layout) layout.hidden = true;
        const custom = $('#noticeCustom');
        if (custom) custom.hidden = false;
        const toolsDefault = $('#noticeToolsDefault');
        if (toolsDefault) toolsDefault.hidden = true;
        const toolsCustom = $('#noticeToolsCustom');
        if (toolsCustom) toolsCustom.hidden = false;
        // 已全部读完之后公告列表不再存在，返回按钮只用于“预览”场景
        const back = $('#noticeBackBtn');
        if (back) back.hidden = noticesAllRead();
        renderNoticeBody();
        renderLaunchLog();
    }

    function showNoticeDefault() {
        const panel = $('#noticePanel');
        if (!panel) return;
        panel.classList.remove('is-custom');
        const title = $('#noticeTitle');
        if (title) title.textContent = '公告';
        const layout = $('#noticeDefault');
        if (layout) layout.hidden = false;
        const custom = $('#noticeCustom');
        if (custom) custom.hidden = true;
        const toolsDefault = $('#noticeToolsDefault');
        if (toolsDefault) toolsDefault.hidden = false;
        const toolsCustom = $('#noticeToolsCustom');
        if (toolsCustom) toolsCustom.hidden = true;
    }

    /* ── 启动日志 ────────────────────────────────────────── */
    function formatLogTime(ts) {
        const date = new Date(Number(ts) || Date.now());
        return (date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' +
            pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
    }

    function renderLaunchLog() {
        const list = $('#noticeLogList');
        const meta = $('#noticeLogMeta');
        if (!list) return;

        if (!launchLog.length) {
            list.innerHTML = '<p class="notice-log-empty">还没有启动记录。启动一次游戏后，日志会出现在这里。</p>';
            if (meta) meta.textContent = '暂无记录';
            return;
        }

        list.innerHTML = launchLog.map((entry) =>
            '<div class="log-line"><span class="log-time num">' + escapeHtml(formatLogTime(entry.t)) + '</span>' +
            '<span class="log-text">' + escapeHtml(entry.line) + '</span></div>'
        ).join('');
        if (meta) meta.textContent = '共 ' + launchLog.length + ' 行';
        list.scrollTop = list.scrollHeight;
    }

    function recordLaunchLog(line) {
        launchLog.push({ t: Date.now(), line: String(line) });
        while (launchLog.length > 300) launchLog.shift();
        writeStore(STORE.launchLog, launchLog);
        renderLaunchLog();
    }

    function clearLaunchLog() {
        launchLog.length = 0;
        writeStore(STORE.launchLog, launchLog);
        renderLaunchLog();
        toast('启动日志已清空', 'i-info');
    }

    /* ── 设置区 ──────────────────────────────────────────── */
    function renderNoticeSettings() {
        $$('#noticeSourceSeg [data-notice-source]').forEach((btn) => {
            const active = btn.dataset.noticeSource === noticePrefs.source;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });

        const isPreset = noticePrefs.source !== 'file';
        $$('#noticeFormatSeg [data-notice-format]').forEach((btn) => {
            const active = noticePrefs.format === btn.dataset.noticeFormat;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
            btn.disabled = !isPreset;
        });

        const editor = $('#noticePresetInput');
        if (editor) {
            if (document.activeElement !== editor) editor.value = noticePrefs.preset;
            editor.disabled = !isPreset;
        }

        const path = $('#noticeFilePath');
        if (path) {
            path.textContent = noticePrefs.filePath
                ? noticePrefs.filePath
                : (noticePrefs.fileName ? noticePrefs.fileName + '（未记录路径）' : '未选择文件');
        }
    }

    function scheduleNoticeSave() {
        window.clearTimeout(noticeSaveTimer);
        noticeSaveTimer = window.setTimeout(() => {
            saveNoticePrefs();
            const hint = $('#noticePresetHint');
            if (hint) {
                hint.textContent = '已自动保存 · 最后修改 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
            }
        }, 350);
    }

    function setNoticeFile(result, silent) {
        if (!result) return;
        if (result.canceled) {
            if (!silent) toast('已取消选择文件', 'i-info');
            return;
        }
        if (!result.ok) {
            if (!silent) toast('读取公告文件失败：' + (result.error || '未知错误'), 'i-info');
            return;
        }

        noticePrefs.source = 'file';
        noticePrefs.filePath = result.path || '';
        noticePrefs.fileName = result.name || '';
        noticePrefs.fileText = result.text || '';
        noticePrefs.fileFormat = noticeFormatFromPath(result.name || result.path);
        saveNoticePrefs();
        renderNoticeSettings();
        if (noticeIsCustom()) renderNoticeBody();
        if (!silent) toast('已载入公告文件：' + (result.name || '本地文件'), 'i-folder');
    }

    function pickNoticeFile() {
        noticeSilentReload = false;
        if (hostPost({ type: 'pick-notice-file' })) return;
        const input = $('#noticeFileInput');
        if (input) input.click();
    }

    function reloadNoticeFile() {
        if (!noticePrefs.filePath) {
            toast('还没有选择本地文件', 'i-info');
            return;
        }
        noticeSilentReload = false;
        if (!hostPost({ type: 'read-notice-file', path: noticePrefs.filePath })) {
            toast('当前环境无法直接读取本地路径，请重新选择文件', 'i-info');
        }
    }

    function openNoticeSettings() {
        go('settings');
        setSettingsTab('notice');
    }

    /* -----------------------------------------------------------------
       启动流程
       ----------------------------------------------------------------- */
    function clearLaunchTimers() {
        launchTimers.forEach((timer) => window.clearTimeout(timer));
        launchTimers = [];
    }

    function appendLaunchLog(line) {
        const log = $('#launchLog');
        if (log) {
            const p = document.createElement('p');
            p.textContent = line;
            log.appendChild(p);
            log.scrollTop = log.scrollHeight;
        }
        // 同一条日志同时写入公告栏下方的启动日志历史
        recordLaunchLog(line);
    }

    function closeLaunch() {
        const modal = $('#launchModal');
        const wasRunning = launchState === 'running';
        clearLaunchTimers();
        launchState = 'idle';
        if (modal) {
            modal.hidden = true;
            modal.classList.remove('is-done');
        }
        if (wasRunning) toast('已取消启动', 'i-info');
        if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
            lastFocus.focus({ preventScroll: true });
        }
        lastFocus = null;
    }

    function startLaunch() {
        const inst = activeInstance();
        const modal = $('#launchModal');
        if (!modal) return;

        clearLaunchTimers();
        lastFocus = document.activeElement;
        launchState = 'running';
        modal.hidden = false;
        modal.classList.remove('is-done');

        const title = $('#launchTitle');
        const meta = $('#launchMeta');
        const bar = $('#launchBar');
        const status = $('#launchStatus');
        const pct = $('#launchPct');
        const log = $('#launchLog');
        const goBtn = $('#launchGo');
        const cancel = $('#launchCancel');

        if (title) title.textContent = inst.name;
        if (meta) meta.textContent = inst.loaderName + ' · Minecraft ' + inst.mc + ' · ' + inst.mem + ' GB · Java ' + inst.java;
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            void bar.offsetWidth;
            bar.style.transition = '';
        }
        if (status) status.textContent = '正在准备启动…';
        if (pct) pct.textContent = '0%';
        if (log) log.innerHTML = '';
        if (goBtn) goBtn.hidden = true;
        if (cancel) cancel.textContent = '取消';

        const steps = [
            { p: 16, label: '正在校验游戏文件…', log: '· 校验 ' + (inst.mods > 0 ? '1,284' : '684') + ' 个文件' },
            { p: 42, label: '正在加载加载器与模组…', log: '· ' + inst.loaderName + ' · ' + modsLabel(inst) },
            { p: 66, label: '正在分配内存…', log: '· 分配 ' + inst.mem + ' GB 堆内存 · Java ' + inst.java },
            { p: 88, label: '正在启动 Java 进程…', log: '· ' + inst.path },
            { p: 100, label: '启动完成，等待游戏窗口…', log: '· 游戏窗口即将出现' }
        ];

        steps.forEach((step, index) => {
            const timer = window.setTimeout(() => {
                if (launchState !== 'running') return;
                if (bar) bar.style.width = step.p + '%';
                if (pct) pct.textContent = step.p + '%';
                if (status) status.textContent = step.label;
                appendLaunchLog(step.log);
                if (index === steps.length - 1) {
                    launchState = 'done';
                    modal.classList.add('is-done');
                    if (title) title.textContent = '启动完成';
                    if (goBtn) goBtn.hidden = false;
                    if (cancel) cancel.textContent = '关闭';
                    if (goBtn) goBtn.focus({ preventScroll: true });
                }
            }, 540 * (index + 1));
            launchTimers.push(timer);
        });

        if (cancel) cancel.focus({ preventScroll: true });
    }

    /* -----------------------------------------------------------------
       下载
       ----------------------------------------------------------------- */
    function findDownloadItem(id) {
        return DOWNLOADS.find((entry) => entry.id === id) ||
            VERSIONS.find((entry) => entry.id === id) ||
            MODS.find((entry) => entry.id === id) ||
            MODPACKS.find((entry) => entry.id === id) ||
            RESOURCES.find((entry) => entry.id === id) ||
            SHADERS.find((entry) => entry.id === id);
    }

    function downloadStateLabel(cat, state) {
        if (state === 'done') return (cat === 'resource' || cat === 'shader') ? '已下载' : '已安装';
        if (state === 'running') return (cat === 'resource' || cat === 'shader') ? '下载中' : '安装中';
        if (state === 'queued') return '队列中';
        if (cat === 'version') return '安装';
        return (CATALOG_META[cat] && CATALOG_META[cat].action) || '安装';
    }

    function renderDownloads() {
        const cat = ui.dlCat;
        const isVersion = cat === 'version';
        const isCatalog = Boolean(CATALOG_META[cat]);

        const searchField = $('#dlSearchField');
        if (searchField) searchField.hidden = isCatalog;
        const searchInput = $('#dlSearch');
        if (searchInput) searchInput.placeholder = '搜索版本号';

        const versions = $('#dlVersions');
        if (versions) versions.hidden = !isVersion;
        const catalogSearch = $('#catalogSearch');
        if (catalogSearch) catalogSearch.hidden = !isCatalog;
        const catalogList = $('#catalogList');
        if (catalogList) catalogList.hidden = !isCatalog;
        const empty = $('#catalogEmpty');
        if (empty) empty.hidden = true;
        const pager = $('#catalogPager');
        if (pager) pager.hidden = true;

        if (isVersion) {
            renderVersionBrowser();
            return;
        }
        if (isCatalog) renderCatalog();
    }

    function versionRow(v, isLatest) {
        const state = downloadState.get(v.id) || 'idle';
        const disabled = state === 'idle' ? '' : ' disabled';
        const label = downloadStateLabel('version', state);
        const tone = v.tone || { release: 'a', snapshot: 'b', old: 'c', april: 'd' }[v.group] || 'a';
        const meta = isLatest
            ? (v.group === 'release' ? '最新正式版' : '最新预览版') + '，发布于 ' + v.date
            : '发布于 ' + v.date;
        return '<button class="version-row" type="button" data-download="' + v.id + '"' + disabled + '>' +
            '<span class="version-ico tone-' + tone + '" aria-hidden="true"><svg class="icon"><use href="#i-cube"/></svg></span>' +
            '<span class="version-main"><b class="num">' + escapeHtml(v.version) + '</b><small>' + escapeHtml(meta) + '</small></span>' +
            (!isLatest && v.tag ? '<span class="version-tag">' + escapeHtml(v.tag) + '</span>' : '') +
            '<span class="version-size num">' + escapeHtml(v.size) + '</span>' +
            '<span class="version-action' + (state !== 'idle' ? ' is-' + state : '') + '">' + label + '</span>' +
        '</button>';
    }

    function renderVersionBrowser() {
        const query = (($('#dlSearch') && $('#dlSearch').value) || '').trim().toLowerCase();

        const latestHost = $('#dlLatestList');
        if (latestHost) {
            latestHost.innerHTML = LATEST_VERSION_IDS
                .map((id) => VERSIONS.find((v) => v.id === id))
                .filter(Boolean)
                .map((v) => versionRow(v, true))
                .join('');
        }

        let total = 0;
        const groupsHost = $('#dlVersionGroups');
        if (groupsHost) {
            groupsHost.innerHTML = VERSION_GROUPS.map((group) => {
                const items = group.items.filter((v) => !query || v.version.toLowerCase().indexOf(query) !== -1);
                if (!items.length) return '';
                total += items.length;
                const open = query ? true : versionOpen.has(group.key);
                return '<section class="version-group' + (open ? '' : ' is-collapsed') + '" data-vgroup="' + group.key + '">' +
                    '<button class="version-group-head" type="button" aria-expanded="' + open + '">' +
                        '<span class="vg-label">' + escapeHtml(group.label) + '</span>' +
                        '<span class="vg-note">' + escapeHtml(group.note) + '</span>' +
                        '<span class="vg-count">' + items.length + ' 个版本</span>' +
                        '<svg class="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
                    '</button>' +
                    '<div class="version-group-body">' +
                        items.map((v) => versionRow(v, false)).join('') +
                    '</div>' +
                '</section>';
            }).join('');
        }

        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + (query ? total : versionTotal) + ' 个版本';

        const latestPanel = $('.dl-latest');
        if (latestPanel) latestPanel.hidden = Boolean(query);
    }

    function catalogSupportsVersion(item, query) {
        const value = String(query || '').trim();
        if (!value) return true;
        const versions = item.versions || '';
        if (versions.indexOf(value) !== -1) return true;
        // 只有带 + 的范围才按“最低版本”比较，精确版本不接受更高的小版本
        if (versions.indexOf('+') === -1) return false;
        const min = (versions.match(/\d+(\.\d+)?/) || [])[0];
        const target = parseFloat(value);
        return min !== undefined && !Number.isNaN(target) && target >= parseFloat(min);
    }

    function catalogTypes(item) {
        if (item.types) return item.types;
        if (item.loaders) return item.loaders;
        return item.cat ? [item.cat] : [];
    }

    function catalogMatches(item, filter) {
        const query = (filter.name || '').trim().toLowerCase();
        if (query) {
            const haystack = [item.name, item.en || '', item.cat || '', item.desc || ''].join(' ').toLowerCase();
            if (haystack.indexOf(query) === -1) return false;
        }
        if (filter.source && filter.source !== 'all' && item.source !== filter.source) return false;
        if (filter.type && filter.type !== 'all' && catalogTypes(item).indexOf(filter.type) === -1) return false;
        return catalogSupportsVersion(item, filter.version);
    }

    function catalogRow(item, cat) {
        const state = downloadState.get(item.id) || 'idle';
        const disabled = state === 'idle' ? '' : ' disabled';
        const label = downloadStateLabel(cat, state);
        const progress = state === 'running' ? '<span class="dl-progress"><i></i></span>' : '';
        const meta = item.meta || ((item.loaders ? item.loaders.join(' / ') + ' · ' : '') + (item.versions || ''));
        return '<article class="mod-row' + (state !== 'idle' ? ' is-' + state : '') + '">' +
            '<span class="mod-row-tile tone-' + (item.tone || 'a') + '" aria-hidden="true">' + escapeHtml(item.tile) + '</span>' +
            '<div class="mod-row-main">' +
                '<div class="mod-row-title">' +
                    '<b>' + escapeHtml(item.name) + '</b>' +
                    (item.en ? '<span class="mod-en">' + escapeHtml(item.en) + '</span>' : '') +
                    '<span class="mod-cat">' + escapeHtml(item.cat) + '</span>' +
                '</div>' +
                '<div class="mod-row-desc">' + escapeHtml(item.desc) + '</div>' +
                '<div class="mod-row-meta">' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-layers"/></svg>' + escapeHtml(meta) + '</span>' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>' + escapeHtml(item.downloads) + '</span>' +
                    '<span><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>' + escapeHtml(item.updated) + '</span>' +
                    '<span class="mod-source"><svg class="icon" aria-hidden="true"><use href="#i-cloud"/></svg>' + escapeHtml(item.source) + '</span>' +
                '</div>' +
                progress +
            '</div>' +
            '<div class="mod-row-side">' +
                '<button class="btn btn-tonal btn-sm" type="button" data-download="' + item.id + '"' + disabled + '>' + label + '</button>' +
            '</div>' +
        '</article>';
    }

    function syncCatalogForm() {
        const cat = ui.dlCat;
        const meta = CATALOG_META[cat];
        if (!meta) return;
        const state = catalogState[cat];

        const title = $('#catalogTitle');
        if (title) title.textContent = meta.title;
        const name = $('#catalogName');
        if (name) {
            name.placeholder = meta.placeholder;
            name.value = state.name || '';
        }
        const source = $('#catalogSource');
        if (source) source.value = state.source || 'all';
        const version = $('#catalogVersion');
        if (version) version.value = state.version || '';
        const type = $('#catalogType');
        if (type) {
            type.innerHTML = meta.types
                .map(([value, label]) => '<option value="' + value + '">' + escapeHtml(label) + '</option>')
                .join('');
            type.value = state.type || 'all';
        }
    }

    function pagerHtml(totalPages, current) {
        const pages = [];
        for (let p = 1; p <= totalPages; p += 1) {
            pages.push('<button class="pager-page' + (p === current ? ' is-active' : '') + '" type="button" data-page="' + p + '"' +
                (p === current ? ' aria-current="page"' : '') + '>' + p + '</button>');
        }
        return '<button class="pager-btn" type="button" data-page="prev"' + (current <= 1 ? ' disabled' : '') + '>上一页</button>' +
            '<span class="pager-pages">' + pages.join('') + '</span>' +
            '<button class="pager-btn" type="button" data-page="next"' + (current >= totalPages ? ' disabled' : '') + '>下一页</button>';
    }

    function renderCatalog() {
        const cat = ui.dlCat;
        const meta = CATALOG_META[cat];
        if (!meta) return;
        const state = catalogState[cat];
        const items = (CATALOG[cat] || []).filter((item) => catalogMatches(item, state));
        const totalPages = Math.max(1, Math.ceil(items.length / CATALOG_PAGE_SIZE));
        state.page = Math.min(Math.max(1, state.page), totalPages);
        catalogPageCount = totalPages;

        const start = (state.page - 1) * CATALOG_PAGE_SIZE;
        const pageItems = items.slice(start, start + CATALOG_PAGE_SIZE);

        const host = $('#catalogList');
        if (host) host.innerHTML = pageItems.map((item) => catalogRow(item, cat)).join('');

        const empty = $('#catalogEmpty');
        if (empty) empty.hidden = items.length > 0;

        const count = $('#dlCount');
        if (count) count.textContent = '共 ' + items.length + ' 个 ' + meta.noun;

        const pager = $('#catalogPager');
        if (pager) {
            if (items.length > CATALOG_PAGE_SIZE) {
                pager.hidden = false;
                pager.innerHTML = pagerHtml(totalPages, state.page);
            } else {
                pager.hidden = true;
                pager.innerHTML = '';
            }
        }
    }

    function applyCatalogFilter() {
        const cat = ui.dlCat;
        const state = catalogState[cat];
        if (!state) return;
        state.name = ($('#catalogName') && $('#catalogName').value) || '';
        state.source = ($('#catalogSource') && $('#catalogSource').value) || 'all';
        state.version = ($('#catalogVersion') && $('#catalogVersion').value) || '';
        state.type = ($('#catalogType') && $('#catalogType').value) || 'all';
        state.page = 1;
        renderCatalog();
    }

    function resetCatalogFilter() {
        const cat = ui.dlCat;
        const state = catalogState[cat];
        if (!state) return;
        state.name = '';
        state.source = 'all';
        state.version = '';
        state.type = 'all';
        state.page = 1;
        syncCatalogForm();
        renderCatalog();
        toast('搜索条件已重置', 'i-refresh');
    }

    function renderQueue() {
        const host = $('#dlQueue');
        if (!host) return;
        host.innerHTML = queue.map((item) => {
            const value = item.progress;
            const pctText = item.state === 'queued' ? '等待中' : value + '%';
            return '<div class="queue-item">' +
                '<div class="queue-top"><b>' + escapeHtml(item.name) + '</b><span class="num">' + pctText + '</span></div>' +
                '<div class="queue-bar"><i style="width:' + (item.state === 'queued' ? 0 : value) + '%"></i></div>' +
                '<div class="queue-meta"><span>' + escapeHtml(item.phase) + '</span><span>' + escapeHtml(item.eta) + '</span></div>' +
            '</div>';
        }).join('');
        const count = $('#queueCount');
        if (count) count.textContent = queue.length + ' 项';
    }

    function startDownload(id) {
        const item = findDownloadItem(id);
        if (!item) return;
        const state = downloadState.get(id);
        if (state === 'queued' || state === 'running') return;
        if (state === 'done') downloadState.delete(id);

        downloadState.set(id, 'queued');
        renderDownloads();
        toast('已加入安装队列：' + item.name, 'i-download');

        queue.push({ id: 'q-' + id, name: item.name, phase: '排队中 · 0 B/s', eta: '—', progress: 0, state: 'queued' });
        renderQueue();

        window.setTimeout(() => {
            if (downloadState.get(id) !== 'queued') return;
            downloadState.set(id, 'running');
            renderDownloads();
            const entry = queue.find((q) => q.id === 'q-' + id);
            if (entry) { entry.state = 'running'; entry.phase = 'assets · 11.8 MB/s'; entry.eta = '约 1 分钟'; entry.progress = 34; renderQueue(); }
        }, 520);
        window.setTimeout(() => {
            if (downloadState.get(id) !== 'running') return;
            downloadState.set(id, 'done');
            renderDownloads();
            const entry = queue.find((q) => q.id === 'q-' + id);
            if (entry) { entry.progress = 100; entry.phase = '下载完成 · 正在解压'; entry.eta = '已完成'; renderQueue(); }
            toast('安装完成：' + item.name, 'i-check');
        }, 2400);
    }

    function setDownloadCategory(category) {
        ui.dlCat = category;
        writeStore(STORE.uiPrefs, ui);
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === category;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        if (CATALOG_META[category]) syncCatalogForm();
        renderDownloads();
    }

    function selectSource(name) {
        ui.source = name;
        writeStore(STORE.uiPrefs, ui);
        $$('.source').forEach((btn) => {
            const active = btn.dataset.source === name;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('[data-dl-source]').forEach((btn) => {
            const active = btn.dataset.dlSource === name;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
    }

    /* -----------------------------------------------------------------
       设置：外观
       ----------------------------------------------------------------- */
    let paletteSignature = '';
    let wallpaperSignature = '';
    let themeFrame = 0;
    let pendingThemePatch = null;

    /*
     * 滑杆的 input 事件一帧可能触发多次。这里合并成一次主题更新，
     * 并且不写 localStorage；松手时再 persist()，避免拖动时反复序列化。
     */
    function queueThemeUpdate(patch) {
        pendingThemePatch = Object.assign(pendingThemePatch || {}, patch);
        if (themeFrame) return;
        themeFrame = requestAnimationFrame(() => {
            themeFrame = 0;
            const next = pendingThemePatch;
            pendingThemePatch = null;
            if (next) window.StarTheme.update(next, { silent: true, persist: false });
        });
    }

    function renderPalette() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;
        const tokens = theme.tokens;

        /*
         * 色板条、源色圆点、变体 chip 只在真正影响颜色的设置变化时重建；
         * 玻璃/模糊/泛光滑杆只改 CSS 变量，不再整块重排。
         */
        const signature = [
            state.seed, state.variant, state.mode, theme.mode, state.contrast,
            state.roles.accent, state.roles.selected, state.roles.hero
        ].join('|');

        if (signature !== paletteSignature) {
            paletteSignature = signature;

            const strip = $('#paletteStrip');
            if (strip) {
                const ramp = tokens ? tokens.ramp : null;
                const groups = ramp
                    ? [['primary', ramp.primary], ['secondary', ramp.secondary], ['tertiary', ramp.tertiary], ['neutral', ramp.neutral]]
                    : [];
                strip.innerHTML = groups.map(([name, tones]) =>
                    '<div class="palette-lane" data-lane="' + name + '">' +
                        tones.map((hex) => '<span style="background:' + hex + '" title="' + name + ' ' + hex + '"></span>').join('') +
                    '</div>'
                ).join('');
            }

            const swatches = $('#seedSwatches');
            if (swatches) {
                swatches.innerHTML = theme.seeds.map((seed) =>
                    '<button class="swatch' + (seed.value === state.seed ? ' is-active' : '') + '" type="button" role="radio" aria-checked="' + (seed.value === state.seed) + '" data-seed="' + seed.value + '" title="' + seed.label + '" style="--swatch:' + seed.value + '"></button>'
                ).join('');
            }

            const chips = $('#variantChips');
            if (chips) {
                chips.innerHTML = theme.variants.map((variant) =>
                    '<button class="chip-toggle' + (variant.id === state.variant ? ' is-active' : '') + '" type="button" role="radio" aria-checked="' + (variant.id === state.variant) + '" data-variant="' + variant.id + '">' + variant.label + '</button>'
                ).join('');
            }

            $$('#modeSeg [data-mode]').forEach((btn) => {
                const active = btn.dataset.mode === state.mode;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', String(active));
            });
            $$('#rolePicker .role-row').forEach((row) => {
                const slot = row.dataset.role;
                $$('[data-role-value]', row).forEach((btn) => {
                    const active = btn.dataset.roleValue === (state.roles[slot] || 'primary');
                    btn.classList.toggle('is-active', active);
                    btn.setAttribute('aria-pressed', String(active));
                });
            });
        }

        const seedLabel = $('#seedLabel');
        if (seedLabel) {
            const variantLabel = (theme.variants.find((v) => v.id === state.variant) || { label: '' }).label;
            seedLabel.textContent = '源色 ' + state.seed.toUpperCase() + ' · ' + variantLabel + '变体 · ' + (theme.mode === 'dark' ? '深色' : '浅色');
        }

        const seedPick = $('#seedPick');
        if (seedPick) seedPick.value = state.seed;

        renderPaletteValues();
    }

    function renderPaletteValues() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;

        const paint = (inputSel, valueSel, value, format) => {
            const input = $(inputSel);
            const label = $(valueSel);
            if (input) { input.value = String(value); paintRange(input); }
            if (label) label.textContent = format(value);
        };
        paint('#glassRange', '#glassValue', state.glass, (v) => v + '%');
        paint('#blurRange', '#blurValue', state.blur, (v) => v + ' px');
        paint('#glowRange', '#glowValue', state.glow, (v) => v + '%');
        paint('#contrastRange', '#contrastValue', state.contrast, (v) => (v > 0 ? '+' : '') + v);

        const perf = $('#perfSwitch');
        if (perf) perf.setAttribute('aria-checked', String(Boolean(state.performance)));
        const blurInput = $('#blurRange');
        if (blurInput) blurInput.disabled = Boolean(state.performance);
        const glowInput = $('#glowRange');
        if (glowInput) glowInput.disabled = Boolean(state.performance);
    }

    function renderWallpaperUI() {
        const theme = window.StarTheme;
        if (!theme) return;
        const state = theme.state;
        const library = theme.library || [];

        const signature = library.map((item) => item.url).join('|') + '#' + state.wallpaper + '#' + (state.libraryError || '');
        if (signature !== wallpaperSignature) {
            wallpaperSignature = signature;
            const grid = $('#wallpaperGrid');
            if (grid) {
                if (!library.length) {
                    grid.innerHTML = '<p class="wallpaper-empty">' +
                        escapeHtml(state.libraryError || '壁纸文件夹里还没有图片。把 jpg / png / webp 放进去，再点“重新扫描”。') +
                    '</p>';
                } else {
                    grid.innerHTML = library.map((item) => {
                        const active = item.url === state.wallpaper;
                        return '<button class="wallpaper-item' + (active ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + active + '" data-wallpaper="' + escapeHtml(item.url) + '" title="' + escapeHtml(item.name) + '">' +
                            '<img src="' + escapeHtml(item.url) + '" loading="lazy" decoding="async" alt="">' +
                            '<span>' + escapeHtml(item.name) + '</span>' +
                        '</button>';
                    }).join('');
                }
            }
        }

        const rotate = $('#wpRotateSwitch');
        if (rotate) rotate.setAttribute('aria-checked', String(Boolean(state.wallpaperRotate)));
        $$('#wpModeSeg [data-wp-mode]').forEach((btn) => {
            const active = btn.dataset.wpMode === state.wallpaperMode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('#wpIntervalSeg [data-wp-interval]').forEach((btn) => {
            const active = Number(btn.dataset.wpInterval) === Number(state.wallpaperInterval);
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
    }

    function bindAppearanceRange(inputSel, key, format) {
        const input = $(inputSel);
        if (!input) return;
        paintRange(input);
        input.addEventListener('input', () => {
            const value = Number(input.value);
            queueThemeUpdate({ [key]: value });
            const label = $(inputSel.replace('Range', 'Value'));
            if (label && format) label.textContent = format(value);
            paintRange(input);
        });
        input.addEventListener('change', () => {
            window.StarTheme.persist();
            renderPalette();
            toast('已保存：' + input.getAttribute('aria-label'), 'i-check');
        });
    }

    /* -----------------------------------------------------------------
       设置：启动选项 / 内存分配 / 高级选项
       ----------------------------------------------------------------- */
    const LAUNCH_TOTAL_MEM = 23.6;
    const LAUNCH_USED_MEM = 14.9;

    function launchAllocatedMem() {
        if (launchPrefs.memMode === 'auto') {
            return Math.max(2, Math.min(12, Math.round((LAUNCH_TOTAL_MEM - LAUNCH_USED_MEM) * 0.6)));
        }
        return Math.max(2, Math.min(20, Number(launchPrefs.mem) || 8));
    }

    function paintLaunchMemory() {
        const auto = launchPrefs.memMode === 'auto';
        const value = launchAllocatedMem();
        const range = $('#launchMemRange');
        const label = $('#launchMemValue');
        const usedLabel = $('#memUsedLabel');
        const gameLabel = $('#memGameLabel');
        const usedBar = $('#memMeterUsed');
        const gameBar = $('#memMeterGame');

        if (range) {
            range.disabled = auto;
            range.value = String(auto ? value : (Number(launchPrefs.mem) || 8));
            paintRange(range);
        }
        if (label) label.textContent = value + ' GB';
        if (gameLabel) gameLabel.textContent = value + ' GB';
        if (usedLabel) {
            usedLabel.textContent = LAUNCH_USED_MEM.toFixed(1) + ' GB / ' + LAUNCH_TOTAL_MEM.toFixed(1) + ' GB';
        }

        const usedPct = Math.min(100, (LAUNCH_USED_MEM / LAUNCH_TOTAL_MEM) * 100);
        const gamePct = Math.min(100 - usedPct, (value / LAUNCH_TOTAL_MEM) * 100);
        if (usedBar) usedBar.style.width = usedPct + '%';
        if (gameBar) {
            gameBar.style.left = usedPct + '%';
            gameBar.style.width = gamePct + '%';
        }
    }

    function bindLaunchSettings() {
        const save = () => writeStore(STORE.launchPrefs, launchPrefs);
        const setValue = (sel, value) => {
            const el = $(sel);
            if (el) el.value = value;
        };
        const setChecked = (sel, value) => {
            const el = $(sel);
            if (el) el.checked = Boolean(value);
        };

        setValue('#launchIsolation', launchPrefs.isolation || 'all');
        setValue('#launchWindowTitle', launchPrefs.windowTitle || '');
        setValue('#launchCustomInfo', launchPrefs.customInfo || '');
        setValue('#launchVisibility', launchPrefs.visibility || 'unchanged');
        setValue('#launchPriority', launchPrefs.priority || 'normal');
        setValue('#launchWindowMode', launchPrefs.windowMode || 'custom');
        setValue('#launchWinW', launchPrefs.winW || 854);
        setValue('#launchWinH', launchPrefs.winH || 480);
        setValue('#launchJvmArgs', launchPrefs.jvmArgs || '');
        setValue('#launchGameArgs', launchPrefs.gameArgs || '');
        setValue('#launchPreCommand', launchPrefs.preCommand || '');
        setValue('#launchJavaList', launchPrefs.javaList || 'java21');
        setValue('#launchMemManager', launchPrefs.memoryManager || 'g1');
        setChecked('#launchMemOptimize', launchPrefs.memOptimize !== false);
        setChecked('#launchDisableWrapper', Boolean(launchPrefs.disableWrapper));
        setChecked('#launchDisableUnsafe', Boolean(launchPrefs.disableUnsafe));
        setChecked('#launchHighPerfGpu', launchPrefs.highPerfGpu !== false);
        setChecked('#launchMemAuto', launchPrefs.memMode !== 'custom');
        setChecked('#launchMemCustom', launchPrefs.memMode === 'custom');

        const syncWindowSize = () => {
            const modeEl = $('#launchWindowMode');
            const custom = !modeEl || modeEl.value === 'custom';
            ['#launchWinW', '#launchWinH'].forEach((sel) => {
                const el = $(sel);
                if (el) el.disabled = !custom;
            });
        };
        syncWindowSize();

        const bindText = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('input', () => { launchPrefs[key] = el.value; });
            el.addEventListener('change', save);
        };

        bindText('#launchWindowTitle', 'windowTitle');
        bindText('#launchCustomInfo', 'customInfo');
        bindText('#launchJvmArgs', 'jvmArgs');
        bindText('#launchGameArgs', 'gameArgs');
        bindText('#launchPreCommand', 'preCommand');

        const bindSelect = (sel, key, after) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('change', () => {
                launchPrefs[key] = el.value;
                save();
                if (after) after();
            });
        };

        bindSelect('#launchIsolation', 'isolation');
        bindSelect('#launchVisibility', 'visibility');
        bindSelect('#launchPriority', 'priority');
        bindSelect('#launchWindowMode', 'windowMode', syncWindowSize);
        bindSelect('#launchJavaList', 'javaList');
        bindSelect('#launchMemManager', 'memoryManager');

        const bindNumber = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('input', () => { launchPrefs[key] = Number(el.value) || 0; });
            el.addEventListener('change', save);
        };
        bindNumber('#launchWinW', 'winW');
        bindNumber('#launchWinH', 'winH');

        const bindCheck = (sel, key) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('change', () => {
                launchPrefs[key] = el.checked;
                save();
            });
        };
        bindCheck('#launchMemOptimize', 'memOptimize');
        bindCheck('#launchDisableWrapper', 'disableWrapper');
        bindCheck('#launchDisableUnsafe', 'disableUnsafe');
        bindCheck('#launchHighPerfGpu', 'highPerfGpu');

        $$('input[name="launchMemMode"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                launchPrefs.memMode = radio.value;
                if (radio.value === 'custom' && !launchPrefs.mem) launchPrefs.mem = 8;
                if (radio.value === 'auto') launchPrefs.mem = launchAllocatedMem();
                save();
                paintLaunchMemory();
            });
        });

        const memRange = $('#launchMemRange');
        if (memRange) {
            memRange.addEventListener('input', () => {
                launchPrefs.mem = Number(memRange.value);
                paintLaunchMemory();
            });
            memRange.addEventListener('change', () => {
                save();
                toast('已设置游戏内存：' + launchAllocatedMem() + ' GB', 'i-chip');
            });
        }

        const syncSwitch = (label, key) => {
            const btn = $$('.set-panel[data-set-panel="launch"] .switch')
                .find((item) => item.getAttribute('aria-label') === label);
            if (!btn) return;
            btn.setAttribute('aria-checked', String(Boolean(launchPrefs[key])));
            btn.addEventListener('click', () => {
                launchPrefs[key] = btn.getAttribute('aria-checked') === 'true';
                save();
            });
        };
        syncSwitch('启动前检查更新', 'updater');
        syncSwitch('启动完成后最小化窗口', 'minimize');

        const advancedBlock = $('#advancedBlock');
        const advancedToggle = $('#advancedToggle');
        const applyAdvanced = () => {
            if (!advancedBlock || !advancedToggle) return;
            const open = launchPrefs.advancedOpen !== false;
            advancedBlock.classList.toggle('is-collapsed', !open);
            advancedToggle.setAttribute('aria-expanded', String(open));
        };
        applyAdvanced();
        if (advancedToggle) {
            advancedToggle.addEventListener('click', () => {
                launchPrefs.advancedOpen = launchPrefs.advancedOpen === false;
                save();
                applyAdvanced();
            });
        }

        const note = $('#advancedNote');
        if (note) note.hidden = launchPrefs.advancedNote === false;
        const noteClose = $('#advancedNoteClose');
        if (noteClose) {
            noteClose.addEventListener('click', () => {
                launchPrefs.advancedNote = false;
                save();
                if (note) note.hidden = true;
            });
        }

        const javaRefresh = $('#launchJavaRefresh');
        if (javaRefresh) {
            javaRefresh.addEventListener('click', () => {
                javaRefresh.classList.remove('is-spin');
                void javaRefresh.offsetWidth;
                javaRefresh.classList.add('is-spin');
                toast('正在重新扫描本机 Java…', 'i-refresh');
            });
        }

        if (launchPrefs.memMode === 'auto') {
            launchPrefs.mem = launchAllocatedMem();
            save();
        }

        paintLaunchMemory();
    }

    /* -----------------------------------------------------------------
       设置：分组切换
       ----------------------------------------------------------------- */
    function setSettingsTab(tab) {
        ui.setTab = tab;
        writeStore(STORE.uiPrefs, ui);
        $$('#setNav [data-set-nav]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.setNav === tab));
        $$('[data-set-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.setPanel === tab));
        const stage = $('#stage');
        if (stage) stage.scrollTop = 0;
    }

    /* -----------------------------------------------------------------
       绑定
       ----------------------------------------------------------------- */
    function bind() {
        /* 全局点击委托 */
        document.addEventListener('click', (event) => {
            const nav = event.target.closest('[data-nav]');
            if (nav) {
                event.preventDefault();
                go(nav.dataset.nav);
                return;
            }
            const navLink = event.target.closest('[data-nav-link]');
            if (navLink) {
                event.preventDefault();
                go(navLink.dataset.navLink);
                return;
            }
            const toastBtn = event.target.closest('[data-toast]');
            if (toastBtn) toast(toastBtn.dataset.toast);

            const copyJvm = event.target.closest('[data-copy-jvm]');
            if (copyJvm) {
                const code = $('#launchJvmArgs');
                const text = code ? code.value.trim() : '';
                if (navigator.clipboard && text) {
                    navigator.clipboard.writeText(text).then(() => toast('JVM 参数已复制'), () => toast('复制失败，请手动选择', 'i-info'));
                } else {
                    toast('当前环境不支持剪贴板写入', 'i-info');
                }
            }

            const seedBtn = event.target.closest('[data-seed]');
            if (seedBtn) window.StarTheme.update({ seed: seedBtn.dataset.seed });

            const variantBtn = event.target.closest('[data-variant]');
            if (variantBtn) window.StarTheme.update({ variant: variantBtn.dataset.variant });

            /*
             * 注意：这里必须限定在 #modeSeg 内查找。
             * 明暗模式同时写到了 <html data-mode> 上，而 <html> 是所有元素的祖先，
             * 用 closest('[data-mode]') 会让页面任意一次点击都命中它 ——
             * 表现就是「点哪里都会弹出主题色已切换」（旧版踩过的同一个坑）。
             */
            const modeBtn = event.target.closest('#modeSeg [data-mode]');
            if (modeBtn) {
                window.StarTheme.update({ mode: modeBtn.dataset.mode });
                toast('明暗模式：' + ({ auto: '跟随系统', light: '浅色', dark: '深色' })[modeBtn.dataset.mode], 'i-palette');
            }

            const roleBtn = event.target.closest('[data-role-value]');
            if (roleBtn) {
                const row = roleBtn.closest('.role-row');
                const slot = row ? row.dataset.role : null;
                if (slot) {
                    const patch = { roles: Object.assign({}, window.StarTheme.state.roles) };
                    patch.roles[slot] = roleBtn.dataset.roleValue;
                    window.StarTheme.update(patch);
                }
            }

            const instOption = event.target.closest('[data-pick]');
            if (instOption) {
                selectInstance(instOption.dataset.pick, { toast: true });
                closePopovers();
                const picker = $('#instPicker');
                if (picker) picker.focus({ preventScroll: true });
            }

            const downloadBtn = event.target.closest('[data-download]');
            if (downloadBtn) {
                event.preventDefault();
                startDownload(downloadBtn.dataset.download);
            }

            const wallpaperBtn = event.target.closest('[data-wallpaper]');
            if (wallpaperBtn) {
                window.StarTheme.selectWallpaper(wallpaperBtn.dataset.wallpaper).then((ok) => {
                    if (ok) toast('已切换壁纸', 'i-image');
                    else toast('壁纸加载失败，文件可能已被移动', 'i-info');
                });
            }

            const wpModeBtn = event.target.closest('[data-wp-mode]');
            if (wpModeBtn) {
                window.StarTheme.update({ wallpaperMode: wpModeBtn.dataset.wpMode });
                renderWallpaperUI();
                toast('壁纸切换方式：' + (wpModeBtn.dataset.wpMode === 'random' ? '随机' : '顺序'), 'i-image');
            }

            const wpIntervalBtn = event.target.closest('[data-wp-interval]');
            if (wpIntervalBtn) {
                const minutes = Number(wpIntervalBtn.dataset.wpInterval);
                window.StarTheme.update({ wallpaperInterval: minutes });
                renderWallpaperUI();
                toast('壁纸每 ' + minutes + ' 分钟切换一次', 'i-refresh');
            }

            if (!event.target.closest('#instPop') && !event.target.closest('#instPicker')) {
                const pop = $('#instPop');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    const trigger = $('#instPicker');
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
            if (!event.target.closest('#accountPop') && !event.target.closest('#railAvatar')) {
                const pop = $('#accountPop');
                if (pop && !pop.hidden) {
                    pop.hidden = true;
                    const trigger = $('#railAvatar');
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }
            }
        });

        window.addEventListener('hashchange', applyRoute);
        window.addEventListener('resize', () => {
            const pop = $('#accountPop');
            if (pop && !pop.hidden) positionAccountPop();
        });

        /* 时钟 */
        tickClock();
        window.setInterval(tickClock, 20000);
        detectHost();

        /* 标题栏 */
        $$('.tb-btn[data-win]').forEach((btn) => {
            btn.addEventListener('click', () => handleWindowControl(btn.dataset.win));
        });

        /* 实例选择器 */
        const instPicker = $('#instPicker');
        if (instPicker) {
            instPicker.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleInstancePicker();
            });
        }

        /* 账户浮层 */
        const railAvatar = $('#railAvatar');
        if (railAvatar) {
            railAvatar.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleAccountPopover();
            });
        }
        const accountPop = $('#accountPop');
        if (accountPop) {
            accountPop.addEventListener('click', (event) => {
                if (event.target.closest('.pop-item, .link')) closePopovers();
            });
        }

        /* 版本列表：事件委托，列表是动态渲染的 */
        const instList = $('#instList');
        if (instList) {
            instList.addEventListener('click', (event) => {
                if (event.target.closest('[data-toast]')) return;
                const row = event.target.closest('[data-instance-row]');
                if (row) selectInstance(row.dataset.instanceRow);
            });
            instList.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const row = event.target.closest('[data-instance-row]');
                if (!row) return;
                event.preventDefault();
                selectInstance(row.dataset.instanceRow);
            });
        }

        const instSearch = $('#instSearch');
        if (instSearch) instSearch.addEventListener('input', filterInstances);
        $$('[data-inst-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                ui.instFilter = btn.dataset.instFilter;
                writeStore(STORE.uiPrefs, ui);
                $$('[data-inst-filter]').forEach((item) => {
                    const active = item === btn;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
                filterInstances();
            });
        });

        /* 内存滑杆（主页 + 详情页同一份数据） */
        ['#homeMemRange', '#vMemRange'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            paintRange(input);
            input.addEventListener('input', () => {
                const inst = activeInstance();
                inst.mem = Number(input.value);
                syncMem(inst);
                paintRange(input);
            });
            input.addEventListener('change', () => {
                toast('已为「' + activeInstance().name + '」分配 ' + activeInstance().mem + ' GB 内存', 'i-chip');
            });
        });

        /* 启动 */
        $$('[data-launch]').forEach((btn) => btn.addEventListener('click', startLaunch));
        $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeLaunch));
        const launchGo = $('#launchGo');
        if (launchGo) {
            launchGo.addEventListener('click', () => {
                const inst = activeInstance();
                closeLaunch();
                toast('已进入「' + inst.name + '」', 'i-play');
            });
        }

        /* 下载 */
        $$('[data-dl-tab]').forEach((btn) => btn.addEventListener('click', () => setDownloadCategory(btn.dataset.dlTab)));
        const dlSearch = $('#dlSearch');
        if (dlSearch) dlSearch.addEventListener('input', renderDownloads);

        /* 版本分组折叠 */
        const versionGroups = $('#dlVersionGroups');
        if (versionGroups) {
            versionGroups.addEventListener('click', (event) => {
                const head = event.target.closest('.version-group-head');
                if (!head) return;
                const group = head.closest('.version-group');
                if (!group) return;
                const collapsed = group.classList.toggle('is-collapsed');
                head.setAttribute('aria-expanded', String(!collapsed));
                const key = group.dataset.vgroup;
                if (collapsed) versionOpen.delete(key);
                else versionOpen.add(key);
            });
        }

        /* 社区资源搜索 */
        const catalogSearchBtn = $('#catalogSearchBtn');
        if (catalogSearchBtn) catalogSearchBtn.addEventListener('click', applyCatalogFilter);
        const catalogResetBtn = $('#catalogResetBtn');
        if (catalogResetBtn) catalogResetBtn.addEventListener('click', resetCatalogFilter);
        ['#catalogName', '#catalogVersion'].forEach((sel) => {
            const input = $(sel);
            if (!input) return;
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyCatalogFilter();
            });
        });

        const catalogPager = $('#catalogPager');
        if (catalogPager) {
            catalogPager.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-page]');
                if (!btn) return;
                const state = catalogState[ui.dlCat];
                if (!state) return;
                const value = btn.dataset.page;
                if (value === 'prev') state.page = Math.max(1, state.page - 1);
                else if (value === 'next') state.page = Math.min(catalogPageCount, state.page + 1);
                else state.page = Number(value) || 1;
                renderCatalog();
            });
        }

        $$('.source').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.source)));
        $$('[data-dl-source]').forEach((btn) => btn.addEventListener('click', () => selectSource(btn.dataset.dlSource)));

        /* 设置：通用开关 */
        $$('.switch:not(#perfSwitch):not(#wpRotateSwitch)').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('aria-checked') !== 'true';
                btn.setAttribute('aria-checked', String(next));
                const label = btn.getAttribute('aria-label') || '选项';
                toast(label + (next ? ' 已开启' : ' 已关闭'), next ? 'i-check' : 'i-info');
            });
        });

        /* 设置：性能模式 */
        const perfSwitch = $('#perfSwitch');
        if (perfSwitch) {
            perfSwitch.addEventListener('click', () => {
                const next = !window.StarTheme.state.performance;
                window.StarTheme.update({ performance: next });
                renderPalette();
                toast(next ? '性能模式已开启：模糊与泛光已关闭' : '性能模式已关闭', 'i-palette');
            });
        }

        /* 设置：外观滑杆 */
        bindAppearanceRange('#glassRange', 'glass', (v) => v + '%');
        bindAppearanceRange('#blurRange', 'blur', (v) => v + ' px');
        bindAppearanceRange('#glowRange', 'glow', (v) => v + '%');
        bindAppearanceRange('#contrastRange', 'contrast', (v) => (v > 0 ? '+' : '') + v);

        /* 设置：启动选项 */
        bindLaunchSettings();

        /* 设置：并发数 */
        const concurrency = $('#concurrency');
        if (concurrency) {
            concurrency.value = String(launchPrefs.concurrency);
            paintRange(concurrency);
            const update = () => {
                const label = $('#concurrencyValue');
                if (label) label.textContent = concurrency.value;
                paintRange(concurrency);
                launchPrefs.concurrency = Number(concurrency.value);
                writeStore(STORE.launchPrefs, launchPrefs);
            };
            concurrency.addEventListener('input', update);
            update();
        }

        /* 设置：标题栏按钮位置 */
        $$('[data-win-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const center = btn.dataset.winStyle === 'center';
                const titlebar = $('#titlebar');
                if (titlebar) titlebar.classList.toggle('controls-center', center);
                $$('[data-win-style]').forEach((item) => {
                    const active = item === btn;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-pressed', String(active));
                });
            });
        });

        /* 设置：分组 */
        $$('#setNav [data-set-nav]').forEach((btn) => {
            btn.addEventListener('click', () => setSettingsTab(btn.dataset.setNav));
        });

        /* 设置：恢复默认 */
        const resetAll = $('#resetAll');
        if (resetAll) {
            resetAll.addEventListener('click', () => {
                window.StarTheme.update({
                    seed: '#7c6ce6', variant: 'tonalSpot', mode: 'auto', contrast: 0,
                    roles: { accent: 'primary', selected: 'primary', hero: 'primary' },
                    glass: 55, blur: 18, glow: 18, performance: false
                });
                renderPalette();
                toast('已恢复默认外观', 'i-refresh');
            });
        }

        /* 设置：壁纸库 */
        const wallpaperOpen = $('#wallpaperOpen');
        if (wallpaperOpen) {
            wallpaperOpen.addEventListener('click', () => {
                const webview = window.chrome && window.chrome.webview;
                if (webview && typeof webview.postMessage === 'function') {
                    webview.postMessage({ type: 'open-wallpapers' });
                    toast('已打开壁纸文件夹', 'i-folder');
                } else {
                    toast('请通过 StarLaunch 宿主打开壁纸文件夹', 'i-info');
                }
            });
        }

        const wallpaperRefresh = $('#wallpaperRefresh');
        if (wallpaperRefresh) {
            wallpaperRefresh.addEventListener('click', () => {
                toast('正在重新扫描壁纸文件夹…', 'i-refresh');
                window.StarTheme.reloadWallpapers().then((ok) => {
                    if (ok) toast('壁纸库已更新', 'i-check');
                    else toast('没有读取到壁纸文件夹，请通过宿主运行', 'i-info');
                });
            });
        }

        const wpRotate = $('#wpRotateSwitch');
        if (wpRotate) {
            wpRotate.addEventListener('click', () => {
                const next = !window.StarTheme.state.wallpaperRotate;
                window.StarTheme.update({ wallpaperRotate: next });
                renderWallpaperUI();
                toast(next ? '壁纸自动切换已开启' : '壁纸自动切换已关闭', next ? 'i-check' : 'i-info');
            });
        }

        /* 从当前壁纸重新取色 */
        const seedFromWallpaper = $('#seedFromWallpaper');
        if (seedFromWallpaper) {
            seedFromWallpaper.addEventListener('click', () => {
                if (!window.StarTheme.state.wallpaper) {
                    toast('还没有设置壁纸', 'i-info');
                    return;
                }
                toast('正在从壁纸取色…', 'i-palette');
                window.StarTheme.resampleWallpaper().then((ok) => {
                    if (ok) {
                        renderPalette();
                        toast('已从当前壁纸重新取色', 'i-palette');
                    } else {
                        toast('取色失败，已保留当前源色', 'i-info');
                    }
                });
            });
        }

        /* 自定义源色 */
        const seedPick = $('#seedPick');
        if (seedPick) {
            seedPick.addEventListener('input', () => window.StarTheme.update({ seed: seedPick.value }, { silent: true }));
            seedPick.addEventListener('change', () => {
                renderPalette();
                toast('源色已更新为 ' + seedPick.value.toUpperCase(), 'i-palette');
            });
        }

        /* 公告已读 → 持久化状态，之后加载页面直接显示自定义内容 */
        const readAll = $('#readAllBtn');
        if (readAll) {
            readAll.addEventListener('click', () => {
                markAllNoticesRead();
                showNoticeCustom();
                toast('公告已全部已读，之后将显示自定义内容');
            });
        }

        /* 自定义内容设置入口 */
        const noticeEdit = $('#noticeEditBtn');
        if (noticeEdit) noticeEdit.addEventListener('click', openNoticeSettings);

        const noticeBack = $('#noticeBackBtn');
        if (noticeBack) noticeBack.addEventListener('click', showNoticeDefault);

        const noticeResetRead = $('#noticeResetRead');
        if (noticeResetRead) {
            noticeResetRead.addEventListener('click', () => {
                writeStore(STORE.noticeRead, []);
                restoreNoticeUnread();
                showNoticeDefault();
                toast('已重置已读状态，公告列表重新显示', 'i-refresh');
            });
        }

        document.addEventListener('click', (event) => {
            if (event.target.closest('[data-notice-config]')) {
                event.preventDefault();
                openNoticeSettings();
            }
        });

        /* 公告内容来源 / 格式 */
        $$('#noticeSourceSeg [data-notice-source]').forEach((btn) => {
            btn.addEventListener('click', () => {
                noticePrefs.source = btn.dataset.noticeSource;
                saveNoticePrefs();
                renderNoticeSettings();
                if (noticeIsCustom()) renderNoticeBody();
                toast(noticePrefs.source === 'file' ? '公告来源：本地文件' : '公告来源：空白预设', 'i-info');
            });
        });

        $$('#noticeFormatSeg [data-notice-format]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                noticePrefs.format = btn.dataset.noticeFormat;
                saveNoticePrefs();
                renderNoticeSettings();
                if (noticeIsCustom()) renderNoticeBody();
            });
        });

        /* 预设编辑器 */
        const noticeEditor = $('#noticePresetInput');
        if (noticeEditor) {
            noticeEditor.addEventListener('input', () => {
                noticePrefs.preset = noticeEditor.value;
                scheduleNoticeSave();
            });
        }

        const noticePreview = $('#noticePreviewBtn');
        if (noticePreview) {
            noticePreview.addEventListener('click', () => {
                showNoticeCustom();
                go('home');
                toast('已在公告栏预览自定义内容', 'i-info');
            });
        }

        /* 本地文件 */
        const noticePick = $('#noticePickFile');
        if (noticePick) noticePick.addEventListener('click', pickNoticeFile);

        const noticeReload = $('#noticeReloadFile');
        if (noticeReload) {
            noticeReload.addEventListener('click', () => {
                toast('正在重新读取公告文件…', 'i-refresh');
                reloadNoticeFile();
            });
        }

        const noticeFileInput = $('#noticeFileInput');
        if (noticeFileInput) {
            noticeFileInput.addEventListener('change', async () => {
                const file = noticeFileInput.files && noticeFileInput.files[0];
                noticeFileInput.value = '';
                if (!file) return;
                try {
                    const text = await file.text();
                    setNoticeFile({ ok: true, path: '', name: file.name, text: text });
                } catch (err) {
                    toast('读取公告文件失败', 'i-info');
                }
            });
        }

        /* 宿主返回的公告文件内容 */
        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.addEventListener === 'function') {
            window.chrome.webview.addEventListener('message', (event) => {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (err) { return; }
                }
                if (!data || data.type !== 'notice-file') {
                    // 宿主可以持续把真实游戏进程的日志推进来
                    if (data && data.type === 'launch-log' && typeof data.line === 'string') {
                        appendLaunchLog(data.line);
                    }
                    return;
                }
                const silent = noticeSilentReload;
                noticeSilentReload = false;
                setNoticeFile(data, silent);
            });
        }

        /* 启动日志 */
        const logClear = $('#noticeLogClear');
        if (logClear) logClear.addEventListener('click', clearLaunchLog);
        const logSettingsClear = $('#noticeLogSettingsClear');
        if (logSettingsClear) logSettingsClear.addEventListener('click', clearLaunchLog);

        /* 自定义公告里的外链交给系统浏览器 */
        document.addEventListener('click', (event) => {
            const link = event.target.closest('a[data-external]');
            if (!link) return;
            const href = link.getAttribute('href') || '';
            if (!/^https?:\/\//i.test(href)) return;
            event.preventDefault();
            if (!hostPost({ type: 'open-external', url: href })) window.open(href, '_blank', 'noopener');
        });

        /* 换一句 */
        const quoteBtn = $('#quoteBtn');
        if (quoteBtn) {
            quoteBtn.addEventListener('click', () => {
                quoteIndex = (quoteIndex + 1) % QUOTES.length;
                const el = $('#heroQuote');
                if (el) el.textContent = QUOTES[quoteIndex];
                quoteBtn.classList.remove('is-spin');
                void quoteBtn.offsetWidth;
                quoteBtn.classList.add('is-spin');
            });
        }

        /* 后台时暂停装饰动画 */
        document.addEventListener('visibilitychange', () => {
            document.documentElement.classList.toggle('is-idle', document.hidden);
        });

        /* 键盘 */
        document.addEventListener('keydown', (event) => {
            // 屏蔽打开控制台 / 查看源代码的快捷键。
            // 宿主已经关掉 DevTools，这里再兜一层，避免焦点在网页上时被浏览器绕过。
            const key = (event.key || '').toLowerCase();
            if (event.key === 'F12' ||
                (event.ctrlKey && event.shiftKey && ['i', 'j', 'c', 'k'].indexOf(key) !== -1) ||
                (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'u')) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (event.key !== 'Escape') return;
            const modal = $('#launchModal');
            if (modal && !modal.hidden) {
                closeLaunch();
                return;
            }
            closePopovers();
        });
    }

    /* -----------------------------------------------------------------
       初始化
       ----------------------------------------------------------------- */
    function initUiState() {
        const instListFilter = ui.instFilter;
        $$('[data-inst-filter]').forEach((btn) => {
            const active = btn.dataset.instFilter === instListFilter;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        const dlTab = ui.dlCat;
        $$('[data-dl-tab]').forEach((btn) => {
            const active = btn.dataset.dlTab === dlTab;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        $$('.source, [data-dl-source]').forEach((btn) => {
            const value = btn.dataset.source || btn.dataset.dlSource;
            const active = value === ui.source;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        setSettingsTab(ui.setTab || 'appearance');
    }

    function init() {
        bind();
        initUiState();
        renderInstanceList();
        selectInstance(ui.activeId);
        syncCatalogForm();
        renderDownloads();
        renderQueue();
        renderPalette();
        renderWallpaperUI();
        renderNoticeSettings();
        renderLaunchLog();
        initNoticeView();

        // 公告来源是本地文件时，启动时让宿主重新读一遍，改了文件不用手动刷新
        if (noticePrefs.source === 'file' && noticePrefs.filePath) {
            noticeSilentReload = true;
            hostPost({ type: 'read-notice-file', path: noticePrefs.filePath });
        }

        if (window.StarTheme) {
            window.StarTheme.onChange(() => {
                renderPalette();
                renderWallpaperUI();
            });
        }

        if (!location.hash) {
            try { history.replaceState(null, '', '#home'); } catch (err) { /* file:// 下可能被限制 */ }
        }
        applyRoute();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
