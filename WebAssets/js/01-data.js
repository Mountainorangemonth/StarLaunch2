/* =====================================================================
   StarLaunch · 静态数据与常量表
   ---------------------------------------------------------------------
   还没有接后端的示例数据：版本分组、Mod 目录、语录等。
   ===================================================================== */
(function (global) {
    'use strict';

    const SL = global.SL;

    /* -----------------------------------------------------------------
       数据
       ----------------------------------------------------------------- */
    /* 浏览器里直接预览时的假数据。真正跑在 WebView2 里时会被
       /api/versions 扫出来的真实版本替换掉，这里只是兜底。 */
    const MOCK_INSTANCES = [
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

    // 版本列表：宿主可用时会被 /api/versions 的真实数据替换


    const QUOTES = [
        '方块堆成星海，夜晚就有了归处。',
        '先挖三块木头，再去想远方。',
        '把家建在出生点，把梦建在云端。',
        '世界没有存档，但今天可以重来。',
        '一间木屋，一盏南瓜灯，就够了。',
        '末影人困在矿车里，瞬移就成了一种回忆。',
        '恶魂的火球可以打回去，连它自己也会受伤。',
        '末影人的低语，是人类一句“Hello”被放慢打乱。',
        '金镐挖得比谁都快，却挖不动金和铁。',
        '一桶岩浆烧一百件物品，沉默地烧很久。',
        '向日葵永远朝东，南瓜藤永远朝西北。',
        '末影箱上放TNT，爆炸只带走它自己。',
        '潮涌核心在水下睁开眼，寻找亡灵，再闭上。',
        '美西螈咬一口怪物，你的血条悄悄回来一点。',
        '牛都是母的，所以每一头都能挤奶。',
        '蘑菇岛的怪从不生成，地表和地底都安静。',
        '钻石最早的文件名，叫做绿宝石。',
        '把兔子命名为Toast，它就有了黑白相间的皮毛。',
        '把卫道士命名为Johnny，它见谁打谁。',
        '老版本的海绵吸掉5×5×5的水，像一块沉默的雨。',
        '仙人掌可以种在水里，但不能挨着另一棵仙人掌。',
        '南瓜自然生成的概率，比钻石还低。',
        '按住Shift放箱子，两个箱子就永远不会合并。',
        '雪傀儡的南瓜头，可以用剪刀轻轻摘下来。'
    ];

    const ROUTES = {
        home: { crumb: '启动', title: 'StarLaunch' },
        versions: { crumb: '版本', title: '版本 · StarLaunch' },
        download: { crumb: '下载', title: '下载 · StarLaunch' },
        settings: { crumb: '设置', title: '设置 · StarLaunch' }
    };

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

    SL.data = Object.assign(SL.data || {}, { MOCK_INSTANCES, QUOTES, ROUTES, QUEUE_SEED, VERSION_GROUPS, VERSIONS, LATEST_VERSION_IDS, MODS, MODPACKS, RESOURCES, SHADERS, CATALOG, LOADER_TYPES, CATALOG_META, CATALOG_PAGE_SIZE });
})(window);
