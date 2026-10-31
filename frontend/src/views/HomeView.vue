<script setup>
import { useClock } from '../composables/useClock'
import { useInstanceStore, memPercent } from '../stores/instance'
import { useUiStore } from '../stores/ui'
import { useToastStore } from '../stores/toast'
import { useLaunchStore } from '../stores/launch'
import { QUOTES } from '../data/quotes'
import { PROFILE } from '../data/profile'
import { NOTICE_FEATURE, NOTICES } from '../data/notices'
import { SYSTEM_INFO } from '../data/system'
import { PLAYTIME } from '../data/playtime'
import { QUICK_ACTIONS } from '../data/quick'
import { APP_INFO } from '../data/appInfo'
import SlButton from '../components/ui/SlButton.vue'
import SlIcon from '../components/ui/SlIcon.vue'
import InstancePicker from '../components/InstancePicker.vue'
import HeroQuote from '../components/home/HeroQuote.vue'
import NoticeBoard from '../components/home/NoticeBoard.vue'
import AccountCard from '../components/home/AccountCard.vue'
import SystemCard from '../components/home/SystemCard.vue'
import WeekCard from '../components/home/WeekCard.vue'
import QuickGrid from '../components/home/QuickGrid.vue'

const clock = useClock()
const store = useInstanceStore()
const ui = useUiStore()
const toast = useToastStore()
const launch = useLaunchStore()

function pickerFocusBack() {
  const picker = document.querySelector('#instPicker')
  if (picker) picker.focus({ preventScroll: true })
}
</script>

<template>
  <section class="view is-active" id="view-home" data-view="home">
    <div class="home-grid">
      <div class="home-main">
        <div class="hero">
          <div class="eyebrow">
            <span>TODAY</span>
            <i class="rule" aria-hidden="true"></i>
            <span class="eyebrow-date" id="heroDate">{{ clock.date }}</span>
            <span class="eyebrow-clock" id="heroClock">{{ clock.clock }}</span>
          </div>
          <h1 class="hero-title">
            <span class="hero-hi" id="heroGreeting">{{ clock.greeting }}</span>
            <span class="hero-name">{{ PROFILE.name }}</span>
          </h1>
          <HeroQuote :quotes="QUOTES" />
          <div class="chip-row">
            <span class="chip chip--ok"><i></i>{{ APP_INFO.chipStatus }}</span>
            <span class="chip">版本 <b>{{ APP_INFO.version }}</b></span>
            <span class="chip">本机 · {{ APP_INFO.platform }}</span>
          </div>
        </div>

        <!-- 启动卡：版本选择 + 内存 + 启动按钮 -->
        <section class="card launch-card" style="--d:.06s">
          <button
            class="inst-pick"
            type="button"
            id="instPicker"
            aria-haspopup="listbox"
            :aria-expanded="String(ui.instPickerOpen)"
            @click="ui.instPickerOpen = !ui.instPickerOpen"
          >
            <span class="tile" :class="'tile--' + store.activeInstance.tone">
              <svg class="cube" aria-hidden="true"><use href="#i-cube"/></svg>
            </span>
            <span class="inst-copy">
              <span class="micro">CURRENT INSTANCE</span>
              <span class="inst-name">{{ store.activeInstance.name }} <em>{{ store.activeInstance.tag }}</em></span>
              <span class="inst-meta">{{ store.activeInstance.mc }} · {{ store.activeInstance.mods > 0 ? store.activeInstance.mods + ' 个模组' : '无模组' }} · 上次启动 {{ store.activeInstance.last }}</span>
            </span>
            <SlIcon name="i-chevron-down" class="inst-chevron" />
          </button>
          <div class="launch-side">
            <div class="mem-quick">
              <div class="mem-quick-top"><span>内存分配</span><b>{{ store.activeInstance.mem }} / 16 GB</b></div>
              <span class="mem-track"><i class="mem-fill" :style="{ width: memPercent(store.activeInstance) + '%' }"></i></span>
            </div>
            <SlButton variant="primary" size="launch" icon="i-play" fill text="启动游戏" @click="launch.start()" />
          </div>

          <!-- 版本选择浮层 -->
          <InstancePicker :open="ui.instPickerOpen" @picked="pickerFocusBack" />
        </section>

        <!-- 公告 -->
        <NoticeBoard
          :notice-list="NOTICES"
          :feature="NOTICE_FEATURE"
          @read-all="toast.push('全部公告已标记为已读', 'i-check')"
        />

        <!-- 本周游戏时长 -->
        <WeekCard :playtime="PLAYTIME" />
      </div>

      <aside class="home-side">
        <!-- 账户卡 -->
        <AccountCard :profile="PROFILE" @open-home="toast.push('账户主页：微软账户中心')" />

        <!-- 本机配置卡 -->
        <SystemCard
          :system="SYSTEM_INFO"
          @redetect="toast.push('已重新检测硬件信息')"
          @copy="toast.push('已复制本机配置到剪贴板')"
        />

        <!-- 快捷操作 -->
        <QuickGrid :actions="QUICK_ACTIONS" @action="toast.push($event.notice)" />
      </aside>
    </div>
  </section>
</template>