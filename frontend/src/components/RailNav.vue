<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useUiStore } from '../stores/ui'

const router = useRouter()
const route = useRoute()
const ui = useUiStore()

const NAV = [
  { key: 'home', label: '启动', icon: 'i-home' },
  { key: 'versions', label: '版本管理', icon: 'i-layers' },
  { key: 'download', label: '下载', icon: 'i-download' },
  { key: 'settings', label: '设置', icon: 'i-sliders' }
]

function go(key) {
  ui.instPickerOpen = false
  if (route.name === key) return
  router.push('/' + key)
}
</script>

<template>
  <div class="rail-stack">
    <nav class="rail glass" aria-label="主导航">
      <div class="rail-main">
        <button
          v-for="item in NAV"
          :key="item.key"
          class="rail-btn"
          :class="{ 'is-active': route.name === item.key }"
          type="button"
          :aria-label="item.label"
          :aria-current="route.name === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          <svg class="icon"><use :href="'#' + item.icon"/></svg>
          <span class="rail-tip">{{ item.label }}</span>
        </button>
      </div>
    </nav>
    <button
      id="railAvatar"
      class="rail-avatar"
      type="button"
      aria-label="账户菜单"
      :aria-expanded="String(ui.accountOpen)"
      aria-haspopup="menu"
      @click="ui.accountOpen = !ui.accountOpen"
    >
      <span class="avatar avatar--tiny"><svg class="steve" aria-hidden="true"><use href="#art-steve"/></svg></span>
      <i class="online-dot" aria-hidden="true"></i>
      <span class="rail-tip">MoonlitSteve</span>
    </button>
  </div>
</template>