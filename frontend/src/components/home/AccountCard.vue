<script setup>
import { computed } from 'vue'
import SlIcon from '../ui/SlIcon.vue'

// 主页账户卡：资料来自 props（变文案改 data/profile.js 即可）
const props = defineProps({
  profile: { type: Object, required: true },
  micro: { type: String, default: 'STAR ACCOUNT' }
})
const emit = defineEmits(['open-home'])

const xpText = computed(() => {
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return fmt(props.profile.xpNow) + ' / ' + fmt(props.profile.xpTotal) + ' XP'
})
</script>

<template>
  <section class="card account-card" style="--d:.08s">
    <svg class="card-watermark" aria-hidden="true"><use href="#i-cube"/></svg>
    <header class="card-head">
      <div class="head-title">
        <span class="micro">{{ micro }}</span>
      </div>
      <div class="head-actions">
        <span class="tag-pro">{{ profile.tagPro }}</span>
        <button class="icon-btn" type="button" aria-label="打开账户主页" title="账户主页" @click="emit('open-home')">
          <SlIcon name="i-external" />
        </button>
      </div>
    </header>
    <div class="acct-line">
      <span class="avatar-ring" :style="{ '--xp': profile.xp + '%' }">
        <span class="avatar">
          <svg class="steve" aria-hidden="true"><use href="#art-steve"/></svg>
          <i class="online-dot" aria-hidden="true"></i>
        </span>
      </span>
      <div class="acct-id-wrap">
        <h2 class="acct-name">{{ profile.name }}</h2>
        <p class="acct-id">{{ profile.id }}</p>
      </div>
    </div>
    <div class="acct-progress">
      <div class="progress"><i :style="{ width: profile.xp + '%' }"></i></div>
      <div class="progress-meta">
        <span>等级 <b>{{ profile.level }}</b> · 经验 {{ profile.xp }}%</span>
        <span>{{ xpText }}</span>
      </div>
    </div>
    <div class="stat-grid">
      <div><span class="micro">状态</span><b class="ok"><i></i>{{ profile.status }}</b></div>
      <div><span class="micro">皮肤</span><b>{{ profile.skins }}</b></div>
      <div><span class="micro">上次登录</span><b>{{ profile.lastLogin }}</b></div>
    </div>
  </section>
</template>