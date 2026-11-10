壁纸文件夹
==========

把 jpg / jpeg / png / webp / gif / bmp / avif 图片直接放进这个文件夹即可。
宿主启动后会扫描，设置页「壁纸库」会自动显示缩略图。

- 开发时：这里的图片会随 `dotnet build` 复制到输出目录；
- 运行时：设置页「打开文件夹」打开的是 exe 同级的 wallpapers 目录；
- 如果 exe 装在 Program Files 等只读位置，宿主会自动改用
  %LOCALAPPDATA%\StarLaunch\wallpapers。

自动切换支持随机 / 顺序，间隔可选 1 / 5 / 10 / 30 分钟。
图片不需要改名，也不需要写清单；文件名会直接显示在缩略图下方。
