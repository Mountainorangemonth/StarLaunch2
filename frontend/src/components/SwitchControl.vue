<script setup>
// 开关：扮演 button[role=switch]，小号用 sm
defineProps({
  modelValue: Boolean,
  sm: Boolean,
  label: String
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
    @click="emit('update:modelValue', !modelValue)"
  ></button>
</template>