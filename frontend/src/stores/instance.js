import { defineStore } from 'pinia'
import { INSTANCES } from '../data/instances'
import { useToastStore } from './toast'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export const useInstanceStore = defineStore('instance', {
  state: () => ({
    instances: INSTANCES,
    activeId: 'winter',
    instFilter: 'all'
  }),
  getters: {
    activeInstance(state) {
      return state.instances.find((i) => i.id === state.activeId) || state.instances[0]
    },
    // 仅按类型过滤；搜索词在视图层再叠加
    filteredByKind(state) {
      if (state.instFilter === 'all') return state.instances
      return state.instances.filter((i) => i.kind === state.instFilter)
    }
  },
  actions: {
    select(id, opts) {
      if (!this.instances.some((i) => i.id === id)) return
      this.activeId = id
      if (opts && opts.toast) useToastStore().push('已切换到「' + this.activeInstance.name + '」')
    },
    setMem(value) { this.activeInstance.mem = Number(value) },
    setFilter(f) { this.instFilter = f }
  }
})

export function modsLabel(inst) {
  return inst.mods > 0 ? inst.mods + ' 个模组' : '无模组'
}

// 与旧实现一致：内存条宽度 = mem/16，钳制在 4%..100%
export function memPercent(inst) {
  return clamp((inst.mem / 16) * 100, 4, 100).toFixed(1)
}