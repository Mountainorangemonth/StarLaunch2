<script setup>
import { computed, ref } from 'vue'
import { useAppearanceStore, DEFAULT_APPEARANCE } from '../stores/appearance'
import { useDownloadStore } from '../stores/download'
import { useUiStore } from '../stores/ui'
import { useToastStore } from '../stores/toast'
import { useWallpaperStore } from '../stores/wallpaper'
import Icon from '../components/Icon.vue'
import SwitchControl from '../components/SwitchControl.vue'
import RangeControl from '../components/RangeControl.vue'
import SegControl from '../components/SegControl.vue'

const app = useAppearanceStore()
const downloads = useDownloadStore()
const ui = useUiStore()
const toast = useToastStore()
const wallpaper = useWallpaperStore()

// 非外观类控件的本地开关状态（原实现仅翻转 aria-checked，不持久化）
const checkUpdate = ref(true)
const rememberSize = ref(true)
const trayMinimize = ref(false)
const autoClean = ref(true)
const launcherUpdate = ref(true)
const globalMem = ref(8)
const concurrency = ref(8)

const WIN_STYLES = [
  { key: 'right', label: '右侧' },
  { key: 'center', label: '居中' }
]
const DOWNLOAD_SOURCES = [
  { key: 'BMCLAPI', label: 'BMCLAPI' },
  { key: '官方源', label: '官方源' }
]
const ACCENTS = [
  { key: 'blue', cls: 'swatch--blue', label: '天蓝' },
  { key: 'sakura', cls: 'swatch--sakura', label: '樱粉' },
  { key: 'mint', cls: 'swatch--mint', label: '薄荷' }
]

function setAppearance(prop, value) {
  app[prop] = value
  app.apply(true)
}
function onPerf(val) {
  app.performance = val
  app.apply(true)
  toast.push(val ? '性能模式已开启：毛玻璃与背景动画已关闭' : '性能模式已关闭', 'i-palette')
}
function onAccent(key) {
  app.accent = key
  app.apply(true)
  toast.push('主题色已切换为' + { blue: '天蓝', sakura: '樱粉', mint: '薄荷' }[key], 'i-palette')
}
function resetAppearance() {
  Object.assign(app.$state, DEFAULT_APPEARANCE)
  app.apply(true)
  toast.push('外观已恢复默认')
}

const bgInput = ref(null)
const previewStyle = computed(() =>
  wallpaper.previewUrl ? { backgroundImage: 'url("' + wallpaper.previewUrl + '")' } : {}
)
function pickBg() { bgInput.value && bgInput.value.click() }
function onBgFile(event) {
  const file = event.target.files && event.target.files[0]
  if (file) wallpaper.applyFile(file)
  event.target.value = ''
}
function resetBg() {
  wallpaper.reset()
  toast.push('已恢复默认背景', 'i-refresh')
}
</script>

