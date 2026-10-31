<script setup>
import { computed, ref } from 'vue'
import { useInstanceStore, modsLabel } from '../stores/instance'
import { useToastStore } from '../stores/toast'
import { useLaunchStore } from '../stores/launch'
import SlButton from '../components/ui/SlButton.vue'
import SlSeg from '../components/ui/SlSeg.vue'
import SlRange from '../components/ui/SlRange.vue'
import SlSwitch from '../components/ui/SlSwitch.vue'
import SlIcon from '../components/ui/SlIcon.vue'

const store = useInstanceStore()
const toast = useToastStore()
const launch = useLaunchStore()

const query = ref('')
const checked = ref(true)

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'modded', label: '模组整合' },
  { value: 'vanilla', label: '原版' }
]

// 类型过滤（store）+ 搜索词（视图层）与原 filterInstances 一致
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.filteredByKind.filter((inst) => {
    if (!q) return true
    const text = (inst.name + ' ' + inst.mc + ' ' + inst.tag + ' ' + inst.loader).toLowerCase()
    return text.indexOf(q) !== -1
  })
})

const detail = computed(() => store.activeInstance)
const modChips = computed(() => {
  const inst = detail.value
  if (inst.mods <= 0) return []
  const preview = (inst.modPreview || []).slice(0, 3)
  const rest = inst.mods - preview.length
  return [...preview.map((n) => ({ name: n })), ...(rest > 0 ? [{ name: '+' + rest }] : [])]
})

function select(id) {
  store.select(id)
}

function onMem(n) {
  store.setMem(n)
  toast.push('已为「' + detail.value.name + '」分配 ' + n + ' GB 内存', 'i-memory')
}
</script>

<template>
  <section class="view page" id="view-versions" data-view="versions">
    <header class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">
          <span>LIBRARY</span>
          <i class="rule" aria-hidden="true"></i>
          <span class="eyebrow-date">{{ store.instances.length }} 个实例</span>
        </div>
        <h1 class="page-title">版本管理</h1>
        <p class="page-sub">为每个实例单独配置加载器、Java 与内存，启动前的一切都在这里。</p>
      </div>
      <div class="page-actions">
        <label class="search">
          <SlIcon name="i-search" />
          <input v-model="query" type="search" placeholder="搜索实例…" aria-label="搜索实例" autocomplete="off">
        </label>
        <SlButton variant="ghost" icon="i-plus" text="新建实例" @click="toast.push('新建实例向导弹窗可接入宿主')" />
        <SlButton variant="primary" icon="i-download" text="导入" @click="toast.push('已打开实例导入面板')" />
      </div>
    </header>

    <div class="versions-layout">
      <section class="card list-card" style="--d:.06s">
        <div class="filter-row">
          <SlSeg v-model="store.instFilter" :items="FILTERS" aria-label="实例类型筛选" />
          <span class="filter-note">按最近启动排序</span>
        </div>
        <div class="inst-list" id="instList">
          <article
            v-for="inst in rows"
            :key="inst.id"
            class="inst-row"
            :class="{ 'is-active': inst.id === store.activeId }"
            tabindex="0"
            @click="select(inst.id)"
            @keydown.enter.prevent="select(inst.id)"
            @keydown.space.prevent="select(inst.id)"
          >
            <span class="tile" :class="'tile--' + inst.tone"><svg class="cube" aria-hidden="true"><use href="#i-cube"/></svg></span>
            <div class="inst-row-main">
              <div class="inst-row-title">{{ inst.name }} <span class="badge" :class="{ 'badge--muted': inst.tag === 'Vanilla' }">{{ inst.tag }}</span></div>
              <div class="inst-row-meta">{{ inst.mc }} · {{ modsLabel(inst) }} · {{ inst.last }}启动</div>
            </div>
            <span class="inst-row-side">{{ inst.mem }} GB 内存</span>
            <SlButton variant="icon" icon="i-more" aria-label="更多操作" @click="toast.push('实例操作：设为默认 / 打开目录 / 删除')" />
          </article>
          <SlEmpty v-show="rows.length === 0" text="没有匹配的实例，换个关键词试试。" />
        </div>
        <footer class="list-foot">
          <span><i class="live-dot"></i>全部实例已就绪</span>
          <SlButton variant="link" text="检查完整性" @click="toast.push('正在检查实例完整性…')" />
        </footer>
      </section>

      <aside class="card detail-card" style="--d:.12s">
        <div class="detail-hero" :data-tone="detail.tone">
          <svg class="cube-big" aria-hidden="true"><use href="#i-cube"/></svg>
          <span class="detail-hero-mc">MINECRAFT {{ detail.mc.toUpperCase() }}</span>
          <span class="detail-hero-name">{{ detail.name }}</span>
        </div>
        <div class="detail-title-row">
          <h2 class="detail-name">{{ detail.name }}</h2>
          <span class="detail-ok"><i></i>检查通过</span>
        </div>
        <p class="detail-path">{{ detail.path }}</p>
        <dl class="spec-list detail-specs">
          <div class="spec"><dt>游戏版本</dt><dd>Minecraft {{ detail.mc }}</dd></div>
          <div class="spec"><dt>加载器</dt><dd>{{ detail.loader }}</dd></div>
          <div class="spec"><dt>模组数量</dt><dd>{{ detail.mods > 0 ? detail.mods + ' 个' : '无模组' }}</dd></div>
          <div class="spec"><dt>Java</dt><dd>{{ detail.java }} · Microsoft</dd></div>
        </dl>
        <div class="detail-mods">
          <div class="detail-mods-head">
            <span class="micro">MODS</span>
            <b>{{ detail.mods > 0 ? detail.mods + ' 个模组' : '无模组' }}</b>
          </div>
          <div class="mod-chips">
            <template v-if="detail.mods > 0">
              <span v-for="chip in modChips" :key="chip.name">{{ chip.name }}</span>
            </template>
            <span v-else class="is-empty">纯净原版 · 未安装模组</span>
          </div>
        </div>
        <div class="detail-extra">
          <div class="mini-row"><span>上次启动</span><b>{{ detail.last }}</b></div>
          <div class="mini-row">
            <span>启动前检查更新</span>
            <SlSwitch v-model="checked" sm label="启动前检查实例更新" />
          </div>
        </div>
        <div class="field">
          <div class="field-head"><span>内存分配</span><b>{{ detail.mem }} GB</b></div>
          <SlRange :model-value="detail.mem" :min="2" :max="24" :step="1" aria-label="实例内存分配" @update:model-value="onMem" />
          <div class="range-scale"><span>2 GB</span><span>24 GB</span></div>
        </div>
        <div class="detail-actions">
          <SlButton variant="primary" size="launch" icon="i-play" fill text="启动游戏" @click="launch.start()" />
          <div class="detail-subactions">
            <SlButton variant="ghost" icon="i-folder" text="打开目录" @click="toast.push('已打开实例目录')" />
            <SlButton variant="ghost" icon="i-sliders" text="实例设置" @click="toast.push('已打开实例设置')" />
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>