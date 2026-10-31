<script setup>
// 通用图标：name 指向 sprite 中的 symbol id，fill 常用作按钮内实心图标
defineProps({
  name: String,
  fill: Boolean
})
</script>

<template>
  <svg :class="['icon', { 'icon--fill': fill }]" aria-hidden="true">
    <use :href="name ? '#' + name : undefined" />
  </svg>
</template>