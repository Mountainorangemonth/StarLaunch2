<script setup>
// 空态提示：默认输出 .empty-note 文案，亦可通过默认插槽放入图标/按钮等富内容。
defineProps({
  text: { type: String, default: '' }
})
</script>

<template>
  <p class="empty-note"><slot>{{ text }}</slot></p>
</template>