<script setup>
import { ref, onMounted } from 'vue'
import { useWallpaperStore } from '../stores/wallpaper'

const store = useWallpaperStore()
const img = ref(null)

function syncPreview(force) {
  if (!img.value || store.customUrl) return
  const src = img.value.currentSrc || img.value.src
  if (src) store.previewUrl = src
  if (force) store.onLoad()
}

onMounted(() => {
  if (img.value && img.value.complete) {
    if (img.value.naturalWidth > 0) store.onLoad()
    else store.onError()
    syncPreview()
  }
})
</script>

<!-- 背景层：图片放到 assets/wallpaper.png 即可自动替换（也可用设置页即时预览） -->
<template>
  <div class="wallpaper" :class="{ 'is-photo': store.photo }" aria-hidden="true">
    <img
      ref="img"
      class="wallpaper__img"
      :src="store.src"
      alt=""
      decoding="async"
      @load="store.onLoad(); syncPreview()"
      @error="store.onError()"
    />
    <div class="wallpaper__art">
      <span class="art-sky"></span>
      <span class="art-sun"></span>
      <span class="art-aura"></span>
      <span class="cloud cloud--1"></span>
      <span class="cloud cloud--2"></span>
      <span class="cloud cloud--3"></span>
      <span class="cloud cloud--4"></span>
      <span class="art-hills art-hills--back"></span>
      <span class="art-hills art-hills--front"></span>
      <span class="petal petal--1"></span>
      <span class="petal petal--2"></span>
      <span class="petal petal--3"></span>
      <span class="petal petal--4"></span>
      <span class="petal petal--5"></span>
      <span class="art-grain"></span>
    </div>
    <div class="wallpaper__veil"></div>
  </div>
</template>