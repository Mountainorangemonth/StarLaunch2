import { defineStore } from 'pinia'

let nextId = 0

export const useToastStore = defineStore('toast', {
  state: () => ({ items: [] }),
  actions: {
    // 与原实现一致：2.6s 后加 is-out，280ms 后移除；超过 4 条直接丢掉最早一条
    push(message, icon) {
      const item = { id: ++nextId, message, icon: icon || 'i-check', closing: false }
      this.items.push(item)
      setTimeout(() => { item.closing = true }, 2600)
      setTimeout(() => {
        const idx = this.items.findIndex((t) => t.id === item.id)
        if (idx > -1) this.items.splice(idx, 1)
      }, 2880)
      if (this.items.length > 4) this.items.shift()
    },
    remove(id) {
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx > -1) this.items.splice(idx, 1)
    }
  }
})