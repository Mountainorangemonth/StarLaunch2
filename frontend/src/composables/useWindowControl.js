import { useToastStore } from '../stores/toast'

const ICONS = { minimize: 'i-info', maximize: 'i-cube', close: 'i-x' }

// 窗口控制三级降级协议：
//  WPF 主页桥接（window.starLaunch.window.*） → chrome.webview.postMessage → CustomEvent
// 最后一级供浏览器（vite dev）调试，以 toast 提示。
export function callWindow(action) {
  if (window.starLaunch && window.starLaunch.window && typeof window.starLaunch.window[action] === 'function') {
    try {
      window.starLaunch.window[action]()
      return
    } catch (err) { /* 回落下一级 */ }
  }
  if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
    try {
      window.chrome.webview.postMessage({ type: 'window-control', action })
      return
    } catch (err) { /* 回落 CustomEvent */ }
  }
  window.dispatchEvent(new CustomEvent('starlaunch:window-control', { detail: { action } }))
  useToastStore().push('浏览器环境：' + action + ' 窗口（' + ICONS[action] + ' 已提示）', 'i-info')
}

export function useWindowControl() {
  return { minimize: () => callWindow('minimize'), maximize: () => callWindow('maximize'), close: () => callWindow('close') }
}