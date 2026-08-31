// Background 消息路由

import { MSG, CS_MSG, EVENT, type Response, type TracePackageExportRequest } from '@/types/message'
import type { RecordedAction } from '@/types/action'
import type { OperationNode, OperationTreeInfo } from '@/types/operationTree'
import type { ToolSet } from '@/types/toolset'
import { recorderController } from './recorderController'
import { replayController } from './replayController'
import { storageManager } from './storage'
import { runStructuralAnalysis } from './analyzer/structural'
import { analyzeNodeRoles } from './analyzer/structural/nodeRoleAnalyzer'
import { generateTracePackage } from './generator/tracePackageGen'
import { sendToContentScript, broadcastToSidePanel } from '@/utils/messaging'

/** Background 自广播给侧栏的 EVENT，不应按「侧栏请求」走 handleSidePanelMessage */
const SIDE_PANEL_EVENT_TYPES = new Set<string>(Object.values(EVENT) as string[])

const CONTENT_SCRIPT_MESSAGE_TYPES = new Set<string>(Object.values(CS_MSG) as string[])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTracePackageExportRequest(data: unknown): data is TracePackageExportRequest {
  if (!isRecord(data) || !isRecord(data.toolSet)) return false
  const toolSet = data.toolSet
  return typeof toolSet.id === 'string'
    && typeof toolSet.name === 'string'
    && typeof toolSet.description === 'string'
    && typeof toolSet.createdAt === 'number'
    && typeof toolSet.updatedAt === 'number'
    && Array.isArray(toolSet.operationTrees)
    && Array.isArray(toolSet.operationNodes)
    && isRecord(toolSet.metadata)
}

export function setupMessageRouter() {
  chrome.runtime.onMessage.addListener(
    (message: { type: string; data?: unknown }, sender, sendResponse) => {
      const { type, data } = message

      // 来自 Content Script 的消息
      if (sender.tab && CONTENT_SCRIPT_MESSAGE_TYPES.has(type)) {
        if (type === CS_MSG.CAPTURE_VISIBLE_TAB) {
          handleContentScriptRequest(type, data, sender)
            .then(sendResponse)
            .catch((err: Error) =>
              sendResponse({ success: false, error: err.message } as Response)
            )
          return true
        }
        handleContentScriptMessage(type, data as RecordedAction, sender)
        // Content Script 消息不需要 sendResponse
        return false
      }

      if (SIDE_PANEL_EVENT_TYPES.has(type)) {
        return false
      }

      // 来自 Side Panel 的消息
      handleSidePanelMessage(type, data)
        .then(sendResponse)
        .catch((err: Error) =>
          sendResponse({ success: false, error: err.message } as Response)
        )

      return true // 异步 sendResponse
    }
  )
}

