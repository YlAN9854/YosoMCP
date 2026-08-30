import { useEffect } from 'react'
import { EVENT, MSG } from '@/types/message'
import type { RecordedAction } from '@/types/action'
import { LOOP_BODY_END_SELF } from '@/types/operationTree'
import type { LoopTargetPattern, NodeRoleRecommendation, OperationNode } from '@/types/operationTree'
import type { RepeatPattern, StructuralAnalysisResult } from '@/types/analysis'
import type { SelectorPatternResult } from '@/types/selectorPicker'
import type { ContentExtractPickedResult } from '@/types/contentExtract'
import type { UploadPickedResult } from '@/content/uploadPicker'
import type { HoverPickedResult } from '@/content/hoverPicker'
import type { WaitElementPickedResult } from '@/content/waitElementPicker'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { sendToBackground } from '@/utils/messaging'
import RecordingControls from './RecordingControls'
import OperationTreeView from './OperationTreeView'
import { v4 as uuidv4 } from 'uuid'
import ReplayOverlay from './ReplayOverlay'
import { useReplayStore } from '@/sidepanel/stores/replayStore'
import { useLocaleStore } from '@/sidepanel/stores/localeStore'
import { translate } from '@/sidepanel/locales/translate'
import type { ReplayStepResult, ReplayCompleteResult } from '@/types/operationTree'

