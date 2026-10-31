<script setup>
// 分段切换（.seg）：items 为 [{value, label}]，选中项 is-active + aria-pressed；v-model 双向绑定。
defineProps({
  items: { type: Array, required: true },
  modelValue: [String, Number],
  ariaLabel: String
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg" role="group" :aria-label="ariaLabel">
    <button
      v-for="opt in items"
      :key="opt.value"
      type="button"
      :class="{ 'is-active': modelValue === opt.value }"
      :aria-pressed="String(modelValue === opt.value)"
      @click="emit('update:modelValue', opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>