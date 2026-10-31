import { reactive, onMounted, onBeforeUnmount } from 'vue'

// 时钟与问候：每隔 20s 刷新一次（与原实现一致）
export function useClock() {
  const now = reactive(tick())
  let timer = null
  function tick() {
    const d = new Date()
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
    const h = d.getHours()
    const pad = (n) => String(n).padStart(2, '0')
    const greeting =
      h < 5 ? '夜深了' :
      h < 11 ? '早上好' :
      h < 13 ? '中午好' :
      h < 18 ? '下午好' : '晚上好'
    return {
      date: (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + week,
      clock: pad(h) + ':' + pad(d.getMinutes()),
      greeting
    }
  }
  onMounted(() => {
    timer = setInterval(() => Object.assign(now, tick()), 20000)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return now
}