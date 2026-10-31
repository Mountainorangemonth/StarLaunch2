<script setup>
// 通用图标：name 指向 sprite 中的 symbol id，fill 常用作按钮内实心图标，size 可显式设宽高
defineProps({
  name: { type: String, required: true },
  size: String,
  fill: Boolean
})
</script>

<template>
  <svg :class="['icon', { 'icon--fill': fill }]" :style="size ? { width: size, height: size } : undefined" aria-hidden="true">
    <use :href="'#' + name" />
  </svg>
</template>