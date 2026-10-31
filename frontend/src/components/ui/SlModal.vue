<script setup>
// 弹窗壳：.modal 遮罩 + .modal-card，内容（例如 launch-head / 按钮行）由默认插槽自理。
// closable 为 true 时点击背景遮罩触发 close。
defineProps({
  open: Boolean,
  closable: Boolean
})
const emit = defineEmits(['close'])
</script>

<template>
  <div class="modal" v-show="open" role="dialog" aria-modal="String(open)">
    <div class="modal-backdrop" @click="closable && emit('close')"></div>
    <div class="modal-card"><slot /></div>
  </div>
</template>