<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SlTag from '../ui/SlTag.vue'

// 主页公告卡：数据由 props 注入，未读态为组件内临时状态，「全部已读」后 emit read-all
const props = defineProps({
  noticeList: { type: Array, required: true }, // [{time, tag:{label,tone}, text, pinned, unread}]
  feature: { type: Object, required: true },   // NOTICE_FEATURE：置顶横幅
  title: { type: String, default: '公告' },
  micro: { type: String, default: 'NOTICE' }
})
const emit = defineEmits(['read-all'])

const router = useRouter()
const unread = ref(props.noticeList.map((n) => !!n.unread))

watch(() => props.noticeList, (list) => { unread.value = list.map((n) => !!n.unread) })

const unreadCount = () => unread.value.filter(Boolean).length

function readAll() {
  unread.value = unread.value.map(() => false)
  emit('read-all')
}

function openFeature() {
  router.push(props.feature.route || '/download')
}
</script>

<template>
  <section class="card notice-card bracket" style="--d:.12s">
    <span class="bracket-corner bracket-corner--tr" aria-hidden="true"></span>
    <span class="bracket-corner bracket-corner--bl" aria-hidden="true"></span>
    <header class="card-head">
      <div class="head-title">
        <h2>{{ title }}</h2>
        <span class="micro">{{ micro }}</span>
      </div>
      <div class="notice-tools">
        <span class="unread-count"><i></i>{{ unreadCount() }} 条未读</span>
        <button class="link-btn" type="button" @click="readAll">全部已读</button>
      </div>
    </header>
    <div class="notice-body">
      <a class="notice-feature" :href="'#/' + (feature.route || '').replace(/^\//, '')" :aria-label="feature.aria || feature.kicker" @click.prevent="openFeature">
        <span class="nf-sun"></span>
        <span class="nf-cloud nf-cloud--1"></span>
        <span class="nf-cloud nf-cloud--2"></span>
        <span class="nf-ground"></span>
        <svg class="nf-cube" aria-hidden="true"><use href="#i-cube"/></svg>
        <span class="nf-sheen" aria-hidden="true"></span>
        <span class="nf-content">
          <span class="nf-kicker">{{ feature.kicker }}</span>
          <strong><template v-for="(line, i) in feature.titleLines" :key="i">{{ line }}<br v-if="i < feature.titleLines.length - 1" /></template></strong>
          <span class="nf-date">{{ feature.date }}</span>
        </span>
      </a>
      <ul class="notice-list">
        <li v-for="(n, i) in noticeList" :key="i" class="notice-item" :class="{ 'is-unread': unread[i] }">
          <span class="notice-time">{{ n.time }}</span>
          <SlTag :label="n.tag.label" :tone="n.tag.tone" />
          <p>{{ n.text }}</p>
          <span v-if="n.pinned" class="pin">置顶</span>
        </li>
      </ul>
    </div>
  </section>
</template>