<script setup>
import { useRoute } from 'vue-router'
import { useUiStore } from '../stores/ui'
import { useWindowControl } from '../composables/useWindowControl'

const route = useRoute()
const ui = useUiStore()
const win = useWindowControl()
</script>

<template>
  <header class="custom-titlebar" :class="{ 'controls-center': ui.titlebarCenter }">
    <div class="tb-brand">
      <span class="tb-logo"><svg class="icon icon--fill"><use href="#i-spark"/></svg></span>
      <span class="tb-name">StarLaunch</span>
      <span class="tb-divider" aria-hidden="true">—</span>
      <span class="tb-crumb">{{ route.meta.crumb || '启动' }}</span>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-status"><i></i><span>已就绪 · 1.0.0</span></div>
    <div class="tb-controls">
      <button class="tb-btn" type="button" aria-label="最小化" title="最小化" @click="win.minimize()">
        <svg class="icon"><use href="#i-minus"/></svg>
      </button>
      <button class="tb-btn" type="button" aria-label="最大化" title="最大化" @click="win.maximize()">
        <svg class="icon"><use href="#i-square"/></svg>
      </button>
      <button class="tb-btn tb-btn--close" type="button" aria-label="关闭" title="关闭" @click="win.close()">
        <svg class="icon"><use href="#i-close"/></svg>
      </button>
    </div>
  </header>
</template>