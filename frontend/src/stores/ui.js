import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    titlebarCenter: false, // 标题栏窗口按钮居左 / 居中
    accountOpen: false,    // 账户浮层
    instPickerOpen: false  // 主页实例选择浮层
  }),
  actions: {
    closeAll() { this.accountOpen = false; this.instPickerOpen = false; }
  }
})