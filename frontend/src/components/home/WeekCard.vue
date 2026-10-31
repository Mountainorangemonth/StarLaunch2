<script setup>
// 主页「本周游戏」卡：图表高度、每日提示均由 playtime.days 驱动
defineProps({
  playtime: { type: Object, required: true },
  title: { type: String, default: '本周游戏' },
  micro: { type: String, default: 'PLAYTIME' }
})
</script>

<template>
  <section class="card week-card" style="--d:.18s">
    <div class="week-copy">
      <div class="head-title">
        <h2>{{ title }}</h2>
        <span class="micro">{{ micro }}</span>
      </div>
      <div class="week-total"><b>{{ playtime.total }}</b><span>{{ playtime.unit }}</span><em>{{ playtime.delta }}</em></div>
      <p>{{ playtime.summary }}</p>
    </div>
    <div class="week-visual">
      <div class="week-chart" aria-label="每日游戏时长">
        <span
          v-for="d in playtime.days"
          :key="d.w"
          :style="{ '--h': d.h + '%' }"
          :class="{ 'is-today': d.today }"
          :title="d.title"
        ></span>
      </div>
      <div class="week-days" aria-hidden="true">
        <span v-for="d in playtime.days" :key="d.w">{{ d.w }}</span>
      </div>
    </div>
  </section>
</template>