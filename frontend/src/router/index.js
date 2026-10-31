import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import VersionsView from '../views/VersionsView.vue'
import DownloadView from '../views/DownloadView.vue'
import SettingsView from '../views/SettingsView.vue'

// 注意：必须用 hash 模式。HTML5 history 会触发对 https://app.local/<path>
// 的整页导航，宿主无法提供对应资源（404 空页）——见迁移方案“WebView2 加载时机”一节。
const routes = [
  { path: '/', redirect: '/home' },
  {
    path: '/home', name: 'home', component: HomeView,
    meta: { crumb: '启动', title: 'StarLaunch' }
  },
  {
    path: '/versions', name: 'versions', component: VersionsView,
    meta: { crumb: '版本管理', title: '版本管理 · StarLaunch' }
  },
  {
    path: '/download', name: 'download', component: DownloadView,
    meta: { crumb: '下载', title: '下载中心 · StarLaunch' }
  },
  {
    path: '/settings', name: 'settings', component: SettingsView,
    meta: { crumb: '设置', title: '设置 · StarLaunch' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/home' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.afterEach((to) => {
  document.title = (to.meta && to.meta.title) || 'StarLaunch'
  const main = document.querySelector('.main')
  if (main) main.scrollTop = 0
})

export default router