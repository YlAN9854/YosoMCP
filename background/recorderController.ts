// 录制控制器 — 管理 Content Script 的录制状态

import { CS_MSG } from '@/types/message'
import { sendToContentScript, broadcastToSidePanel } from '@/utils/messaging'
import { EVENT } from '@/types/message'
import type { RecordedAction } from '@/types/action'

const NAV_TIMEOUT = 30_000
const NAV_SETTLE_DELAY = 500

const STORAGE_KEY = 'yoso_recorder_state'

type RecorderSessionState = {
  recordingTabId: number | null
  recordedTabs: number[]
  currentRecordingOptions?: { showIndicator?: boolean }
  isRecordingPaused?: boolean
}

let recordingTabId: number | null = null
const recordedTabs = new Set<number>()
let currentRecordingOptions: { showIndicator?: boolean } | undefined
let isRecordingPaused = false

async function saveState() {
  await chrome.storage.session.set({
    [STORAGE_KEY]: {
      recordingTabId,
      recordedTabs: Array.from(recordedTabs),
      currentRecordingOptions,
      isRecordingPaused,
    },
  })
}

async function loadState() {
  const data = await chrome.storage.session.get(STORAGE_KEY)
  const restored = data[STORAGE_KEY] as RecorderSessionState | undefined
  if (restored) {
    recordingTabId = restored.recordingTabId ?? null
    const tabs = restored.recordedTabs || []
    recordedTabs.clear()
    tabs.forEach((t: number) => recordedTabs.add(t))
    currentRecordingOptions = restored.currentRecordingOptions
    isRecordingPaused = Boolean(restored.isRecordingPaused)

    // Restore listeners if recording
    if (recordingTabId) {
      if (!chrome.tabs.onActivated.hasListener(handleTabActivated)) {
        chrome.tabs.onActivated.addListener(handleTabActivated)
      }
      if (!chrome.tabs.onUpdated.hasListener(handleTabUpdated)) {
        chrome.tabs.onUpdated.addListener(handleTabUpdated)
      }
    }
  }
}

/**
 * 等待指定 Tab 导航完成（含重定向后的最终页面），用于「从起始 URL 开始录制」流程
 */
function waitForTabNavigation(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error(`页面导航超时 (${NAV_TIMEOUT}ms)`))
    }, NAV_TIMEOUT)

    const listener = (id: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeoutId)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

function isValidUrl(s: string): boolean {
  if (!s || typeof s !== 'string') return false
  const t = s.trim()
  if (!t) return false
  try {
    new URL(t)
    return true
  } catch {
    return false
  }
}

async function ensureContentScript(tabId: number) {
  // 检查主框架 Content Script 是否活跃，避免重复注入
  let isContentScriptActive = false
  try {
    await sendToContentScript(tabId, CS_MSG.GET_PAGE_INFO)
    isContentScriptActive = true
  } catch {
    // 忽略错误，说明 Content Script 可能未注入
  }

  if (!isContentScriptActive) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/content.js'],
      })
    } catch (e) {
      console.error('Failed to inject content script:', e)
    }
  }
}

async function getTabFrameIds(tabId: number): Promise<number[]> {
  try {
    const all = await chrome.webNavigation.getAllFrames({ tabId })
    if (all?.length) return all.map(f => f.frameId)
  } catch {
    // 无 webNavigation 或页面未就绪时仅主框架
  }
  return [0]
}

async function sendToAllFrames(tabId: number, type: string, data?: unknown): Promise<void> {
  const frameIds = await getTabFrameIds(tabId)
  for (const frameId of frameIds) {
    try {
      await sendToContentScript(tabId, type, data, { frameId })
    } catch {
      // 某 frame 未注入或已销毁则跳过
    }
  }
}

async function startRecordingOnTab(tabId: number) {
  if (recordedTabs.has(tabId)) return

  try {
    await ensureContentScript(tabId)
    const frameIds = await getTabFrameIds(tabId)
    for (const frameId of frameIds) {
      try {
        await sendToContentScript(tabId, CS_MSG.START_RECORDING, currentRecordingOptions, {
          frameId,
        })
      } catch {
        // 某 frame 未注入或已销毁则跳过
      }
    }
    if (isRecordingPaused) {
      await sendToAllFrames(tabId, CS_MSG.PAUSE_RECORDING).catch(() => {})
    }
    recordedTabs.add(tabId)
    await saveState()
  } catch (e) {
    console.error(`Failed to start recording on tab ${tabId}:`, e)
  }
}

