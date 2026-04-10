// 回溯重放控制器 — 管理重放生命周期

import { CS_MSG, EVENT } from '@/types/message'
import type { RecordedAction } from '@/types/action'
import type { OperationNode, ReplayStepResult, ReplayCompleteResult } from '@/types/operationTree'
import { sendToContentScript, broadcastToSidePanel } from '@/utils/messaging'
import { recorderController } from './recorderController'

const NAV_TIMEOUT = 30_000
const NAV_SETTLE_DELAY = 500        // 同页导航完成后的稳定等待
const NEW_TAB_SETTLE_DELAY = 2000   // 新标签页加载完成后的稳定等待（JS 框架初始化需要更长时间）
const ACTION_TYPES_MAY_NAVIGATE = new Set(['navigate', 'click', 'keydown'])
const ACTION_DELAY = 1500 // 每个操作后的默认延迟

interface ReplayState {
  isReplaying: boolean
  path: OperationNode[]
  currentIndex: number
  targetTabId: number | null
  pendingNewTabId: number | null  // 点击触发的新标签页，等待切换
  stepResults: ReplayStepResult[]
  startTime: number
}

const state: ReplayState = {
  isReplaying: false,
  path: [],
  currentIndex: 0,
  targetTabId: null,
  pendingNewTabId: null,
  stepResults: [],
  startTime: 0,
}

// 导航等待的 resolve/reject（跨消息回调）
let navigationResolve: (() => void) | null = null
let navigationTimeout: ReturnType<typeof setTimeout> | null = null

function reset() {
  state.isReplaying = false
  state.path = []
  state.currentIndex = 0
  state.targetTabId = null
  state.pendingNewTabId = null
  state.stepResults = []
  state.startTime = 0
  navigationResolve = null
  if (navigationTimeout) {
    clearTimeout(navigationTimeout)
    navigationTimeout = null
  }
}

/**
 * 确保 Content Script 已注入并就绪
 */
async function ensureContentScript(tabId: number): Promise<void> {
  let isActive = false
  try {
    await sendToContentScript(tabId, CS_MSG.GET_PAGE_INFO)
    isActive = true
  } catch {
    // CS 未注入或不活跃
  }

  if (!isActive) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/content.js'],
      })
    } catch (e) {
      console.error('[YOSO Replay] Failed to inject content script:', e)
      throw new Error('Content Script 注入失败')
    }
    // 等待 CS 初始化
    await new Promise(resolve => setTimeout(resolve, NAV_SETTLE_DELAY))
  }
}

/**
 * 等待页面导航完成
 */
function waitForNavigation(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    navigationResolve = resolve

    navigationTimeout = setTimeout(() => {
      navigationResolve = null
      reject(new Error(`页面导航超时 (${NAV_TIMEOUT}ms)`))
    }, NAV_TIMEOUT)
  })
}

/**
 * 建从节点数组回造操作路径（根到指定叶子）
 */
function buildPathToLeaf(leafNodeId: string, nodes: OperationNode[]): OperationNode[] {
  const nodeMap = new Map<string, OperationNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  const path: OperationNode[] = []
  let current = nodeMap.get(leafNodeId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? nodeMap.get(current.parentId) : undefined
  }

  return path
}

/**
 * 执行 navigate 操作：通过 chrome.tabs.update 导航并等待加载完成
 */
async function executeNavigate(url: string): Promise<void> {
  const tabId = state.targetTabId!

  // 如果当前页面 URL 已经匹配，跳过导航
  const tab = await chrome.tabs.get(tabId)
  if (tab.url === url) return

  // 导航并等待加载完成
  const loadPromise = waitForNavigation(tabId)
  await chrome.tabs.update(tabId, { url })
  await loadPromise

  // 导航完成后等待页面稳定并重新注入 CS
  await new Promise(resolve => setTimeout(resolve, NAV_SETTLE_DELAY))
  await ensureContentScript(tabId)
}

