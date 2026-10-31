// 主页「本机配置」卡默认数据（kpi.html 为受信任的静态片段，经 v-html 渲染以保留 <small> 单位）
export const SYSTEM_INFO = {
  sub: 'YR · Windows 11 Pro · 检测于 22:28',
  kpis: [
    { html: '10<small>核</small> 16<small>线程</small>', label: '处理器' },
    { html: '8<small>GB</small>', label: '显存' },
    { html: '32<small>GB</small>', label: '内存' },
    { html: '0.9<small>TB</small>', label: '存储' }
  ],
  specs: [
    { dt: '处理器', dd: '13th Gen Intel Core i5-13400F' },
    { dt: '显卡', dd: 'NVIDIA GeForce RTX 4060' },
    { dt: '内存', dd: '32 GB DDR4 3200 MHz' },
    { dt: '主板', dd: 'ASUS B760M-A WIFI' },
    { dt: '存储', dd: 'C:\\ 0.9 TB 可用' },
    { dt: '显示器', dd: '1920 × 1080 · 144 Hz' },
    { dt: '操作系统', dd: 'Windows 11 Pro 23H2' }
  ],
  java: 'Java 21',
  status: '硬件信息正常'
}