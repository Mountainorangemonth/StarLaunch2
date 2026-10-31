<script setup>
import { computed } from 'vue'

// 分段范围输入：写入 --p 填充进度，可用 v-model；外部 class（如 range--sm）自动合并。
const props = defineProps({
  modelValue: Number,
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  disabled: Boolean
})
const emit = defineEmits(['update:modelValue'])

const pct = computed(() => {
  const base = props.max - props.min
  return base === 0 ? 0 : ((props.modelValue - props.min) / base) * 100
})
</script>

<template>
  <input
    class="range"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    :disabled="disabled"
    :style="{ '--p': pct.toFixed(2) + '%' }"
    @input="emit('update:modelValue', Number($event.target.value))"
  />
</template>