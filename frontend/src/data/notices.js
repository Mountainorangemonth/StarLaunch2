// 主页公告：feature 为置顶横幅，notices 为列表（unread 为初始未读态）
export const NOTICE_FEATURE = {
  kicker: '安全提醒',
  titleLines: ['请从官网或官方群', '下载安装包'],
  date: '2026-10-19',
  route: '/download', // 横幅点击跳转的目标路由
  aria: '安全提醒：请从官网或官方群下载安装包'
}

export const NOTICES = [
  { time: '10-27', tag: { label: '版本更新', tone: 'update' }, text: 'v1.0.0 正式发布：主页与下载页全新设计', pinned: true, unread: true },
  { time: '10-25', tag: { label: '维护公告', tone: 'maint' }, text: '服务器维护：10 月 26 日 02:00–04:00', pinned: false, unread: true },
  { time: '10-19', tag: { label: '安全提醒', tone: 'security' }, text: '请从官网或官方群下载安装包', pinned: false, unread: false },
  { time: '10-12', tag: { label: '通知', tone: 'note' }, text: '公益版不限制设备绑定，支持多端登录', pinned: false, unread: false },
  { time: '10-05', tag: { label: '版本更新', tone: 'update' }, text: 'v1.0.0：问题修复与启动速度优化', pinned: false, unread: false }
]