async function handleContentScriptRequest(
  type: string,
  _data: unknown,
  sender: chrome.runtime.MessageSender
): Promise<Response> {
  if (type === CS_MSG.CAPTURE_VISIBLE_TAB) {
    const tab = sender.tab
    if (!tab?.windowId) {
      return { success: false, error: '无法获取当前窗口' }
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    return { success: true, data: { dataUrl } }
  }
  return { success: false, error: `Unknown content request type: ${type}` }
}

function handleContentScriptMessage(
  type: string,
  data: unknown,
  sender: chrome.runtime.MessageSender
) {
  if (type === CS_MSG.ACTION_CAPTURED) {
    const action = data as RecordedAction
    const merged: RecordedAction = {
      ...action,
      frameId: sender.frameId ?? 0,
      frameUrl: sender.url,
    }
    recorderController.handleActionCaptured(merged)
  }

  if (type === CS_MSG.SELECTOR_PICKED) {
    // Content Script 完成拾取，将结果广播给 Side Panel
    broadcastToSidePanel(EVENT.SELECTOR_PICKER_RESULT, data)
  }

  if (type === CS_MSG.CONTENT_EXTRACT_PICKED) {
    broadcastToSidePanel(EVENT.CONTENT_EXTRACT_PICKED, data)
  }

  if (type === CS_MSG.CONTENT_EXTRACT_CANCELLED) {
    broadcastToSidePanel(EVENT.CONTENT_EXTRACT_CANCELLED, data)
  }

  if (type === CS_MSG.UPLOAD_PICKED) {
    broadcastToSidePanel(EVENT.UPLOAD_PICKED, data)
  }

  if (type === CS_MSG.UPLOAD_CANCELLED) {
    broadcastToSidePanel(EVENT.UPLOAD_CANCELLED, data)
  }

  if (type === CS_MSG.HOVER_PICKED) {
    broadcastToSidePanel(EVENT.HOVER_PICKED, data)
  }

  if (type === CS_MSG.HOVER_CANCELLED) {
    broadcastToSidePanel(EVENT.HOVER_CANCELLED, data)
  }

  if (type === CS_MSG.WAIT_ELEMENT_PICKED) {
    broadcastToSidePanel(EVENT.WAIT_ELEMENT_PICKED, data)
  }

  if (type === CS_MSG.WAIT_ELEMENT_CANCELLED) {
    broadcastToSidePanel(EVENT.WAIT_ELEMENT_CANCELLED, data)
  }
}

async function handleSidePanelMessage(type: string, data: unknown): Promise<Response> {
  switch (type) {
    // 录制控制
    case MSG.START_RECORDING:
      return await recorderController.start(data as { showIndicator?: boolean; startUrl?: string })
    case MSG.PAUSE_RECORDING:
      return await recorderController.pause()
    case MSG.RESUME_RECORDING:
      return await recorderController.resume()
    case MSG.STOP_RECORDING:
      return await recorderController.stop()
    case MSG.GET_RECORDING_STATUS:
      return { success: true, data: { isRecording: recorderController.isRecording() } }

    // 分析
    case MSG.ANALYZE_NODE_ROLES: {
      const { nodes: roleNodes } = data as { nodes: OperationNode[] }
      const recommendations = analyzeNodeRoles(roleNodes)
      return { success: true, data: recommendations }
    }
    case MSG.ANALYZE_STRUCTURAL: {
      const { nodes: structuralNodes } = data as { nodes: OperationNode[] }
      const structuralResult = runStructuralAnalysis(structuralNodes)
      return { success: true, data: structuralResult }
    }

    case MSG.GENERATE_TRACE_PACKAGE: {
      if (!isTracePackageExportRequest(data)) {
        return { success: false, error: 'TRACE_PACKAGE_INVALID_REQUEST' }
      }
      const tracePackage = generateTracePackage(data.toolSet, {
        packageId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        producerVersion: chrome.runtime.getManifest().version,
      })
      return { success: true, data: tracePackage }
    }

    // 工具集
    case MSG.TOOLSET_CREATE: {
      const { name, description, nodes, operationTrees, targetUrl } = data as {
        name: string
        description?: string
        nodes?: OperationNode[]
        operationTrees?: OperationTreeInfo[]
        targetUrl?: string
      }
      const newToolSet: ToolSet = {
        id: crypto.randomUUID(),
        name,
        description: description ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        targetUrl,
        operationTrees: operationTrees ?? [],
        operationNodes: nodes ?? [],
        metadata: {},
      }
      await storageManager.saveToolSet(newToolSet)
      return { success: true, data: newToolSet }
    }
    case MSG.TOOLSET_LIST: {
      const list = await storageManager.listToolSets()
      return { success: true, data: list }
    }
    case MSG.TOOLSET_LOAD: {
      const id = typeof data === 'string' ? data : (data as { id: string }).id
      const toolSet = await storageManager.getToolSet(id)
      return { success: true, data: toolSet }
    }
    case MSG.TOOLSET_SAVE: {
      await storageManager.saveToolSet(data as Parameters<typeof storageManager.saveToolSet>[0])
      return { success: true }
    }
    case MSG.TOOLSET_DELETE: {
      const id = typeof data === 'string' ? data : (data as { id: string }).id
      await storageManager.deleteToolSet(id)
      return { success: true }
    }

    // 回溯重放
    case MSG.REPLAY_START: {
      const { leafNodeId, nodes } = data as { leafNodeId: string; nodes: OperationNode[] }
      return await replayController.start(leafNodeId, nodes)
    }
    case MSG.REPLAY_ABORT: {
      return await replayController.abort()
    }

    // 选择器拾取
    case MSG.START_SELECTOR_PICKER: {
      const { originalSelector, originalTagName, originalText, parentSelector, elementIndex } = data as {
        originalSelector: string
        originalTagName?: string
        originalText?: string
        parentSelector?: string
        elementIndex?: number
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      await sendToContentScript(tab.id, CS_MSG.START_SELECTOR_PICKER, {
        originalSelector,
        originalTagName,
        originalText,
        parentSelector,
        elementIndex,
      })
      return { success: true }
    }
    case MSG.STOP_SELECTOR_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) await sendToContentScript(tab.id, CS_MSG.STOP_SELECTOR_PICKER)
      return { success: true }
    }
    case MSG.INFER_SELECTOR_PATTERN: {
      const inferData = data as { originalSelector: string; pickedSelectors?: string[] }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      const result = await sendToContentScript(tab.id, CS_MSG.INFER_SELECTOR_PATTERN, inferData)
      return { success: true, data: (result as { data?: unknown }).data ?? result }
    }
    case MSG.LOOP_TARGET_PREVIEW_TEST: {
      const previewData = data as {
        fullSelector: string
        clickTargetWithinItem?: string
        index: number
        highlightMs?: number
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      const result = await sendToContentScript(tab.id, CS_MSG.LOOP_TARGET_PREVIEW_TEST, previewData)
      return { success: true, data: (result as { data?: unknown }).data ?? result }
    }
    case MSG.LOOP_TARGET_PREVIEW_SCAN: {
      const previewData = data as {
        fullSelector: string
        clickTargetWithinItem?: string
        maxScan: number
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      const result = await sendToContentScript(tab.id, CS_MSG.LOOP_TARGET_PREVIEW_SCAN, previewData)
      return { success: true, data: (result as { data?: unknown }).data ?? result }
    }

    case MSG.TEST_SELECTOR_HIGHLIGHT: {
      const highlightData = data as {
        selector: string
        highlightMs?: number
        frameId?: number
        frameUrl?: string
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      // 解析目标 frameId：元素可能在 iframe 内（如富文本编辑器），需在正确 frame 中查询
      let frameId = highlightData.frameId ?? 0
      if (highlightData.frameUrl) {
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id })
          const match = frames?.find(
            f =>
              f.url === highlightData.frameUrl ||
              (highlightData.frameUrl && f.url.includes(highlightData.frameUrl))
          )
          if (match) frameId = match.frameId
        } catch {
          // 无 webNavigation 或未就绪，使用原始 frameId
        }
      }
      const result = await sendToContentScript(
        tab.id,
        CS_MSG.TEST_SELECTOR_HIGHLIGHT,
        { selector: highlightData.selector, highlightMs: highlightData.highlightMs },
        { frameId }
      )
      return { success: true, data: (result as { data?: unknown }).data ?? result }
    }

    case MSG.START_CONTENT_EXTRACT_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      await sendToContentScript(tab.id, CS_MSG.START_CONTENT_EXTRACT_PICKER)
      return { success: true }
    }

    case MSG.STOP_CONTENT_EXTRACT_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) await sendToContentScript(tab.id, CS_MSG.STOP_CONTENT_EXTRACT_PICKER)
      return { success: true }
    }

    case MSG.START_UPLOAD_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      await sendToContentScript(tab.id, CS_MSG.START_UPLOAD_PICKER)
      return { success: true }
    }

    case MSG.STOP_UPLOAD_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) await sendToContentScript(tab.id, CS_MSG.STOP_UPLOAD_PICKER)
      return { success: true }
    }

    case MSG.START_HOVER_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      await sendToContentScript(tab.id, CS_MSG.START_HOVER_PICKER)
      return { success: true }
    }

    case MSG.STOP_HOVER_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) await sendToContentScript(tab.id, CS_MSG.STOP_HOVER_PICKER)
      return { success: true }
    }

    case MSG.START_WAIT_ELEMENT_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { success: false, error: '无法获取当前活动标签页' }
      await sendToContentScript(tab.id, CS_MSG.START_WAIT_ELEMENT_PICKER, data)
      return { success: true }
    }

    case MSG.STOP_WAIT_ELEMENT_PICKER: {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) await sendToContentScript(tab.id, CS_MSG.STOP_WAIT_ELEMENT_PICKER)
      return { success: true }
    }

    default:
      return { success: false, error: `Unknown message type: ${type}` }
  }
}
