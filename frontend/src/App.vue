<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppearanceStore } from './stores/appearance'
import { useUiStore } from './stores/ui'
import { useLaunchStore } from './stores/launch'
import { useWallpaperStore } from './stores/wallpaper'
import SvgSprite from './components/SvgSprite.vue'
import Wallpaper from './components/Wallpaper.vue'
import TitleBar from './components/TitleBar.vue'
import RailNav from './components/RailNav.vue'
import AccountPopover from './components/AccountPopover.vue'
import LaunchModal from './components/LaunchModal.vue'
import Toasts from './components/Toasts.vue'

const route = useRoute()
const appearance = useAppearanceStore()
const ui = useUiStore()
const launch = useLaunchStore()
const wallpaper = useWallpaperStore()

// 初始化外观（写 html[data-accent] / CSS 变量，不持久化）
appearance.load()
appearance.apply(false)

// 路由切换时收起浮层
watch(() => route.fullPath, () => ui.closeAll())

// 切后台时暂停装饰动画（与原实现一致）
function onVisibility() {
  document.documentElement.classList.toggle('is-hidden', document.hidden)
}

// 点击外部收起浮层
function onDocClick(event) {
  if (!event.target.closest('.inst-pop') && !event.target.closest('#instPicker')) {
    ui.instPickerOpen = false
  }
  if (!event.target.closest('.account-pop') && !event.target.closest('#railAvatar')) {
    ui.accountOpen = false
  }
}

// Esc：先关启动弹窗，再收浮层
function onKeydown(event) {
  if (event.key !== 'Escape') return
  if (launch.open) launch.close()
  else ui.closeAll()
}

// 拖放图片换壁纸
const dropVisible = ref(false)
let dragDepth = 0
function hasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') !== -1
}
function onDragEnter(event) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  dropVisible.value = true
}
function onDragOver(event) {
  if (!hasFiles(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  if (dragDepth > 0) dragDepth -= 1
  if (dragDepth === 0) dropVisible.value = false
}
function onDrop(event) {
  event.preventDefault()
  dragDepth = 0
  dropVisible.value = false
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
  if (file) wallpaper.applyFile(file)
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <SvgSprite />
  <Wallpaper />

  <div class="app-shell">
    <TitleBar />
    <div class="workbench">
      <RailNav />
      <main class="main" id="main">
        <router-view />
      </main>
    </div>
  </div>

  <AccountPopover :open="ui.accountOpen" />
  <LaunchModal />

  <div class="drop-overlay" v-show="dropVisible">
    <div class="drop-card">
      <span class="drop-ico"><svg class="icon"><use href="#i-palette"/></svg></span>
      <b>松开以更换背景</b>
      <span>支持 PNG / JPG / WebP，会自动压缩以降低内存占用</span>
    </div>
  </div>

  <Toasts />
</template>