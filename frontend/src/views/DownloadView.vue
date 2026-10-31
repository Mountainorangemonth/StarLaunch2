<script setup>
import { useDownloadStore } from '../stores/download'
import { useToastStore } from '../stores/toast'
import Icon from '../components/Icon.vue'
import SegControl from '../components/SegControl.vue'

const store = useDownloadStore()
const toast = useToastStore()

const TABS = [
  { key: 'version', label: '游戏本体' },
  { key: 'modpack', label: '整合包' },
  { key: 'mod', label: '模组' },
  { key: 'resource', label: '资源包' }
]

const SOURCES = [
  { key: 'BMCLAPI', note: '国内镜像 · 12.4 MB/s', pill: '推荐' },
  { key: '官方源', note: 'Mojang · 3.1 MB/s', pill: '' },
  { key: '自定义镜像', note: '尚未配置地址', pill: '' }
]

function stateLabel(item) {
  const s = store.stateOf(item.id)
  if (s === 'done') return '已安装'
  if (s === 'running') return '安装中'
  if (s === 'queued') return '队列中'
  return item.action
}
function rowClass(item) {
  const s = store.stateOf(item.id)
  return s !== 'idle' ? 'is-' + s : ''
}
</script>

<template>
  <section class="view page" id="view-download" data-view="download">
    <header class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">
          <span>DOWNLOAD</span>
          <i class="rule" aria-hidden="true"></i>
          <span class="eyebrow-date">镜像源 · BMCLAPI</span>
        </div>
        <h1 class="page-title">下载中心</h1>
        <p class="page-sub">安装游戏本体、整合包与模组，自动校验文件完整性。</p>
      </div>
      <div class="page-actions">
        <label class="search">
          <svg class="icon"><use href="#i-search"/></svg>
          <input v-model="store.query" type="search" placeholder="搜索版本、整合包…" aria-label="搜索下载内容" autocomplete="off">
        </label>
        <button class="btn btn-ghost" type="button" @click="toast.push('已刷新下载索引')">
          <svg class="icon"><use href="#i-refresh"/></svg>刷新索引
        </button>
      </div>
    </header>

    <div class="dl-layout">
      <div class="dl-main">
        <section class="card dl-feature" style="--d:.05s">
          <div class="dlf-copy">
            <span class="micro">FEATURED · 官方正式版</span>
            <h2>Minecraft 1.21.4 <span>「冬季更新」</span></h2>
            <p>新的苍白橡木林、树脂方块与生物群系，一键安装并自动补全运行库。</p>
            <div class="dlf-actions">
              <button class="btn btn-primary" type="button" @click="store.start('mc-1214')">
                <Icon name="i-play" fill />立即安装
              </button>
              <span class="dlf-note">约 386 MB · 官方源 · Java 21</span>
            </div>
          </div>
          <div class="dlf-art" aria-hidden="true">
            <span class="dlf-orb"></span>
            <span class="dlf-big">1.21</span>
            <svg class="dlf-cube"><use href="#i-cube"/></svg>
          </div>
        </section>

        <div class="dl-toolbar">
          <SegControl v-model="store.category" :options="TABS" aria-label="下载分类" />
          <span class="dl-count">{{ store.countLabel }}</span>
        </div>

        <div class="dl-list" aria-live="polite">
          <article
            v-for="(item, index) in store.filtered"
            :key="item.id"
            class="dl-row"
            :class="rowClass(item)"
            :style="{ '--i': index }"
          >
            <span class="dl-row-tile" :class="item.tone">{{ item.tile }}</span>
            <div class="dl-row-main">
              <div class="dl-row-title">{{ item.name }}<span v-if="item.badge" class="tag-pill">{{ item.badge }}</span></div>
              <div class="dl-row-sub">{{ item.sub }}</div>
              <span v-if="store.stateOf(item.id) === 'running'" class="dl-progress"><i></i></span>
            </div>
            <div class="dl-row-side">
              <span class="dl-size">{{ item.size }}</span>
              <button
                class="btn btn-ghost dl-action"
                :class="{ 'is-done': store.stateOf(item.id) === 'done' }"
                type="button"
                :disabled="store.stateOf(item.id) !== 'idle'"
                @click="store.start(item.id)"
              >{{ stateLabel(item) }}</button>
            </div>
          </article>
        </div>
        <p class="empty-note dl-empty" v-show="store.filtered.length === 0">这个分类下没有匹配内容，试试其他关键词。</p>

        <section class="card history-card" style="--d:.16s">
          <header class="card-head">
            <div class="head-title">
              <h2>下载历史</h2>
              <span class="micro">HISTORY</span>
            </div>
            <button class="link-btn" type="button" @click="toast.push('已清空下载历史')">清空记录</button>
          </header>
          <div class="history-list">
            <div class="history-row">
              <span class="history-icon"><svg class="icon"><use href="#i-download"/></svg></span>
              <div class="history-copy"><b>Minecraft 1.20.1</b><span>2026-10-28 · 官方源 · 386 MB</span></div>
              <span class="status-chip"><i></i>已完成</span>
              <button class="link-btn" type="button" @click="store.start('mc-1201')">重新下载</button>
            </div>
            <div class="history-row">
              <span class="history-icon"><svg class="icon"><use href="#i-copy"/></svg></span>
              <div class="history-copy"><b>NeoForge 20.4.237</b><span>2026-10-26 · BMCLAPI · 18 MB</span></div>
              <span class="status-chip"><i></i>已完成</span>
              <button class="link-btn" type="button" @click="toast.push('已打开安装日志')">查看日志</button>
            </div>
          </div>
        </section>
      </div>

      <aside class="dl-side">
        <section class="card side-card" style="--d:.1s">
          <div class="side-head">
            <h3>下载源</h3>
            <span class="status-mini"><i></i>自动测速</span>
          </div>
          <div class="source-list">
            <button
              v-for="src in SOURCES"
              :key="src.key"
              class="source"
              :class="{ 'is-active': store.source === src.key }"
              type="button"
              :aria-pressed="String(store.source === src.key)"
              @click="store.pickSource(src.key)"
            >
              <span class="radio" aria-hidden="true"></span>
              <span class="source-copy"><b>{{ src.key }}</b><small>{{ src.note }}</small></span>
              <span v-if="src.pill" class="tag-pill">{{ src.pill }}</span>
            </button>
          </div>
        </section>

        <section class="card side-card" style="--d:.16s">
          <div class="side-head">
            <h3>安装队列</h3>
            <span class="micro">2 项</span>
          </div>
          <div class="queue-item">
            <div class="qi-top"><b>Minecraft 1.21.4</b><span>68%</span></div>
            <div class="qi-track"><i style="width:68%"></i></div>
            <div class="qi-meta"><span>assets · 12.4 MB/s</span><span>约 2 分钟</span></div>
          </div>
          <div class="queue-item">
            <div class="qi-top"><b>NeoForge 20.4.237</b><span class="qi-wait">等待中</span></div>
            <div class="qi-track"><i style="width:0%"></i></div>
            <div class="qi-meta"><span>排队中 · 0 B/s</span><span>—</span></div>
          </div>
          <button class="btn btn-ghost qi-clear" type="button" @click="toast.push('已清空已完成的下载任务')">清空已完成</button>
        </section>

        <section class="card tip-card" style="--d:.22s">
          <span class="head-ico"><svg class="icon"><use href="#i-shield"/></svg></span>
          <div>
            <b>只从可信来源安装</b>
            <p>StarLaunch 会对下载文件做 SHA-1 校验，第三方来源请自行确认。</p>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>