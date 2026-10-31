// 主页「本周游戏」卡默认数据（days.h 为图表高度百分比 0-100）
export const PLAYTIME = {
  total: '12.6',
  unit: '小时',
  delta: '+18%',
  summary: '共 7 次启动 · 最长 3.2 小时',
  days: [
    { w: '一', h: 28, title: '周一 · 0.9 小时' },
    { w: '二', h: 47, title: '周二 · 1.5 小时' },
    { w: '三', h: 31, title: '周三 · 1.0 小时' },
    { w: '四', h: 63, title: '周四 · 2.0 小时', today: true },
    { w: '五', h: 69, title: '周五 · 2.2 小时' },
    { w: '六', h: 100, title: '周六 · 3.2 小时' },
    { w: '日', h: 56, title: '周日 · 1.8 小时' }
  ]
}