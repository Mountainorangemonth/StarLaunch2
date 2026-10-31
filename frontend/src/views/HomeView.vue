<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClock } from '../composables/useClock'
import { useInstanceStore, memPercent } from '../stores/instance'
import { useUiStore } from '../stores/ui'
import { useToastStore } from '../stores/toast'
import { useLaunchStore } from '../stores/launch'
import { QUOTES } from '../data/quotes'
import Icon from '../components/Icon.vue'
import InstancePicker from '../components/InstancePicker.vue'

const router = useRouter()
const clock = useClock()
const store = useInstanceStore()
const ui = useUiStore()
const toast = useToastStore()
const launch = useLaunchStore()

// 换一句
const quoteIndex = ref(0)
const quoteBtn = ref(null)
function rotateQuote() {
  quoteIndex.value = (quoteIndex.value + 1) % QUOTES.length
  const el = quoteBtn.value
  el.classList.remove('is-spinning')
  void el.offsetWidth
  el.classList.add('is-spinning')
}

// 公告全部已读
const unread = ref(2)
const notices = ref([true, true, false, false, false]) // is-unread 状态
function readAll() {
  notices.value = notices.value.map(() => false)
  unread.value = 0
  toast.push('全部公告已标记为已读', 'i-check')
}

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
            <span class="hero-name">MoonlitSteve</span>
          </h1>
          <p class="hero-quote">
            <span>{{ QUOTES[quoteIndex][0] }}</span>
            <span class="quote-by">{{ QUOTES[quoteIndex][1] }}</span>
            <button ref="quoteBtn" class="icon-refresh" type="button" aria-label="换一句" title="换一句" @click="rotateQuote">
              <svg class="icon"><use href="#i-refresh"/></svg>
            </button>
          </p>
          <div class="chip-row">
            <span class="chip chip--ok"><i></i>运行正常</span>
            <span class="chip">版本 <b>v1.0.0</b></span>
            <span class="chip">本机 · Windows 11</span>
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
            <svg class="icon inst-chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg>
          </button>
          <div class="launch-side">
            <div class="mem-quick">
              <div class="mem-quick-top"><span>内存分配</span><b>{{ store.activeInstance.mem }} / 16 GB</b></div>
              <span class="mem-track"><i class="mem-fill" :style="{ width: memPercent(store.activeInstance) + '%' }"></i></span>
            </div>
            <button class="btn btn-primary btn-launch" type="button" @click="launch.start()">
              <Icon name="i-play" fill />启动游戏
            </button>
          </div>

          <!-- 版本选择浮层 -->
          <InstancePicker :open="ui.instPickerOpen" @picked="pickerFocusBack" />
        </section>

        <!-- 公告 -->
        <section class="card notice-card bracket" style="--d:.12s">
          <span class="bracket-corner bracket-corner--tr" aria-hidden="true"></span>
          <span class="bracket-corner bracket-corner--bl" aria-hidden="true"></span>
          <header class="card-head">
            <div class="head-title">
              <h2>公告</h2>
              <span class="micro">NOTICE</span>
            </div>
            <div class="notice-tools">
              <span class="unread-count"><i></i>{{ unread }} 条未读</span>
              <button class="link-btn" type="button" @click="readAll">全部已读</button>
            </div>
          </header>
          <div class="notice-body">
            <a class="notice-feature" href="#/download" aria-label="安全提醒：请从官网或官方群下载安装包" @click.prevent="ui.instPickerOpen = false; router.push('/download')">
              <span class="nf-sun"></span>
              <span class="nf-cloud nf-cloud--1"></span>
              <span class="nf-cloud nf-cloud--2"></span>
              <span class="nf-ground"></span>
              <svg class="nf-cube" aria-hidden="true"><use href="#i-cube"/></svg>
              <span class="nf-sheen" aria-hidden="true"></span>
              <span class="nf-content">
                <span class="nf-kicker">安全提醒</span>
                <strong>请从官网或官方群<br>下载安装包</strong>
                <span class="nf-date">2026-10-19</span>
              </span>
            </a>
            <ul class="notice-list">
              <li class="notice-item" :class="{ 'is-unread': notices[0] }">
                <span class="notice-time">10-27</span>
                <span class="n-tag tag-update">版本更新</span>
                <p>v1.0.0 正式发布：主页与下载页全新设计</p>
                <span class="pin">置顶</span>
              </li>
              <li class="notice-item" :class="{ 'is-unread': notices[1] }">
                <span class="notice-time">10-25</span>
                <span class="n-tag tag-maint">维护公告</span>
                <p>服务器维护：10 月 26 日 02:00–04:00</p>
              </li>
              <li class="notice-item" :class="{ 'is-unread': notices[2] }">
                <span class="notice-time">10-19</span>
                <span class="n-tag tag-security">安全提醒</span>
                <p>请从官网或官方群下载安装包</p>
              </li>
              <li class="notice-item" :class="{ 'is-unread': notices[3] }">
                <span class="notice-time">10-12</span>
                <span class="n-tag tag-note">通知</span>
                <p>公益版不限制设备绑定，支持多端登录</p>
              </li>
              <li class="notice-item" :class="{ 'is-unread': notices[4] }">
                <span class="notice-time">10-05</span>
                <span class="n-tag tag-update">版本更新</span>
                <p>v1.0.0：问题修复与启动速度优化</p>
              </li>
            </ul>
          </div>
        </section>

        <!-- 本周游戏时长 -->
        <section class="card week-card" style="--d:.18s">
          <div class="week-copy">
            <div class="head-title">
              <h2>本周游戏</h2>
              <span class="micro">PLAYTIME</span>
            </div>
            <div class="week-total"><b>12.6</b><span>小时</span><em>+18%</em></div>
            <p>共 7 次启动 · 最长 3.2 小时</p>
          </div>
          <div class="week-visual">
            <div class="week-chart" aria-label="每日游戏时长">
              <span style="--h:28%" title="周一 · 0.9 小时"></span>
              <span style="--h:47%" title="周二 · 1.5 小时"></span>
              <span style="--h:31%" title="周三 · 1.0 小时"></span>
              <span class="is-today" style="--h:63%" title="周四 · 2.0 小时"></span>
              <span style="--h:69%" title="周五 · 2.2 小时"></span>
              <span style="--h:100%" title="周六 · 3.2 小时"></span>
              <span style="--h:56%" title="周日 · 1.8 小时"></span>
            </div>
            <div class="week-days" aria-hidden="true">
              <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
            </div>
          </div>
        </section>
      </div>

      <aside class="home-side">
        <!-- 账户卡 -->
        <section class="card account-card" style="--d:.08s">
          <svg class="card-watermark" aria-hidden="true"><use href="#i-cube"/></svg>
          <header class="card-head">
            <div class="head-title">
              <span class="micro">STAR ACCOUNT</span>
            </div>
            <div class="head-actions">
              <span class="tag-pro">正版</span>
              <button class="icon-btn" type="button" aria-label="打开账户主页" title="账户主页" @click="toast.push('账户主页：微软账户中心')">
                <svg class="icon"><use href="#i-external"/></svg>
              </button>
            </div>
          </header>
          <div class="acct-line">
            <span class="avatar-ring" style="--xp:68%">
              <span class="avatar">
                <svg class="steve" aria-hidden="true"><use href="#art-steve"/></svg>
                <i class="online-dot" aria-hidden="true"></i>
              </span>
            </span>
            <div class="acct-id-wrap">
              <h2 class="acct-name">MoonlitSteve</h2>
              <p class="acct-id">MS-2699-8823 · MICROSOFT</p>
            </div>
          </div>
          <div class="acct-progress">
            <div class="progress"><i style="width:68%"></i></div>
            <div class="progress-meta">
              <span>等级 <b>42</b> · 经验 68%</span>
              <span>5 040 / 7 400 XP</span>
            </div>
          </div>
          <div class="stat-grid">
            <div><span class="micro">状态</span><b class="ok"><i></i>已登录</b></div>
            <div><span class="micro">皮肤</span><b>1 / 3</b></div>
            <div><span class="micro">上次登录</span><b>今天 22:29</b></div>
          </div>
        </section>

        <!-- 本机配置卡 -->
        <section class="card system-card" style="--d:.14s">
          <header class="card-head">
            <div class="head-title">
              <h2>本机配置</h2>
              <span class="micro">SYSTEM</span>
            </div>
            <div class="head-actions">
              <span class="head-ico"><svg class="icon"><use href="#i-monitor"/></svg></span>
              <button class="icon-btn" type="button" aria-label="重新检测" title="重新检测" @click="toast.push('已重新检测硬件信息')">
                <svg class="icon"><use href="#i-refresh"/></svg>
              </button>
            </div>
          </header>
          <p class="sys-sub">YR · Windows 11 Pro · 检测于 22:28</p>
          <div class="kpi-grid">
            <div class="kpi"><b>10<small>核</small> 16<small>线程</small></b><span>处理器</span></div>
            <div class="kpi"><b>8<small>GB</small></b><span>显存</span></div>
            <div class="kpi"><b>32<small>GB</small></b><span>内存</span></div>
            <div class="kpi"><b>0.9<small>TB</small></b><span>存储</span></div>
          </div>
          <dl class="spec-list">
            <div class="spec"><dt>处理器</dt><dd>13th Gen Intel Core i5-13400F</dd></div>
            <div class="spec"><dt>显卡</dt><dd>NVIDIA GeForce RTX 4060</dd></div>
            <div class="spec"><dt>内存</dt><dd>32 GB DDR4 3200 MHz</dd></div>
            <div class="spec"><dt>主板</dt><dd>ASUS B760M-A WIFI</dd></div>
            <div class="spec"><dt>存储</dt><dd>C:\ 0.9 TB 可用</dd></div>
            <div class="spec"><dt>显示器</dt><dd>1920 × 1080 · 144 Hz</dd></div>
            <div class="spec"><dt>操作系统</dt><dd>Windows 11 Pro 23H2</dd></div>
          </dl>
          <footer class="sys-foot">
            <i class="live-dot" aria-hidden="true"></i>
            <span>硬件信息正常</span>
            <span class="sys-java">Java 21</span>
            <button class="link-btn" type="button" @click="toast.push('已复制本机配置到剪贴板')">复制配置</button>
          </footer>
        </section>

        <!-- 快捷操作 -->
        <section class="card quick-card" style="--d:.2s">
          <div class="quick-head">
            <div class="head-title">
              <h2>快捷操作</h2>
              <span class="micro">QUICK</span>
            </div>
          </div>
          <div class="quick-grid">
            <button class="quick-item" type="button" @click="toast.push('已打开游戏目录')">
              <span class="quick-ico"><svg class="icon"><use href="#i-folder"/></svg></span>
              <span>游戏目录</span>
            </button>
            <button class="quick-item" type="button" @click="toast.push('已打开服务器列表')">
              <span class="quick-ico"><svg class="icon"><use href="#i-layers"/></svg></span>
              <span>服务器</span>
            </button>
            <button class="quick-item" type="button" @click="toast.push('已打开最近启动日志')">
              <span class="quick-ico"><svg class="icon"><use href="#i-terminal"/></svg></span>
              <span>启动日志</span>
            </button>
            <button class="quick-item" type="button" @click="toast.push('已创建存档备份任务')">
              <span class="quick-ico"><svg class="icon"><use href="#i-box"/></svg></span>
              <span>备份存档</span>
            </button>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>