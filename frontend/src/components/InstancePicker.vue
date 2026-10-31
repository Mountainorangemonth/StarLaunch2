<script setup>
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useInstanceStore, modsLabel } from '../stores/instance'
import { useUiStore } from '../stores/ui'
import SlPopover from './ui/SlPopover.vue'
import SlIcon from './ui/SlIcon.vue'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['picked'])

const router = useRouter()
const store = useInstanceStore()
const ui = useUiStore()
const optionsEl = ref(null)

watch(() => props.open, async (open) => {
  if (open) {
    await nextTick()
    const first = optionsEl.value && optionsEl.value.querySelector('.inst-option')
    if (first) first.focus({ preventScroll: true })
  }
})

function pick(id) {
  store.select(id, { toast: true })
  ui.instPickerOpen = false
  emit('picked')
}
</script>

<template>
  <SlPopover :open="open" class="inst-pop" role="listbox" aria-label="选择实例">
    <div class="pop-headline">
      <span class="micro">选择实例</span>
      <span class="pop-count">{{ store.instances.length }} 个可用</span>
    </div>
    <div ref="optionsEl" class="inst-options">
      <button
        v-for="inst in store.instances"
        :key="inst.id"
        class="inst-option"
        :class="{ 'is-active': inst.id === store.activeId }"
        type="button"
        role="option"
        :aria-selected="String(inst.id === store.activeId)"
        @click="pick(inst.id)"
      >
        <span class="tile" :class="'tile--' + inst.tone"><svg class="cube" aria-hidden="true"><use href="#i-cube"/></svg></span>
        <span class="inst-option-copy">
          <span class="inst-option-title">{{ inst.name }} <span class="badge">{{ inst.tag }}</span></span>
          <span class="inst-option-meta">{{ inst.mc }} · {{ modsLabel(inst) }} · {{ inst.last }}</span>
        </span>
        <SlIcon name="i-check" class="inst-option-check" />
      </button>
    </div>
    <div class="pop-foot">
      <button class="link-btn" type="button" @click="ui.instPickerOpen = false; router.push('/versions')">
        管理全部实例<SlIcon name="i-chevron-right" />
      </button>
    </div>
  </SlPopover>
</template>