/**
 * 解析执行操作的目标 frameId：优先按 frameUrl 匹配（重载后仍有效），否则用录制时的 frameId 或主框架 0
 */
async function resolveFrameId(tabId: number, action: RecordedAction): Promise<number> {
  if (action.frameUrl) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId })
      const match = frames?.find(
        f => f.url === action.frameUrl || (action.frameUrl && f.url.includes(action.frameUrl))
      )
      if (match) return match.frameId
    } catch {
      // 无 webNavigation 或未就绪
    }
  }
  return action.frameId ?? 0
}

/**
 * 执行下一步操作
 */
async function executeNextStep(): Promise<void> {
  if (!state.isReplaying || state.currentIndex >= state.path.length) {
    finishReplay(true)
    return
  }

  const node = state.path[state.currentIndex]
  const action = node.metadata.selectorOverride
    ? { ...node.action, selector: node.metadata.selectorOverride }
    : node.action
  const stepStart = Date.now()

  try {
    if (action.type === 'navigate' && action.url) {
      // navigate 操作由 Background 直接通过 chrome.tabs API 执行
      await executeNavigate(action.url)
    } else {
      // 其他操作通过 Content Script 执行（含 iframe 内操作：发往对应 frame）
      await ensureContentScript(state.targetTabId!)

      const frameId = await resolveFrameId(state.targetTabId!, action)
      const result = await sendToContentScript<{ success: boolean; error?: string }>(
        state.targetTabId!,
        CS_MSG.REPLAY_EXECUTE_ACTION,
        action,
        { frameId }
      )

      if (!result.success) {
        throw new Error(result.error || '操作执行失败')
      }

      // click/keydown 可能触发同页导航或打开新标签页
      if (
        ACTION_TYPES_MAY_NAVIGATE.has(action.type) &&
        state.currentIndex + 1 < state.path.length
      ) {
        // 先等待足够时间，让浏览器完成新标签页创建 / 页面导航启动
        await new Promise(resolve => setTimeout(resolve, 800))

        if (state.pendingNewTabId !== null) {
          // 点击打开了新标签页，切换回溯目标到新标签页
          const newTabId = state.pendingNewTabId
          state.pendingNewTabId = null
          state.targetTabId = newTabId

          // 等待新标签页加载完成（若仍在加载中则通过 onUpdated 事件触发）
          const newTab = await chrome.tabs.get(newTabId).catch(() => null)
          if (newTab && newTab.status !== 'complete') {
            await waitForNavigation(newTabId)
          }
          // 新标签页需要更长的稳定等待：JS 框架（React/Vue）需时间完成初始化渲染
          await new Promise(resolve => setTimeout(resolve, NEW_TAB_SETTLE_DELAY))
        } else {
          // 同标签页导航：补足剩余等待时间
          await new Promise(resolve => setTimeout(resolve, 700))
        }

        // 重新注入 CS（新标签页 / 导航后的页面均需重新注入）
        await ensureContentScript(state.targetTabId!)
      }
    }

    const stepResult: ReplayStepResult = {
      nodeId: node.id,
      stepIndex: state.currentIndex,
      totalSteps: state.path.length,
      success: true,
      duration: Date.now() - stepStart,
    }
    state.stepResults.push(stepResult)

    // 广播步骤结果
      broadcastToSidePanel(EVENT.REPLAY_STEP_RESULT, stepResult)

      state.currentIndex++

      // 添加操作间隔延迟，确保 DOM 更新
      await new Promise(resolve => setTimeout(resolve, ACTION_DELAY))

      // 继续下一步
      if (state.isReplaying) {
        await executeNextStep()
      }
  } catch (err) {
    const stepResult: ReplayStepResult = {
      nodeId: node.id,
      stepIndex: state.currentIndex,
      totalSteps: state.path.length,
      success: false,
      error: (err as Error).message,
      duration: Date.now() - stepStart,
    }
    state.stepResults.push(stepResult)

    broadcastToSidePanel(EVENT.REPLAY_STEP_RESULT, stepResult)
    finishReplay(false)
  }
}

