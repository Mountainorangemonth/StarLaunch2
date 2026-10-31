<script setup>
import SlIcon from '../ui/SlIcon.vue'

// 主页快捷操作：操作项由 actions 注入，点击 emit action（由宿主页决定处理）
defineProps({
  actions: { type: Array, required: true }, // [{icon, label, notice}]
  title: { type: String, default: '快捷操作' },
  micro: { type: String, default: 'QUICK' }
})
const emit = defineEmits(['action'])
</script>

<template>
  <section class="card quick-card" style="--d:.2s">
    <div class="quick-head">
      <div class="head-title">
        <h2>{{ title }}</h2>
        <span class="micro">{{ micro }}</span>
      </div>
    </div>
    <div class="quick-grid">
      <button v-for="a in actions" :key="a.label" class="quick-item" type="button" @click="emit('action', a)">
        <span class="quick-ico"><SlIcon :name="a.icon" /></span>
        <span>{{ a.label }}</span>
      </button>
    </div>
  </section>
</template>