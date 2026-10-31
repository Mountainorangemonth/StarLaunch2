<script setup>
import SlIcon from '../ui/SlIcon.vue'

// 主页「本机配置」卡：数据来自 props；kpi.html/v-html 为受信任静态片段（保留 <small> 单位）
defineProps({
  system: { type: Object, required: true },
  title: { type: String, default: '本机配置' },
  micro: { type: String, default: 'SYSTEM' }
})
const emit = defineEmits(['redetect', 'copy'])
</script>

<template>
  <section class="card system-card" style="--d:.14s">
    <header class="card-head">
      <div class="head-title">
        <h2>{{ title }}</h2>
        <span class="micro">{{ micro }}</span>
      </div>
      <div class="head-actions">
        <span class="head-ico"><SlIcon name="i-monitor" /></span>
        <button class="icon-btn" type="button" aria-label="重新检测" title="重新检测" @click="emit('redetect')">
          <SlIcon name="i-refresh" />
        </button>
      </div>
    </header>
    <p class="sys-sub">{{ system.sub }}</p>
    <div class="kpi-grid">
      <div v-for="k in system.kpis" :key="k.label" class="kpi">
        <b v-html="k.html"></b><span>{{ k.label }}</span>
      </div>
    </div>
    <dl class="spec-list">
      <div v-for="s in system.specs" :key="s.dt" class="spec">
        <dt>{{ s.dt }}</dt><dd>{{ s.dd }}</dd>
      </div>
    </dl>
    <footer class="sys-foot">
      <i class="live-dot" aria-hidden="true"></i>
      <span>{{ system.status }}</span>
      <span class="sys-java">{{ system.java }}</span>
      <button class="link-btn" type="button" @click="emit('copy')">复制配置</button>
    </footer>
  </section>
</template>