/**
 * 完成重放
 */
function finishReplay(success: boolean) {
  const result: ReplayCompleteResult = {
    success,
    totalSteps: state.path.length,
    completedSteps: state.stepResults.filter(r => r.success).length,
    totalDuration: Date.now() - state.startTime,
    stepResults: [...state.stepResults],
  }

  if (!success) {
    const failedStep = state.stepResults.find(r => !r.success)
    if (failedStep) {
      result.failedAtIndex = failedStep.stepIndex
      result.failedError = failedStep.error
    }
  }

  broadcastToSidePanel(EVENT.REPLAY_COMPLETE, result)

  // 移除导航监听与新标签页监听
  chrome.tabs.onUpdated.removeListener(handleTabUpdatedForReplay)
  chrome.tabs.onCreated.removeListener(handleTabCreatedForReplay)

  reset()
}

/**
 * 监听标签页更新（导航完成后重新注入 CS 并继续）
 */
function handleTabUpdatedForReplay(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo
) {
  if (
    state.isReplaying &&
    tabId === state.targetTabId &&
    changeInfo.status === 'complete'
  ) {
    // 页面加载完成，如果有等待导航的回调，触发它
    if (navigationResolve) {
      const resolve = navigationResolve
      navigationResolve = null
      if (navigationTimeout) {
        clearTimeout(navigationTimeout)
        navigationTimeout = null
      }
      resolve()
    }
  }
}

/**
 * 监听新标签页创建（点击 target="_blank" 链接时触发）
 * 记录新标签页 ID，供后续切换 targetTabId 使用
 */
function handleTabCreatedForReplay(tab: chrome.tabs.Tab) {
  if (state.isReplaying && tab.id) {
    state.pendingNewTabId = tab.id
  }
}

export const replayController = {
  /**
   * 开始回溯重放
   */
  async start(
    leafNodeId: string,
    nodes: OperationNode[]
  ): Promise<{ success: boolean; error?: string }> {
    // 检查是否正在录制
    if (recorderController.isRecording()) {
      return { success: false, error: '请先停止录制再启动重放' }
    }

    if (state.isReplaying) {
      return { success: false, error: '已有重放正在进行中' }
    }

    // 构建路径
    const path = buildPathToLeaf(leafNodeId, nodes)
    if (path.length === 0) {
      return { success: false, error: '无法构建到该节点的路径' }
    }

    // 获取目标标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: '未找到活动标签页' }
    }

    // 初始化状态
    state.isReplaying = true
    state.path = path
    state.currentIndex = 0
    state.targetTabId = tab.id
    state.stepResults = []
    state.startTime = Date.now()

    // 添加导航监听与新标签页监听
    chrome.tabs.onUpdated.addListener(handleTabUpdatedForReplay)
    chrome.tabs.onCreated.addListener(handleTabCreatedForReplay)

    // 开始执行
    executeNextStep().catch((err) => {
      console.error('[YOSO Replay] Unexpected error:', err)
      finishReplay(false)
    })

    return { success: true }
  },

  /**
   * 中止重放
   */
  async abort(): Promise<{ success: boolean; error?: string }> {
    if (!state.isReplaying) {
      return { success: false, error: '没有正在进行的重放' }
    }

    state.isReplaying = false
    chrome.tabs.onUpdated.removeListener(handleTabUpdatedForReplay)
    chrome.tabs.onCreated.removeListener(handleTabCreatedForReplay)

    broadcastToSidePanel(EVENT.REPLAY_ABORTED, {
      completedSteps: state.stepResults.filter(r => r.success).length,
      totalSteps: state.path.length,
      stepResults: [...state.stepResults],
    })

    reset()
    return { success: true }
  },

  isReplaying(): boolean {
    return state.isReplaying
  },
}
