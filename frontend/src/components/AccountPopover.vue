<script setup>
import { nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useUiStore } from '../stores/ui'
import { useToastStore } from '../stores/toast'

const props = defineProps({ open: Boolean })

const ui = useUiStore()
const toast = useToastStore()
const pop = ref(null)

// 与原实现一致：相对 rail-avatar 定位，并在窗口尺寸变化/打开时重算
function position() {
  const el = pop.value
  const trigger = document.querySelector('#railAvatar')
  if (!el || !trigger) return
  const rect = trigger.getBoundingClientRect()
  const width = el.offsetWidth || 280
  const left = Math.min(window.innerWidth - width - 12, rect.right + 14)
  el.style.left = Math.max(12, left) + 'px'
  el.style.bottom = Math.max(12, window.innerHeight - rect.bottom - 4) + 'px'
}

watch(() => props.open, async (open) => {
  if (open) {
    await nextTick()
    position()
  }
})

function act(message) { toast.push(message) }

onMounted(() => window.addEventListener('resize', position))
onBeforeUnmount(() => window.removeEventListener('resize', position))
</script>

<template>
  <div ref="pop" class="popover account-pop" role="menu" aria-label="账户菜单" v-show="open">
    <div class="pop-head">
      <span class="avatar avatar--sm"><svg class="steve" aria-hidden="true"><use href="#art-steve"/></svg></span>
      <div>
        <div class="pop-name">MoonlitSteve</div>
        <div class="pop-sub">微软账户 · 正版</div>
      </div>
      <span class="tag-pro">已登录</span>
    </div>
    <div class="pop-list">
      <button class="pop-item" type="button" role="menuitem" @click="ui.accountOpen = false; act('打开微软账户登录窗口')">
        <svg class="icon"><use href="#i-user"/></svg><span>切换账户</span>
      </button>
      <button class="pop-item" type="button" role="menuitem" @click="ui.accountOpen = false; act('正在刷新皮肤…')">
        <svg class="icon"><use href="#i-refresh"/></svg><span>刷新皮肤</span>
      </button>
      <button class="pop-item" type="button" role="menuitem" @click="ui.accountOpen = false; act('已打开游戏目录')">
        <svg class="icon"><use href="#i-folder"/></svg><span>打开游戏目录</span>
      </button>
      <button class="pop-item" type="button" role="menuitem" @click="ui.accountOpen = false; act('已打开账户设置')">
        <svg class="icon"><use href="#i-sliders"/></svg><span>账户设置</span>
      </button>
    </div>
    <div class="pop-foot">
      <span class="micro">UUID 6F2A…9C1D</span>
      <button class="link-btn" type="button" @click="ui.accountOpen = false; act('打开账户管理页面')">管理账户</button>
    </div>
  </div>
</template>