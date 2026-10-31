<script setup>
import { computed } from 'vue'
import SlIcon from './SlIcon.vue'

// 属性化按钮：<SlButton text="提示" shadow />。
// variant：primary|ghost|link|icon；size：''|sm|launch；text 与默认插槽二选一。
const props = defineProps({
  text: String,
  icon: String,
  variant: { type: String, default: 'primary' },
  size: { type: String, default: '' },
  shadow: Boolean,
  block: Boolean,
  fill: Boolean,
  disabled: Boolean,
  type: { type: String, default: 'button' }
})
const emit = defineEmits(['click'])

const classes = computed(() => {
  const map = { primary: 'btn-primary', ghost: 'btn-ghost', link: 'link-btn', icon: 'icon-btn' }
  const v = map[props.variant] || 'btn-ghost'
  const out = props.variant === 'link' || props.variant === 'icon' ? [] : ['btn']
  out.push(v)
  if (props.size === 'sm') out.push('btn-sm')
  else if (props.size === 'launch') out.push('btn-launch')
  if (props.shadow) out.push('is-shadow')
  if (props.block) out.push('is-block')
  return out
})
</script>

<template>
  <button
    :class="classes"
    :type="type"
    :disabled="disabled"
    @click.stop="emit('click')"
  >
    <SlIcon v-if="icon" :name="icon" :fill="fill" />
    <slot v-if="$slots.default" />
    <template v-else-if="text">{{ text }}</template>
  </button>
</template>