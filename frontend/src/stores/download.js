import { defineStore } from 'pinia'
import { DOWNLOAD_DATA, DOWNLOAD_LABELS } from '../data/downloads'
import { useToastStore } from './toast'

export const useDownloadStore = defineStore('download', {
  state: () => ({
    items: DOWNLOAD_DATA,
    category: 'version',
    query: '',
    source: 'BMCLAPI',
    states: {} // id -> idle | queued | running | done
  }),
  getters: {
    filtered(state) {
      const q = state.query.trim().toLowerCase()
      return state.items.filter((it) => {
        if (it.cat !== state.category) return false
        if (!q) return true
        return (it.name + ' ' + it.sub + ' ' + it.size + ' ' + (it.badge || '')).toLowerCase().indexOf(q) !== -1
      })
    },
    countLabel() {
      return '共 ' + this.filtered.length + ' ' + DOWNLOAD_LABELS[this.category]
    }
  },
  actions: {
    setCategory(c) { this.category = c },
    pickSource(name) { this.source = name },
    stateOf(id) { return this.states[id] || 'idle' },
    start(id) {
      const item = this.items.find((e) => e.id === id)
      if (!item) return
      const st = this.states[id]
      if (st === 'queued' || st === 'running') return
      if (st === 'done') delete this.states[id]
      const toast = useToastStore()
      this.states[id] = 'queued'
      toast.push('已加入安装队列：' + item.name, 'i-download')
      setTimeout(() => {
        if (this.states[id] !== 'queued') return
        this.states[id] = 'running'
      }, 480)
      setTimeout(() => {
        if (this.states[id] !== 'running') return
        this.states[id] = 'done'
        toast.push('安装完成：' + item.name, 'i-check')
      }, 2300)
    }
  }
})