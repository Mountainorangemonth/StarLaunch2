<script setup>
import { nextTick, ref, watch } from 'vue'
import { useLaunchStore } from '../stores/launch'

const store = useLaunchStore()
const cancelBtn = ref(null)
const goBtn = ref(null)
const logEl = ref(null)

watch(() => store.open, async (open) => {
  if (open) {
    await nextTick()
    if (cancelBtn.value) cancelBtn.value.focus({ preventScroll: true })
  }
})

watch(() => store.done, async (done) => {
  if (done) {
    await nextTick()
    if (goBtn.value) goBtn.value.focus({ preventScroll: true })
  }
})

// 日志滚动到底（log 数组就地 push，需监听长度变化）
watch(() => store.log.length, () => {
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
})
</script>

<template>
  <div class="modal" v-show="store.open">
    <div class="modal-backdrop" @click="store.close()"></div>
    <div class="modal-card" :class="{ 'is-done': store.done }" role="dialog" aria-modal="true" aria-labelledby="launchTitle">
      <div class="launch-head">
        <span class="launch-orb"><svg class="icon icon--fill"><use href="#i-play"/></svg></span>
        <div class="launch-head-copy">
          <span class="micro">LAUNCHING</span>
          <h2 id="launchTitle">{{ store.title }}</h2>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="store.close()">
          <svg class="icon"><use href="#i-close"/></svg>
        </button>
      </div>
      <p class="launch-meta" id="launchMeta">{{ store.meta }}</p>
      <div class="launch-progress"><i :style="{ width: store.pct + '%' }"></i></div>
      <div class="launch-status"><span id="launchStatus">{{ store.status }}</span><b id="launchPct">{{ store.pct }}%</b></div>
      <div ref="logEl" class="launch-log" id="launchLog">
        <p v-for="(line, i) in store.log" :key="i">{{ line }}</p>
      </div>
      <div class="launch-actions">
        <button ref="cancelBtn" class="btn btn-ghost" type="button" @click="store.close()">
          {{ store.done ? '关闭' : '取消' }}
        </button>
        <button ref="goBtn" class="btn btn-primary" type="button" v-show="store.done" @click="store.enter()">进入游戏</button>
      </div>
    </div>
  </div>
</template>