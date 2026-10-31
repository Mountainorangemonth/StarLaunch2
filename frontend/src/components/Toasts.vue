<script setup>
import { useToastStore } from '../stores/toast'
import Icon from './Icon.vue'

const store = useToastStore()
</script>

<template>
  <div class="toasts" aria-live="polite" aria-atomic="false">
    <div v-for="t in store.items" :key="t.id" class="toast" :class="{ 'is-in': !t.closing, 'is-out': t.closing }">
      <Icon :name="t.icon" />
      <span>{{ t.message }}</span>
    </div>
  </div>
</template>