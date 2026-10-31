<script setup>
// 浮层壳：仅提供 .popover 外壳 + v-show 显隐，定位/尺寸由使用方自定（如相对触发元素）。
defineProps({
  open: Boolean
})
</script>

<template>
  <div class="popover" v-show="open"><slot /></div>
</template>