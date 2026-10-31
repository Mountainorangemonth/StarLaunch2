import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 构建产出与既有 .NET 嵌入约定对齐：
//  - base:'./' 让 index.html 用相对路径引用 app.js / style.css
//  - 产物固定名 app.js / style.css，维持 StarLaunch.csproj 的显式嵌入项（StarLaunch.WebAssets.*）
//  - 其余资源进 assets/[name]-[hash]（当前除 wallpaper 静态文件外无其他打包资源）
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: '../WebAssets',
    assetsDir: 'assets',
    cssCodeSplit: false,
    target: 'chrome110',
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? 'style.css' : 'assets/[name]-[hash][extname]'
      }
    }
  }
})