export default function RecordingTab() {
  const addAction = useRecorderStore(s => s.addAction)
  const setStatus = useRecorderStore(s => s.setStatus)
  const replayStatus = useReplayStore(s => s.status)
  const handleStepResult = useReplayStore(s => s.handleStepResult)
  const handleComplete = useReplayStore(s => s.handleComplete)
  const handleAborted = useReplayStore(s => s.handleAborted)

  const triggerNodeRoleAnalysis = async () => {
    const currentNodes = useRecorderStore.getState().nodes
    const needsRoleAssignment = (n: OperationNode) => n.metadata.nodeRole === undefined

    /** 已有角色但未写入 metadata.candidates（例如先于角色分析被标为 loop_target 的点击） */
    const needsCandidateEnrichment = (n: OperationNode) => {
      if (n.action.type !== 'click' && n.action.type !== 'dblclick') return false
      if (!(n.action.branchCandidates?.length)) return false
      if (n.metadata.candidates && n.metadata.candidates.length > 0) return false
      const role = n.metadata.nodeRole
      if (role === undefined) return false
      return (
        role === 'loop_target' ||
        role === 'normal' ||
        role === 'branch_point' ||
        role === 'enum_param'
      )
    }

    const nodesToAnalyze = currentNodes.filter(
      n => needsRoleAssignment(n) || needsCandidateEnrichment(n)
    )
    if (nodesToAnalyze.length === 0) return
    try {
      const recommendations = await sendToBackground<NodeRoleRecommendation[]>(
        MSG.ANALYZE_NODE_ROLES,
        { nodes: nodesToAnalyze }
      )
      if (recommendations) {
        useRecorderStore.getState().applyNodeRoleRecommendations(recommendations)
      }
    } catch (err) {
      console.error('Node role inference failed:', err)
    }
  }

  const applyRepeatPatternMetadata = async (patterns: RepeatPattern[]) => {
    const store = useRecorderStore.getState()
    const currentNodes = store.nodes
    if (currentNodes.length === 0) return

    const nodeMap = new Map(currentNodes.map(n => [n.id, n]))
    const nodeMarkMap = new Map<string, { isLoopStart?: boolean; loopCount?: number; repeatGroupId?: string; repeatLabel?: string }>()
    const autoLoopTargetMap = new Map<string, { loopBodyEndNodeId?: string; loopTargetPattern?: LoopTargetPattern }>()

    for (const [patternIdx, pattern] of patterns.entries()) {
      const groupId = `auto-repeat-${patternIdx}`
      const label = translate(useLocaleStore.getState().locale, 'recording.loopLabel', {
        repeat: pattern.repeatCount,
        steps: pattern.patternLength,
      })

      pattern.patternNodeIds.forEach((occurrence) => {
        occurrence.forEach((nodeId) => {
          nodeMarkMap.set(nodeId, {
            repeatGroupId: groupId,
            repeatLabel: label,
          })
        })
      })

      const firstOccurrence = pattern.patternNodeIds[0]
      if (!firstOccurrence || firstOccurrence.length === 0) return
      const firstNodeId = firstOccurrence[0]
      const loopBodyEndNodeId = pattern.patternLength === 1
        ? LOOP_BODY_END_SELF
        : firstOccurrence[firstOccurrence.length - 1]

      const inferredPattern = await inferLoopTargetPatternFromRepeat(pattern, nodeMap)
      if (inferredPattern) {
        autoLoopTargetMap.set(firstNodeId, {
          loopBodyEndNodeId,
          loopTargetPattern: inferredPattern,
        })
      }

      nodeMarkMap.set(firstNodeId, {
        ...(nodeMarkMap.get(firstNodeId) || {}),
        isLoopStart: true,
        loopCount: pattern.repeatCount,
        repeatGroupId: groupId,
        repeatLabel: label,
      })
    }

    const updatedNodes = currentNodes.map(node => {
      const mark = nodeMarkMap.get(node.id)
      const baseMetadata = {
        ...node.metadata,
      }

      // 每次重新分析先清理「自动检测」循环标记，避免旧结果残留。
      // 手动设置的循环组（repeatGroupId 以 'manual-loop-' 开头）不清除，
      // 否则停止录制后用户手动配置的折叠状态会丢失。
      const isAutoGroup = baseMetadata.repeatGroupId?.startsWith('auto-')
      if (isAutoGroup) {
        delete baseMetadata.isLoopStart
        delete baseMetadata.loopCount
        delete baseMetadata.repeatGroupId
        delete baseMetadata.repeatLabel
      }

      if (!mark) {
        return {
          ...node,
          metadata: baseMetadata,
        }
      }

      // 用户已手动设置过角色时不再叠自动循环标记；否则续录停止后会再次把已改为枚举的筛选等标成 auto-repeat 并默认折叠
      if (node.metadata.nodeRoleSource === 'user') {
        return {
          ...node,
          metadata: baseMetadata,
        }
      }

      const autoLoop = autoLoopTargetMap.get(node.id)
      const shouldAutoSetLoopTargetRole = !!autoLoop

      return {
        ...node,
        metadata: {
          ...baseMetadata,
          ...mark,
          ...(shouldAutoSetLoopTargetRole
            ? {
                nodeRole: 'loop_target' as const,
                nodeRoleSource: 'auto' as const,
              }
            : {}),
          ...(autoLoop?.loopBodyEndNodeId ? { loopBodyEndNodeId: autoLoop.loopBodyEndNodeId } : {}),
          ...(autoLoop?.loopTargetPattern ? { loopTargetPattern: autoLoop.loopTargetPattern } : {}),
        },
      }
    })

    store.setNodes(updatedNodes)
  }

  const triggerLoopAnalysisOnStop = async () => {
    const currentNodes = useRecorderStore.getState().nodes
    if (currentNodes.length < 2) return
    try {
      const structuralResult = await sendToBackground<StructuralAnalysisResult>(
        MSG.ANALYZE_STRUCTURAL,
        { nodes: currentNodes }
      )

      const repeatPatterns = structuralResult?.repeatPatterns || []
      await applyRepeatPatternMetadata(repeatPatterns)
    } catch (err) {
      console.error('[YOSO] recording stopped structural analyze failed', err)
    }
  }

  // 监听 Background 广播的事件
  useEffect(() => {
    const listener = (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case EVENT.ACTION_RECORDED:
          useRecorderStore.getState().addAction(message.data as RecordedAction)
          break
        case EVENT.RECORDING_STARTED: {
          setStatus('recording')
          // 仅在普通录制模式下插入 navigate 根节点
          const recModeOnStart = useRecorderStore.getState().recordingMode
          if (recModeOnStart === 'normal') {
            const eventData = message.data as { tabId?: number; url?: string } | undefined
            if (eventData?.url) {
              addAction({
                id: crypto.randomUUID?.() ?? Date.now().toString(),
                type: 'navigate',
                selector: '',
                url: eventData.url,
                timestamp: Date.now(),
              })
            }
          }
          break
        }
        case EVENT.RECORDING_PAUSED:
          setStatus('paused')
          break
        case EVENT.RECORDING_RESUMED:
          setStatus('recording')
          break
        case EVENT.RECORDING_STOPPED:
          setStatus('idle')
          useRecorderStore.getState().resetTreeRecording()
          // 录制停止后先做结构循环分析，再做节点角色推断
          ;(async () => {
            await triggerLoopAnalysisOnStop()
            await triggerNodeRoleAnalysis()
          })()
          break
        case EVENT.REPLAY_STEP_RESULT:
          handleStepResult(message.data as ReplayStepResult)
          break
        case EVENT.REPLAY_COMPLETE: {
          const replayResult = message.data as ReplayCompleteResult
          handleComplete(replayResult)
          // 继续录制/分支录制：回放完成后自动开始录制
          const recMode = useRecorderStore.getState().recordingMode
          if (recMode === 'continue' || recMode === 'branch') {
            if (replayResult.success) {
              useReplayStore.getState().reset()
              sendToBackground(MSG.START_RECORDING, { showIndicator: true }).catch(() => {
                useRecorderStore.getState().resetTreeRecording()
              })
            } else {
              useRecorderStore.getState().resetTreeRecording()
            }
          }
          break
        }
        case EVENT.REPLAY_ABORTED:
          handleAborted()
          useRecorderStore.getState().resetTreeRecording()
          break
        case EVENT.SELECTOR_PICKER_RESULT: {
          // 拾取结果已包含推断结果（在 content script 中完成推断）
          const pickerResult = message.data as { patternResult: import('@/types/selectorPicker').SelectorPatternResult }
          const patternResult = pickerResult?.patternResult
          if (patternResult?.success && patternResult.pattern) {
            useRecorderStore.getState().handleSelectorPickerResult(patternResult.pattern)
          } else {
            const errorMsg =
              patternResult?.error ||
              translate(useLocaleStore.getState().locale, 'recording.selectorInferFailed')
            useRecorderStore.setState({ selectorPickerActive: false, selectorPickerNodeId: null, selectorPickerError: errorMsg })
          }
          break
        }
        case EVENT.CONTENT_EXTRACT_PICKED: {
          useRecorderStore.getState().handleContentExtractResult(
            message.data as ContentExtractPickedResult
          )
          break
        }
        case EVENT.CONTENT_EXTRACT_CANCELLED: {
          useRecorderStore.setState({
            contentExtractPickerActive: false,
            contentExtractAnchorNodeId: null,
          })
          break
        }
        case EVENT.UPLOAD_PICKED: {
          useRecorderStore.getState().handleUploadPickerResult(
            message.data as UploadPickedResult
          )
          break
        }
        case EVENT.UPLOAD_CANCELLED: {
          useRecorderStore.setState({
            uploadPickerActive: false,
            uploadPickerAnchorNodeId: null,
          })
          break
        }
        case EVENT.HOVER_PICKED: {
          useRecorderStore.getState().handleHoverPickerResult(
            message.data as HoverPickedResult
          )
          break
        }
        case EVENT.HOVER_CANCELLED: {
          useRecorderStore.setState({
            hoverPickerActive: false,
            hoverPickerAnchorNodeId: null,
          })
          break
        }
        case EVENT.WAIT_ELEMENT_PICKED: {
          const result = message.data as WaitElementPickedResult
          const store = useRecorderStore.getState()
          const diff = store.pendingWaitDiff
          const waitComment = result.waitComment

          const common = {
            id: uuidv4(),
            timestamp: Date.now(),
          }

          let action: RecordedAction
          if (result.choiceType === 'url' && diff) {
            action = {
              ...common,
              type: 'wait_for_url',
              selector: '',
              url: diff.newUrl,
              comment: `Wait for navigation to ${diff.newUrl}`,
              waitTimeout: Math.max((diff.duration || 5000) + 5000, 30000),
            }
          } else if (result.choiceType === 'timeout' && diff) {
            action = {
              ...common,
              type: 'wait_for_timeout',
              selector: '',
              comment: `Wait for ${Math.ceil((diff.duration || 5000) / 1000)} seconds`,
              waitTimeout: diff.duration || 5000,
            }
          } else {
            action = {
              ...common,
              type: 'wait_for_selector',
              selector: result.selector,
              innerText: result.innerText,
              tagName: result.tagName,
              attributes: result.attributes,
              comment: `Wait for element ${result.selector} to appear`,
              waitState: 'visible',
              waitTimeout: Math.max((diff?.duration || 5000) + 5000, 30000),
            }
          }

          const loc = useLocaleStore.getState().locale
          if (waitComment === 'login') {
            action.comment = translate(loc, 'recording.waitCommentLogin')
          } else if (waitComment === 'content') {
            action.comment = translate(loc, 'recording.waitCommentContent')
          }

          store.addAction(action)
          store.resetSmartWait()

          sendToBackground(MSG.RESUME_RECORDING)
            .then(() => store.setStatus('recording'))
            .catch(err => console.error('Failed to resume recording:', err))
          break
        }
        case EVENT.WAIT_ELEMENT_CANCELLED: {
          useRecorderStore.getState().resetSmartWait()
          break
        }
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [addAction, setStatus, handleStepResult, handleComplete, handleAborted])

  return (
    <div className="flex flex-col h-full relative">
      <RecordingControls />
      <div className="flex-1 overflow-y-auto">
        <OperationTreeView />
      </div>
      {/* Replay Overlay */}
      {replayStatus !== 'idle' && <ReplayOverlay />}
    </div>
  )
}

function buildAutoLoopTargetPattern(
  repeatPattern: RepeatPattern,
  nodeMap: Map<string, OperationNode>
): LoopTargetPattern | undefined {
  const startNodes = repeatPattern.patternNodeIds
    .map(occurrence => nodeMap.get(occurrence[0]))
    .filter((n): n is OperationNode => !!n)
    .filter(n => n.action.type === 'click' || n.action.type === 'dblclick')

  if (startNodes.length === 0) return undefined

  const base = startNodes[0]
  const tagName = base.action.tagName || '*'
  const containerSelector = base.action.parentSelector || ''
  const itemSelector = tagName.toLowerCase()

  let fullSelector = ''
  if (containerSelector) {
    fullSelector = `${containerSelector} > ${itemSelector}`
  } else {
    fullSelector = (base.action.selector || '')
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/:nth-of-type\(\d+\)/g, '')
      .trim()
  }

  if (!fullSelector) return undefined

  return {
    containerSelector,
    itemSelector,
    fullSelector,
    matchCount: startNodes.length,
    sampleTexts: startNodes.map(n => (n.action.innerText || '').trim()).filter(Boolean).slice(0, 5),
  }
}

async function inferLoopTargetPatternFromRepeat(
  repeatPattern: RepeatPattern,
  nodeMap: Map<string, OperationNode>
): Promise<LoopTargetPattern | undefined> {
  const firstOccurrence = repeatPattern.patternNodeIds[0]
  if (!firstOccurrence || firstOccurrence.length === 0) return undefined

  const firstNodeId = firstOccurrence[0]
  const originalNode = nodeMap.get(firstNodeId)
  if (!originalNode) return buildAutoLoopTargetPattern(repeatPattern, nodeMap)

  const startNodes = repeatPattern.patternNodeIds
    .map(occurrence => nodeMap.get(occurrence[0]))
    .filter((n): n is OperationNode => !!n)

  const indexedSelector = originalNode.action.selector
  const originalCandidates = buildSelectorCandidates(originalNode)
  const pickedCandidatesList = startNodes
    .slice(1)
    .map(n => buildSelectorCandidates(n))
    .filter(list => list.length > 0)

  if (originalCandidates.length === 0 || pickedCandidatesList.length === 0) {
    return buildAutoLoopTargetPattern(repeatPattern, nodeMap)
  }

  // 尝试顺序：
  // 1) 同一选择器 + 命中索引（优先，避免 querySelector 命中同一元素）
  // 2) 位置/原始选择器 + pickedSelectors
  if (indexedSelector && startNodes.length >= 2) {
    const indexedSelectors = Array.from(new Set([
      indexedSelector,
      sanitizeSelectorForLoop(indexedSelector),
    ].filter(Boolean)))

    for (const selectorForIndex of indexedSelectors) {
    try {
      const inferResp = await sendToBackground<SelectorPatternResult>(
        MSG.INFER_SELECTOR_PATTERN,
        {
          originalSelector: selectorForIndex,
          originalSelectorIndex: 0,
          pickedSelectorTargets: startNodes.slice(1).map((_, idx) => ({
            selector: selectorForIndex,
            index: idx + 1,
          })),
        }
      )

      if (inferResp?.success && inferResp.pattern) {
        if (!isPatternTooGenericForContext(inferResp.pattern, originalNode)) {
          return inferResp.pattern
        }
      }
    } catch {
      // 忽略单次候选的异常，继续尝试下一个
    }
  }
  }

  for (const originalSelector of originalCandidates) {
    const pickedSelectors = pickedCandidatesList
      .map(list => chooseBestPickedCandidate(list, originalSelector))
      .filter(Boolean)

    if (pickedSelectors.length === 0) continue

    try {
      const inferResp = await sendToBackground<SelectorPatternResult>(
        MSG.INFER_SELECTOR_PATTERN,
        {
          originalSelector,
          pickedSelectors,
        }
      )

      if (inferResp?.success && inferResp.pattern) {
        if (!isPatternTooGenericForContext(inferResp.pattern, originalNode)) {
          return inferResp.pattern
        }
      }
    } catch {
      // 忽略单次候选的异常，继续尝试下一个
    }
  }

  return (
    buildParentSelectorLoopPattern(repeatPattern, nodeMap)
    || buildAutoLoopTargetPattern(repeatPattern, nodeMap)
  )
}

function buildSelectorCandidates(node: OperationNode): string[] {
  const candidates: string[] = []
  const action = node.action
  const tag = action.tagName?.toLowerCase()
  const parent = action.parentSelector
  const index = action.elementIndex

  if (parent && typeof index === 'number' && index >= 0) {
    if (tag) {
      // listDetector 的 index 是同 tag 序号，优先 nth-of-type
      candidates.push(`${parent} > ${tag}:nth-of-type(${index + 1})`)
      // 兼容某些页面结构，补一个 nth-child 尝试
      candidates.push(`${parent} > ${tag}:nth-child(${index + 1})`)
    }
    candidates.push(`${parent} > *:nth-child(${index + 1})`)
  }

  if (action.selector) {
    candidates.push(action.selector)
  }

  const withSanitized = candidates.flatMap(sel => {
    const sanitized = sanitizeSelectorForLoop(sel)
    return sanitized !== sel ? [sel, sanitized] : [sel]
  })

  return Array.from(new Set(withSanitized))
}

function sanitizeSelectorForLoop(selector: string): string {
  return selector
    .replace(/\.hover\b/g, '')
    .replace(/\.active\b/g, '')
    .replace(/\.selected\b/g, '')
    .replace(/\.focus\b/g, '')
    .replace(/\.current\b/g, '')
}

function chooseBestPickedCandidate(candidates: string[], originalSelector: string): string {
  const normalizedOriginal = sanitizeSelectorForLoop(originalSelector)
  const exact = candidates.find(c => c === normalizedOriginal || c === originalSelector)
  if (exact) return exact

  const originalLeaf = normalizedOriginal.split('>').pop()?.trim().toLowerCase()
  if (originalLeaf) {
    const sameLeaf = candidates.find(c =>
      (sanitizeSelectorForLoop(c).split('>').pop()?.trim().toLowerCase() || '') === originalLeaf
    )
    if (sameLeaf) return sameLeaf
  }

  return candidates[0]
}

function isPatternTooGenericForContext(
  pattern: LoopTargetPattern,
  originalNode: OperationNode
): boolean {
  const item = (pattern.itemSelector || '').trim().toLowerCase()
  if (!item) return true

  const genericItems = new Set(['*', 'div', 'span'])
  if (!genericItems.has(item)) return false

  const parentSelector = sanitizeSelectorForLoop(originalNode.action.parentSelector || '').toLowerCase()
  // 对表格/列表场景，item 退化到 div/span 基本可判定为过宽
  if (/\btr\b|\bli\b|\boption\b/.test(parentSelector)) return true

  return false
}

function buildParentSelectorLoopPattern(
  repeatPattern: RepeatPattern,
  nodeMap: Map<string, OperationNode>
): LoopTargetPattern | undefined {
  const startNodes = repeatPattern.patternNodeIds
    .map(occurrence => nodeMap.get(occurrence[0]))
    .filter((n): n is OperationNode => !!n)
    .filter(n => n.action.type === 'click' || n.action.type === 'dblclick')

  if (startNodes.length === 0) return undefined

  const base = startNodes[0]
  const rawParent = base.action.parentSelector
  if (!rawParent) return undefined

  const parentSelector = sanitizeSelectorForLoop(rawParent).trim()
  if (!parentSelector) return undefined

  const parts = parentSelector.split('>').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return undefined

  const itemSelector = parts[parts.length - 1]
  const containerSelector = parts.slice(0, -1).join(' > ')
  const fullSelector = containerSelector ? `${containerSelector} > ${itemSelector}` : itemSelector

  const clickSelector = sanitizeSelectorForLoop(base.action.selector || '')
  let clickTargetWithinItem: string | undefined
  if (clickSelector.startsWith(`${fullSelector} > `)) {
    clickTargetWithinItem = clickSelector.slice(fullSelector.length + 3).trim()
  } else if (clickSelector.startsWith(`${fullSelector} `)) {
    clickTargetWithinItem = clickSelector.slice(fullSelector.length + 1).trim()
  }

  return {
    containerSelector,
    itemSelector,
    fullSelector,
    matchCount: startNodes.length,
    clickTargetWithinItem,
    sampleTexts: startNodes.map(n => (n.action.innerText || '').trim()).filter(Boolean).slice(0, 5),
  }
}