<template>
  <section class="view page" id="view-settings" data-view="settings">
    <header class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">
          <span>PREFERENCES</span>
          <i class="rule" aria-hidden="true"></i>
          <span class="eyebrow-date">改动即时生效</span>
        </div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">调整外观、启动参数与下载行为。外观选项会保存在本机。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" type="button" @click="resetAppearance">
          <svg class="icon"><use href="#i-refresh"/></svg>恢复默认外观
        </button>
      </div>
    </header>

    <div class="settings-grid">
      <section class="card set-card" style="--d:.04s">
        <header class="set-head">
          <span class="head-ico"><svg class="icon"><use href="#i-memory"/></svg></span>
          <div>
            <h2 class="set-title">启动与内存</h2>
            <p class="set-desc">新实例的默认启动参数，可在实例设置中单独覆盖。</p>
          </div>
        </header>
        <div class="set-row">
          <div class="set-label">全局默认内存<small>为 Java 虚拟机分配的最大堆内存</small></div>
          <div class="set-value set-value--range">
            <RangeControl v-model="globalMem" :min="2" :max="32" :step="1" cls="range--sm" aria-label="全局默认内存" />
            <b>{{ globalMem }} GB</b>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">Java 运行时<small>自动匹配实例所需的 Java 版本</small></div>
          <div class="set-value"><span class="value-chip">Java 21.0.8 · Microsoft</span><button class="link-btn" type="button" @click="toast.push('正在扫描本机 Java…')">自动检测</button></div>
        </div>
        <div class="set-row">
          <div class="set-label">JVM 参数<small>高级选项，仅在了解含义时修改</small></div>
          <div class="jvm-box">
            <code>-XX:+UseG1GC -XX:+ParallelRefProcEnabled</code>
            <button class="icon-btn" type="button" aria-label="复制 JVM 参数" @click="toast.push('JVM 参数已复制')">
              <svg class="icon"><use href="#i-copy"/></svg>
            </button>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">启动前检查更新</div>
          <SwitchControl v-model="checkUpdate" label="启动前检查更新" />
        </div>
      </section>

      <section class="card set-card" style="--d:.08s">
        <header class="set-head">
          <span class="head-ico"><svg class="icon"><use href="#i-palette"/></svg></span>
          <div>
            <h2 class="set-title">外观</h2>
            <p class="set-desc">玻璃拟态与背景图层，用来搭配你自己的壁纸。</p>
          </div>
        </header>
        <div class="set-row">
          <div class="set-label">背景图<small>默认读取 assets/wallpaper.png</small></div>
          <div class="set-value bg-value">
            <span class="bg-preview" aria-hidden="true" :style="previewStyle"></span>
            <button class="btn btn-ghost btn-sm" type="button" @click="pickBg">选择图片</button>
            <button class="link-btn" type="button" @click="resetBg">恢复</button>
            <input ref="bgInput" class="visually-hidden" type="file" accept="image/*" @change="onBgFile">
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">背景蒙版<small>壁纸偏暗时提高可读性</small></div>
          <div class="set-value set-value--range">
            <RangeControl :model-value="app.veil" :min="0" :max="100" :step="1" cls="range--sm" aria-label="背景蒙版强度" @update:model-value="(v) => setAppearance('veil', v)" />
            <b>{{ app.veil }}%</b>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">毛玻璃强度<small>卡片背景模糊半径</small></div>
          <div class="set-value set-value--range">
            <RangeControl :model-value="app.blur" :min="0" :max="40" :step="2" :disabled="app.performance" cls="range--sm" aria-label="毛玻璃强度" @update:model-value="(v) => setAppearance('blur', v)" />
            <b>{{ app.blur }} px</b>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">玻璃透明度<small>数值越低越通透</small></div>
          <div class="set-value set-value--range">
            <RangeControl :model-value="app.glass" :min="40" :max="92" :step="2" cls="range--sm" aria-label="玻璃透明度" @update:model-value="(v) => setAppearance('glass', v)" />
            <b>{{ app.glass }}%</b>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">主题色<small>强调色与按钮渐变</small></div>
          <div class="swatches" role="radiogroup" aria-label="主题色">
            <button
              v-for="a in ACCENTS"
              :key="a.key"
              class="swatch"
              :class="a.cls"
              type="button"
              role="radio"
              :aria-checked="String(app.accent === a.key)"
              :aria-label="a.label"
              @click="onAccent(a.key)"
            ></button>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">性能模式<small>关闭毛玻璃与背景动画，降低 GPU / 内存占用</small></div>
          <SwitchControl :model-value="app.performance" label="性能模式" @update:model-value="onPerf" />
        </div>
      </section>

      <section class="card set-card" style="--d:.12s">
        <header class="set-head">
          <span class="head-ico"><svg class="icon"><use href="#i-window"/></svg></span>
          <div>
            <h2 class="set-title">窗口与标题栏</h2>
            <p class="set-desc">标题栏继续使用 .custom-titlebar 的拖拽区，按钮已排除拖拽。</p>
          </div>
        </header>
        <div class="set-row">
          <div class="set-label">自定义标题栏<small>由样式表 .custom-titlebar 提供</small></div>
          <span class="status-chip"><i></i>已启用</span>
        </div>
        <div class="set-row">
          <div class="set-label">标题栏按钮位置<small>关闭按钮悬浮时显示红色反馈</small></div>
          <SegControl :model-value="ui.titlebarCenter ? 'center' : 'right'" :options="WIN_STYLES" cls="seg seg--sm" aria-label="标题栏按钮位置" @update:model-value="(v) => (ui.titlebarCenter = v === 'center')" />
        </div>
        <div class="set-row">
          <div class="set-label">记住窗口尺寸</div>
          <SwitchControl v-model="rememberSize" label="记住窗口尺寸" />
        </div>
        <div class="set-row">
          <div class="set-label">关闭时最小化到托盘</div>
          <SwitchControl v-model="trayMinimize" label="关闭时最小化到托盘" />
        </div>
      </section>

      <section class="card set-card" style="--d:.16s">
        <header class="set-head">
          <span class="head-ico"><svg class="icon"><use href="#i-cloud"/></svg></span>
          <div>
            <h2 class="set-title">下载与更新</h2>
            <p class="set-desc">下载源会按延迟自动选择，失败时自动回退。</p>
          </div>
        </header>
        <div class="set-row">
          <div class="set-label">下载源<small>当前：BMCLAPI 国内镜像</small></div>
          <SegControl :model-value="downloads.source" :options="DOWNLOAD_SOURCES" cls="seg seg--sm" aria-label="下载源" @update:model-value="downloads.pickSource" />
        </div>
        <div class="set-row">
          <div class="set-label">并发下载数<small>连接数越高对网络压力越大</small></div>
          <div class="set-value set-value--range">
            <RangeControl v-model="concurrency" :min="1" :max="16" :step="1" cls="range--sm" aria-label="并发下载数" />
            <b>{{ concurrency }}</b>
          </div>
        </div>
        <div class="set-row">
          <div class="set-label">自动清理安装缓存<small>安装完成后保留 7 天</small></div>
          <SwitchControl v-model="autoClean" label="自动清理安装缓存" />
        </div>
        <div class="set-row">
          <div class="set-label">检查启动器更新</div>
          <SwitchControl v-model="launcherUpdate" label="检查启动器更新" />
        </div>
      </section>
    </div>

    <section class="card about-strip" style="--d:.2s">
      <div class="about-brand">
        <span class="tb-logo"><svg class="icon icon--fill"><use href="#i-spark"/></svg></span>
        <div><b>StarLaunch</b><span>v1.0.0 · WebAssets UI</span></div>
      </div>
      <p>标题栏与窗口按钮已为宿主接管预留事件，UI 资源完全离线可用。</p>
      <div class="about-actions">
        <button class="btn btn-ghost btn-sm" type="button" @click="toast.push('当前已是最新版本')">检查更新</button>
        <button class="btn btn-ghost btn-sm" type="button" @click="toast.push('项目主页地址可在此接入')">项目主页</button>
      </div>
    </section>
  </section>
</template>