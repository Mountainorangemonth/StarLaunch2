<script setup>
// 玻璃卡片壳：标题 + micro 眉标（可选），右侧工具由 headerAfter 插槽注入；body 为默认插槽。
// 外部 class / style（如 --d 动画延时）会自动合并到根元素 .card。
defineProps({
  title: String,
  micro: String
})
</script>

<template>
  <section class="card">
    <header v-if="title || micro || $slots.headerAfter || $slots.head" class="card-head">
      <div v-if="title || micro || $slots.head" class="head-title">
        <slot name="head">
          <h2 v-if="title">{{ title }}</h2>
          <span v-if="micro" class="micro">{{ micro }}</span>
        </slot>
      </div>
      <div v-if="$slots.headerAfter" class="head-actions"><slot name="headerAfter" /></div>
    </header>
    <slot />
  </section>
</template>