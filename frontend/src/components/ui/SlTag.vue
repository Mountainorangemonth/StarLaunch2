<script setup>
// 通知小标签：tone 取 update|maint|security|note，映射为 tag-* 颜色类；内容可用 label 或默认插槽。
defineProps({
  label: { type: String, required: true },
  tone: String
})
</script>

<template>
  <span class="n-tag" :class="tone ? 'tag-' + tone : ''"><slot>{{ label }}</slot></span>
</template>