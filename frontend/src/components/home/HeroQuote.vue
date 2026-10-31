<script setup>
import { ref } from 'vue'
import SlIcon from '../ui/SlIcon.vue'

// 主页问候语下的语录：「换一句」轮询动画在本组件内部，文案由外层传入
const props = defineProps({
  quotes: { type: Array, required: true } // [[text, by], ...]
})

const index = ref(0)
const btn = ref(null)

function rotate() {
  if (!props.quotes.length) return
  index.value = (index.value + 1) % props.quotes.length
  const el = btn.value
  if (!el) return
  el.classList.remove('is-spinning')
  void el.offsetWidth
  el.classList.add('is-spinning')
}
</script>

<template>
  <p class="hero-quote">
    <span>{{ quotes[index][0] }}</span>
    <span class="quote-by">{{ quotes[index][1] }}</span>
    <button ref="btn" class="icon-refresh" type="button" aria-label="换一句" title="换一句" @click="rotate">
      <SlIcon name="i-refresh" />
    </button>
  </p>
</template>