function handleTabActivated(activeInfo: chrome.tabs.OnActivatedInfo) {
  if (recordingTabId) {
    startRecordingOnTab(activeInfo.tabId)
  }
}

function handleTabUpdated(tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) {
  if (recordingTabId && changeInfo.status === 'complete') {
    // 页面刷新或跳转完成后，重新注入并开始录制
    // 这里不需要检查 recordedTabs.has(tabId)，因为页面刷新后 Content Script 状态重置了
    // 但是我们需要先从 Set 中移除，以触发 startRecordingOnTab 的逻辑（虽然其实不需要，因为 ensureContentScript 会检查）
    // 为了保险，强制重新初始化
    recordedTabs.delete(tabId)
    startRecordingOnTab(tabId)
  }
}

export const recorderController = {
  async init() {
    await loadState()
  },
  async start(data?: { showIndicator?: boolean; startUrl?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: 'No active tab' }

      let urlForFirstNavigate = tab.url ?? ''

      if (data?.startUrl) {
        const startUrl = data.startUrl.trim()
        if (!isValidUrl(startUrl)) return { success: false, error: '起始 URL 无效，请填写完整地址（如 https://example.com）' }
        try {
          const loadPromise = waitForTabNavigation(tab.id)
          await chrome.tabs.update(tab.id, { url: startUrl })
          await loadPromise
          await new Promise(r => setTimeout(r, NAV_SETTLE_DELAY))
        } catch (err) {
          return { success: false, error: (err as Error).message }
        }
        urlForFirstNavigate = startUrl
      }

      recordingTabId = tab.id
      currentRecordingOptions = data
      isRecordingPaused = false
      recordedTabs.clear()

      await saveState()

      chrome.tabs.onActivated.addListener(handleTabActivated)
      chrome.tabs.onUpdated.addListener(handleTabUpdated)

      await startRecordingOnTab(tab.id)

      broadcastToSidePanel(EVENT.RECORDING_STARTED, { tabId: tab.id, url: urlForFirstNavigate })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },

  async pause(): Promise<{ success: boolean; error?: string }> {
    if (!recordingTabId) await loadState()
    if (!recordingTabId) return { success: false, error: 'Not recording' }
    try {
      isRecordingPaused = true
      const promises = Array.from(recordedTabs).map(tabId =>
        sendToAllFrames(tabId, CS_MSG.PAUSE_RECORDING).catch(() => {})
      )
      await Promise.all(promises)
      await saveState()
      broadcastToSidePanel(EVENT.RECORDING_PAUSED)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },

  async resume(): Promise<{ success: boolean; error?: string }> {
    if (!recordingTabId) await loadState()
    if (!recordingTabId) return { success: false, error: 'Not recording' }
    try {
      const promises = Array.from(recordedTabs).map(tabId =>
        sendToAllFrames(tabId, CS_MSG.RESUME_RECORDING).catch(() => {})
      )
      await Promise.all(promises)
      isRecordingPaused = false
      await saveState()
      broadcastToSidePanel(EVENT.RECORDING_RESUMED)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },

  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!recordingTabId) await loadState()
    if (!recordingTabId) return { success: false, error: 'Not recording' }
    try {
      chrome.tabs.onActivated.removeListener(handleTabActivated)
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)

      const promises = Array.from(recordedTabs).map(tabId =>
        sendToAllFrames(tabId, CS_MSG.STOP_RECORDING).catch(() => {})
      )
      await Promise.all(promises)
      
      broadcastToSidePanel(EVENT.RECORDING_STOPPED)
      recordingTabId = null
      isRecordingPaused = false
      recordedTabs.clear()
      currentRecordingOptions = undefined
      await saveState()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },

  handleActionCaptured(action: RecordedAction) {
    if (isRecordingPaused) return
    broadcastToSidePanel(EVENT.ACTION_RECORDED, action)
  },

  getRecordingTabId(): number | null {
    return recordingTabId
  },

  isRecording(): boolean {
    return recordingTabId !== null
  },
}
