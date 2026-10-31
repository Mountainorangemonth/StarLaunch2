<script setup>
// 开关：扮演 button[role=switch]，sm 为小号。label 用于无障碍（aria-label）。
defineProps({
  modelValue: Boolean,
  label: String,
  sm: Boolean,
  disabled: Boolean
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    class="switch"
    :class="{ 'switch--sm': sm }"
    type="button"
    role="switch"
    :aria-checked="String(modelValue)"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  ></button>
</template>