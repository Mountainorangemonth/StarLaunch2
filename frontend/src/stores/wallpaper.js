import { defineStore } from 'pinia'
import { useToastStore } from './toast'

// 背景图片：默认壁纸 / 用户自定义（仅本次预览，不持久化）
export const useWallpaperStore = defineStore('wallpaper', {
  state: () => ({
    src: 'assets/wallpaper.png',
    customUrl: null,
    previewUrl: '',   // 设置页缩略图背景，镜像当前生效的图片
    photo: false
  }),
  actions: {
    set(src) { this.photo = false; this.src = src },
    onLoad() { this.photo = true },
    onError() { this.photo = false },
    reset() {
      if (this.customUrl) URL.revokeObjectURL(this.customUrl)
      this.customUrl = null
      this.previewUrl = ''
      this.photo = false
      this.src = 'assets/wallpaper.png'
    },
    // 与原实现一致的压缩流程：缩宽到 2560、>2.5MB 或超宽则转 WebP
    async applyFile(file) {
      const toast = useToastStore()
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        toast.push('请选择 PNG / JPG / WebP 图片', 'i-info')
        return
      }
      let nextUrl = null
      try {
        const bitmap = await createImageBitmap(file)
        const maxWidth = 2560
        const scale = Math.min(1, maxWidth / bitmap.width)
        const needsCompress = scale < 1 || file.size > 2.5 * 1024 * 1024
        if (needsCompress) {
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const ctx = canvas.getContext('2d', { alpha: false })
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
            if (blob) nextUrl = URL.createObjectURL(blob)
          }
          canvas.width = 0
          canvas.height = 0
        }
        bitmap.close()
      } catch (err) { /* 不支持该图片格式时退回原图 */ }

      if (!nextUrl) nextUrl = URL.createObjectURL(file)
      const previous = this.customUrl
      this.photo = false
      this.src = nextUrl
      this.customUrl = nextUrl
      this.previewUrl = nextUrl
      if (previous) URL.revokeObjectURL(previous)
      toast.push('背景已更新（仅本次预览）', 'i-palette')
    }
  }
})