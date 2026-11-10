静态资源目录
============

这个目录只放需要编进程序集的静态资源（例如随 exe 分发的默认图片）。

用户壁纸在项目根目录的 wallpapers/，运行时由宿主扫描；
exe 同级目录不可写时退回 %LOCALAPPDATA%\StarLaunch\wallpapers。
在设置页点「打开文件夹」即可直接往里放 jpg / png / webp / gif / bmp / avif。

壁纸清单由宿主动态生成（/wallpapers/manifest.json），
支持随机 / 顺序轮播，间隔可选 1、5、10、30 分钟。
