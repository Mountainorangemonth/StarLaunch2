import { defineStore } from 'pinia'

// 外观设置持久化键，与旧版一致（旧 v1 不再读取）
const KEY = 'starlaunch.appearance.v2'
const ACCENTS = ['blue', 'sakura', 'mint']
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export const DEFAULT_APPEARANCE = { accent: 'blue', blur: 18, glass: 72, veil: 66, performance: false }

export const useAppearanceStore = defineStore('appearance', {
  state: () => ({ ...DEFAULT_APPEARANCE }),
  actions: {
    load() {
      try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          if (ACCENTS.indexOf(parsed.accent) !== -1) this.accent = parsed.accent
          if (Number.isFinite(parsed.blur)) this.blur = clamp(parsed.blur, 0, 40)
          if (Number.isFinite(parsed.glass)) this.glass = clamp(parsed.glass, 40, 92)
          if (Number.isFinite(parsed.veil)) this.veil = clamp(parsed.veil, 0, 100)
          this.performance = parsed.performance === true
        }
      } catch (err) { /* 本地存储不可用时静默使用默认值 */ }
    },
    save() {
      try {
        const { accent, blur, glass, veil, performance } = this
        localStorage.setItem(KEY, JSON.stringify({ accent, blur, glass, veil, performance }))
      } catch (err) { /* 忽略 */ }
    },
    apply(persist) {
      const root = document.documentElement
      root.dataset.accent = this.accent
      root.dataset.performance = this.performance ? 'on' : 'off'
      root.style.setProperty('--blur', this.blur + 'px')
      root.style.setProperty('--glass-a', (this.glass / 100).toFixed(2))
      root.style.setProperty('--veil-a', (this.veil / 100).toFixed(2))
      if (persist) this.save()
    }
  }
})