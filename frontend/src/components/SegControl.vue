<script setup>
// 分段切换（.seg）：options 为 [{key, label}]，选中项 is-active + aria-pressed
defineProps({
  options: { type: Array, required: true },
  modelValue: String,
  cls: { type: String, default: '' },
  ariaLabel: String
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg" :class="cls" role="group" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.key"
      type="button"
      :class="{ 'is-active': modelValue === opt.key }"
      :aria-pressed="String(modelValue === opt.key)"
      @click="emit('update:modelValue', opt.key)"
    >{{ opt.label }}</button>
  </div>
</template>