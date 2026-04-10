import { storageManager } from '@/background/storage'
import { setupMessageRouter } from '@/background/messageRouter'
import { recorderController } from '@/background/recorderController'

export default defineBackground(() => {
  // 初始化 IndexedDB
  storageManager.init().then(() => {
    console.log('[YOSO] Storage initialized')
  })

  // 初始化 Recorder Controller (恢复录制状态)
  recorderController.init().then(() => {
    console.log('[YOSO] Recorder controller initialized')
  })

  // 设置消息路由
  setupMessageRouter()

  // 点击扩展图标时打开 Side Panel
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error)

  console.log('[YOSO] Background service worker started')
})
