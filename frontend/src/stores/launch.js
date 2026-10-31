import { defineStore } from 'pinia'
import { useInstanceStore } from './instance'
import { useToastStore } from './toast'

// 记录启动前获得焦点的元素（普通变量避免被 reactive 代理，Document.contains 需要原生节点）
let lastFocus = null

// 启动模拟步进：与原实现一致的延时与文案（数据为占位，未来接真实逻辑）
export const useLaunchStore = defineStore('launch', {
  state: () => ({
    open: false,
    done: false,
    running: false,
    title: '',
    meta: '',
    pct: 0,
    status: '',
    log: [],
    timers: []
  }),
  actions: {
    start() {
      const inst = useInstanceStore().activeInstance
      this.cancelTimers()
      this.running = true
      this.done = false
      this.open = true
      this.title = '正在启动 ' + inst.name
      this.meta = inst.loader + ' · Minecraft ' + inst.mc + ' · ' + inst.mem + ' GB · Java ' + inst.java
      this.pct = 0
      this.status = '正在准备启动…'
      this.log = []
      lastFocus = document.activeElement

      const steps = [
        { p: 18, label: '正在校验游戏文件…', log: '· 校验 ' + (inst.mods > 0 ? '1,284' : '684') + ' 个文件' },
        { p: 44, label: '正在加载加载器与模组…', log: '· ' + inst.loader + ' · ' + (inst.mods > 0 ? inst.mods + ' 个模组' : '无模组') },
        { p: 68, label: '正在分配内存…', log: '· 分配 ' + inst.mem + ' GB 堆内存 · Java ' + inst.java },
        { p: 90, label: '正在启动 Java 进程…', log: '· ' + inst.path },
        { p: 100, label: '启动完成，等待游戏窗口…', log: '· 游戏窗口即将出现' }
      ]
      steps.forEach((step, index) => {
        this.timers.push(setTimeout(() => {
          if (!this.running) return
          this.pct = step.p
          this.status = step.label
          this.log.push(step.log)
          if (index === steps.length - 1) {
            this.done = true
            this.running = false
            this.title = '启动完成'
          }
        }, 520 * (index + 1)))
      })
    },
    cancelTimers() {
      this.timers.forEach(clearTimeout)
      this.timers = []
    },
    close() {
      const wasRunning = this.running
      this.cancelTimers()
      this.running = false
      this.open = false
      this.done = false
      if (wasRunning) useToastStore().push('已取消启动', 'i-info')
      const el = lastFocus
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus({ preventScroll: true })
      lastFocus = null
    },
    // “进入游戏”：关闭弹窗并提示（数据为占位）
    enter() {
      const inst = useInstanceStore().activeInstance
      this.close()
      useToastStore().push('已进入「' + inst.name + '」，祝你好运', 'i-play')
    }
  }
})