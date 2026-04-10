import { create } from 'zustand'
import type { RecordedAction } from '@/types/action'
import type { OperationNode } from '@/types/operationTree'
import type { NodeRole, NodeRoleRecommendation, NodeRoleCandidate, LoopTargetPattern } from '@/types/operationTree'
import { LOOP_BODY_END_SELF } from '@/types/operationTree'
import { buildClickNodeRoleCandidates } from '@/background/analyzer/structural/nodeRoleAnalyzer'
import { v4 as uuidv4 } from 'uuid'
import type { WaitDiff, PageSnapshot, ElementInfo } from '@/sidepanel/utils/smartWait'
import { sendToBackground } from '@/utils/messaging'
import { MSG, EVENT } from '@/types/message'
import type { ContentExtractPickedResult } from '@/types/contentExtract'
import type { UploadPickedResult } from '@/content/uploadPicker'
import { useLocaleStore } from '@/sidepanel/stores/localeStore'
import { translate } from '@/sidepanel/locales/translate'

/** 移除重复组 / loop_target 结构字段，避免改角色后仍显示 ×n 或参与折叠 */
function stripRepeatLoopStructure(meta: OperationNode['metadata']): OperationNode['metadata'] {
  const {
    repeatGroupId: _rg,
    isLoopStart: _ils,
    loopCount: _lc,
    repeatLabel: _rl,
    loopTargetPattern: _ltp,
    loopBodyEndNodeId: _lbe,
    ...rest
  } = meta
  return rest
}

function metadataWithUserRoleAndLazyCandidates(
  node: OperationNode,
  role: NodeRole,
  baseMetadata: OperationNode['metadata']
): OperationNode['metadata'] {
  // 手动切到循环目标时需先配置模式并「确认为循环目标」，不应与已确认的 user 态混淆
  const nodeRoleSource = role === 'loop_target' ? ('auto' as const) : ('user' as const)
  const next: OperationNode['metadata'] = {
    ...baseMetadata,
    nodeRole: role,
    nodeRoleSource,
  }
  const needsCandidates =
    (role === 'normal' || role === 'branch_point' || role === 'enum_param') &&
    !(next.candidates && next.candidates.length > 0)
  if (!needsCandidates) return next
  const built = buildClickNodeRoleCandidates(node)
  if (built && built.length > 0) {
    return { ...next, candidates: built }
  }
  return next
}

/** 在 parentId 构成的树中，从 rootId 出发可达的最深节点（同深取 timestamp 较大者） */
function findDeepestDescendantId(rootId: string, nodes: OperationNode[]): string | null {
  const root = nodes.find(n => n.id === rootId)
  if (!root) return null

  const byParent = new Map<string, OperationNode[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const list = byParent.get(n.parentId) || []
    list.push(n)
    byParent.set(n.parentId, list)
  }

  let best = root
  let bestDepth = 0
  const dfs = (node: OperationNode, depth: number) => {
    if (depth > bestDepth || (depth === bestDepth && node.timestamp > best.timestamp)) {
      best = node
      bestDepth = depth
    }
    for (const c of byParent.get(node.id) || []) {
      dfs(c, depth + 1)
    }
  }
  dfs(root, 0)
  return best.id
}

export type RecordingStatus = 'idle' | 'recording' | 'paused'
export type SmartWaitStatus = 'idle' | 'waiting' | 'picking'
export type RecordingMode = 'normal' | 'continue' | 'branch'

export interface LoopPreviewSingleResult {
  totalCount: number
  index: number
  itemMatched: boolean
  itemVisible: boolean
  clickTargetMatched: boolean
  clickTargetVisible: boolean
  hasClickTargetWithinItem: boolean
  reason?: string
}

export interface LoopPreviewScanRow {
  index: number
  itemMatched: boolean
  itemVisible: boolean
  clickTargetMatched: boolean
  clickTargetVisible: boolean
  hasClickTargetWithinItem: boolean
  reason?: string
}

export interface LoopPreviewScanResult {
  totalCount: number
  rows: LoopPreviewScanRow[]
}

export type { PageSnapshot, ElementInfo }

interface RecorderState {
  status: RecordingStatus
  nodes: OperationNode[]
  targetUrl: string | null
  
  // Smart Wait State
  smartWaitStatus: SmartWaitStatus
  smartWaitStartTime: number | null
  initialSnapshot: PageSnapshot | null
  pendingWaitDiff: WaitDiff | null

  // Tree Recording State
  recordingMode: RecordingMode
  activeRecordingParentId: string | null
  /** 续录开始时从该叶子回放；activeRecordingParentId 失效时用于回退到当前分支最深节点 */
  recordingContinuationRootId: string | null
  pendingBranchSide: 'left' | 'right' | null

  // 节点角色推荐（最近一次分析结果）
  nodeRoleRecommendations: NodeRoleRecommendation[]

  // 选择器拾取状态
  selectorPickerActive: boolean
  selectorPickerNodeId: string | null
  selectorPickerError: string | null

  // 内容提取拾取状态
  contentExtractPickerActive: boolean
  contentExtractAnchorNodeId: string | null
  contentExtractError: string | null

  // 文件上传拾取状态
  uploadPickerActive: boolean
  uploadPickerAnchorNodeId: string | null
  uploadPickerError: string | null

  // 悬停拾取状态
  hoverPickerActive: boolean
  hoverPickerAnchorNodeId: string | null
  hoverPickerError: string | null

  loopPreviewIndexByNodeId: Record<string, number>
  loopPreviewScanKByNodeId: Record<string, number>
  loopPreviewHighlightMs: number
  loopPreviewLastSingleResultByNodeId: Record<string, LoopPreviewSingleResult | undefined>
  loopPreviewLastScanResultsByNodeId: Record<string, LoopPreviewScanResult | undefined>
  loopPreviewTesting: boolean
  loopPreviewError: string | null

  // 选择器测试状态（结果需绑定 nodeId，避免切换展开面板时串台）
  selectorTestingNodeId: string | null
  selectorTestResult: { matched: boolean; visible: boolean; tagName?: string; innerText?: string } | null
  selectorTestResultNodeId: string | null

  setStatus: (status: RecordingStatus) => void
  addAction: (action: RecordedAction) => void
  setTargetUrl: (url: string | null) => void
  clearNodes: () => void
  deleteNode: (nodeId: string) => void
  deleteNodeAndDescendants: (nodeId: string) => void
  updateNode: (nodeId: string, updates: Partial<OperationNode>) => void
  insertNodeAfter: (nodeId: string, action: RecordedAction) => void
  setNodes: (nodes: OperationNode[]) => void
  
  startSmartWait: (startTime: number, snapshot: PageSnapshot) => void
  finishSmartWaitAndPick: (diff: WaitDiff) => void
  cancelWaitElementPicker: () => void
  resetSmartWait: () => void

  // Tree Recording Methods
  setRecordingMode: (mode: RecordingMode) => void
  setActiveRecordingParentId: (id: string | null) => void
  setRecordingContinuationRootId: (id: string | null) => void
  setPendingBranchSide: (side: 'left' | 'right' | null) => void
  resetTreeRecording: () => void

  // 节点角色分析 Methods
  applyNodeRoleRecommendations: (recommendations: NodeRoleRecommendation[]) => void
  acceptNodeRole: (nodeId: string) => void
  setNodeRole: (nodeId: string, role: NodeRole) => void
  toggleCandidate: (nodeId: string, candidateIndex: number) => void
  confirmEnumNode: (nodeId: string) => void
  confirmBranchNode: (nodeId: string) => void

  // 选择器拾取 / loop_target Methods
  startSelectorPicker: (nodeId: string) => void
  cancelSelectorPicker: () => void
  handleSelectorPickerResult: (pattern: LoopTargetPattern) => void
  startContentExtractPicker: (anchorNodeId: string) => void
  cancelContentExtractPicker: () => void
  handleContentExtractResult: (result: ContentExtractPickedResult) => void
  startUploadPicker: (anchorNodeId: string) => void
  cancelUploadPicker: () => void
  handleUploadPickerResult: (result: UploadPickedResult) => void
  startHoverPicker: (anchorNodeId: string) => void
  cancelHoverPicker: () => void
  handleHoverPickerResult: (result: { selector: string; innerText?: string; tagName?: string; attributes?: Record<string, string> }) => void
  confirmLoopTarget: (nodeId: string) => void
  setLoopBodyEnd: (loopTargetNodeId: string, endNodeId: string) => void
  setLoopPreviewIndex: (nodeId: string, index: number) => void
  setLoopPreviewScanK: (nodeId: string, k: number) => void
  testLoopPreviewAtIndex: (nodeId: string) => Promise<void>
  scanLoopPreviewRange: (nodeId: string) => Promise<void>
  clearLoopPreviewResults: (nodeId: string) => void

  // 选择器编辑
  updateNodeSelector: (nodeId: string, newSelector: string) => void
  resetNodeSelector: (nodeId: string) => void
  testSelectorHighlight: (nodeId: string) => Promise<void>
}

export const useRecorderStore = create<RecorderState>((set, get) => ({
  status: 'idle',
  nodes: [],
  targetUrl: null,
  
  smartWaitStatus: 'idle',
  smartWaitStartTime: null,
  initialSnapshot: null,
  pendingWaitDiff: null,

  // Tree Recording State
  recordingMode: 'normal' as RecordingMode,
  activeRecordingParentId: null,
  recordingContinuationRootId: null,
  pendingBranchSide: null,

  // 节点角色推荐
  nodeRoleRecommendations: [],

  // 选择器拾取状态
  selectorPickerActive: false,
  selectorPickerNodeId: null,
  selectorPickerError: null,

  contentExtractPickerActive: false,
  contentExtractAnchorNodeId: null,
  contentExtractError: null,

  uploadPickerActive: false,
  uploadPickerAnchorNodeId: null,
  uploadPickerError: null,

  hoverPickerActive: false,
  hoverPickerAnchorNodeId: null,
  hoverPickerError: null,

  loopPreviewIndexByNodeId: {},
  loopPreviewScanKByNodeId: {},
  loopPreviewHighlightMs: 2000,
  loopPreviewLastSingleResultByNodeId: {},
  loopPreviewLastScanResultsByNodeId: {},
  loopPreviewTesting: false,
  loopPreviewError: null,

  selectorTestingNodeId: null,
  selectorTestResult: null,
  selectorTestResultNodeId: null,

  setStatus: (status) => set({ status }),

  addAction: (action) => {
    const { nodes, activeRecordingParentId, pendingBranchSide, recordingMode, recordingContinuationRootId } = get()
    let parentId = activeRecordingParentId ?? (nodes.length > 0 ? nodes[nodes.length - 1].id : null)
    // 防止 parentId / activeRecordingParentId 指向已不存在的节点（子节点会从 buildTree 主链断开，画布不更新但 nodes.length 仍增加）
    if (parentId != null && nodes.length > 0 && !nodes.some((n) => n.id === parentId)) {
      if (recordingMode === 'continue' && recordingContinuationRootId) {
        const deepest = findDeepestDescendantId(recordingContinuationRootId, nodes)
        parentId = deepest ?? nodes[nodes.length - 1]!.id
      } else {
        parentId = nodes[nodes.length - 1]!.id
      }
    }

    const node: OperationNode = {
      id: action.id || uuidv4(),
      parentId,
      action,
      timestamp: action.timestamp,
      metadata: pendingBranchSide ? { branchSide: pendingBranchSide } : {},
    }

    set({
      nodes: [...nodes, node],
      activeRecordingParentId: node.id,
      pendingBranchSide: null,
    })
  },

  setTargetUrl: (url) => set({ targetUrl: url }),
  clearNodes: () =>
    set({
      nodes: [],
      selectorTestingNodeId: null,
      selectorTestResult: null,
      selectorTestResultNodeId: null,
      recordingContinuationRootId: null,
    }),
  deleteNode: (nodeId) => {
    const originalNodes = get().nodes
    const victim = originalNodes.find(n => n.id === nodeId)
    if (!victim) return

    const grandparentId = victim.parentId ?? null
    const newNodes = originalNodes
      .filter(n => n.id !== nodeId)
      .map(n => (n.parentId === nodeId ? { ...n, parentId: grandparentId } : n))

    const { activeRecordingParentId } = get()
    set({
      nodes: newNodes,
      ...(activeRecordingParentId === nodeId ? { activeRecordingParentId: grandparentId } : {}),
    })
  },

  deleteNodeAndDescendants: (nodeId) => {
    const nodes = get().nodes
    const toRemove = new Set<string>([nodeId])
    let size = 0
    while (size !== toRemove.size) {
      size = toRemove.size
      for (const n of nodes) {
        if (n.parentId && toRemove.has(n.parentId)) toRemove.add(n.id)
      }
    }
    set({ nodes: nodes.filter(n => !toRemove.has(n.id)) })
  },
  
  updateNode: (nodeId, updates) => {
    const nodes = get().nodes.map(n => 
      n.id === nodeId ? { ...n, ...updates } : n
    )
    set({ nodes })
  },

  insertNodeAfter: (nodeId, action) => {
    const { nodes, pendingBranchSide } = get()
    const index = nodes.findIndex(n => n.id === nodeId)
    if (index === -1) return

    const directChildren = nodes.filter(n => n.parentId === nodeId)

    const newNode: OperationNode = {
      id: action.id || uuidv4(),
      parentId: nodeId,
      action,
      timestamp: action.timestamp,
      metadata: pendingBranchSide ? { branchSide: pendingBranchSide } : {},
    }

    const newNodes = [...nodes]
    newNodes.splice(index + 1, 0, newNode)

    // 仅当锚点恰有一个直接子节点时，将其改挂到新节点下（避免多分支下按数组邻接误挂兄弟分支）
    // 分支录制首条插入须与已有子分支并列，pendingBranchSide 非空时不得把唯一子节点挂到新节点下
    if (directChildren.length === 1 && pendingBranchSide == null) {
      const onlyChildId = directChildren[0]!.id
      const ci = newNodes.findIndex(n => n.id === onlyChildId)
      if (ci !== -1) {
        newNodes[ci] = { ...newNodes[ci], parentId: newNode.id }
      }
    }

    set({
      nodes: newNodes,
      ...(pendingBranchSide ? { pendingBranchSide: null } : {}),
    })
  },

  setNodes: (nodes) => set({ nodes }),
  
  startSmartWait: (startTime, snapshot) => set({ 
    smartWaitStatus: 'waiting', 
    smartWaitStartTime: startTime, 
    initialSnapshot: snapshot,
    pendingWaitDiff: null,
  }),

  finishSmartWaitAndPick: (diff) => {
    set({
      smartWaitStatus: 'picking',
      pendingWaitDiff: diff,
    })

    const diffHints = (diff.newElements || []).map(e => ({
      tagName: e.tagName,
      text: e.text,
    }))

    sendToBackground(MSG.START_WAIT_ELEMENT_PICKER, {
      diffHints,
      urlChanged: diff.urlChanged,
      newUrl: diff.newUrl,
      duration: diff.duration,
    }).catch(err => {
      console.error('Failed to start wait element picker:', err)
      set({
        smartWaitStatus: 'idle',
        smartWaitStartTime: null,
        initialSnapshot: null,
        pendingWaitDiff: null,
      })
    })
  },

  cancelWaitElementPicker: () => {
    sendToBackground(MSG.STOP_WAIT_ELEMENT_PICKER).catch(console.error)
    set({
      smartWaitStatus: 'idle',
      smartWaitStartTime: null,
      initialSnapshot: null,
      pendingWaitDiff: null,
    })
  },

  resetSmartWait: () => set({ 
    smartWaitStatus: 'idle', 
    smartWaitStartTime: null, 
    initialSnapshot: null,
    pendingWaitDiff: null,
  }),

  // Tree Recording Methods
  setRecordingMode: (mode) => set({ recordingMode: mode }),
  setActiveRecordingParentId: (id) => set({ activeRecordingParentId: id }),
  setRecordingContinuationRootId: (id) => set({ recordingContinuationRootId: id }),
  setPendingBranchSide: (side) => set({ pendingBranchSide: side }),
  resetTreeRecording: () => set({
    recordingMode: 'normal' as RecordingMode,
    activeRecordingParentId: null,
    recordingContinuationRootId: null,
    pendingBranchSide: null,
  }),

  // 节点角色分析 Methods
  applyNodeRoleRecommendations: (recommendations) => {
    const { nodes, nodeRoleRecommendations: existing } = get()
    const updatedNodes = nodes.map(n => {
      const rec = recommendations.find(r => r.nodeId === n.id)
      if (!rec) return n

      // 尚未分配角色：写入完整推荐
      if (n.metadata.nodeRole === undefined) {
        return {
          ...n,
          metadata: {
            ...n.metadata,
            nodeRole: rec.recommendedRole,
            nodeRoleSource: 'auto' as const,
            candidates: rec.candidates,
          },
        }
      }

      // 已有角色（如结构分析先设的 loop_target）：仅补全 candidates，不覆盖角色与来源
      const isClick = n.action.type === 'click' || n.action.type === 'dblclick'
      const hasRawBranches = (n.action.branchCandidates?.length ?? 0) > 0
      const lacksCandidates = !n.metadata.candidates || n.metadata.candidates.length === 0
      const recHasCandidates = !!(rec.candidates && rec.candidates.length > 0)
      if (isClick && hasRawBranches && lacksCandidates && recHasCandidates) {
        return {
          ...n,
          metadata: {
            ...n.metadata,
            candidates: rec.candidates,
          },
        }
      }

      return n
    })
    set({
      nodeRoleRecommendations: [...existing, ...recommendations],
      nodes: updatedNodes,
    })
  },

  acceptNodeRole: (nodeId) => {
    const nodes = get().nodes.map(n => {
      if (n.id !== nodeId) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          nodeRoleSource: 'user' as const,
        },
      }
    })
    set({ nodes })
  },

  setNodeRole: (nodeId, role) => {
    const state = get()
    const targetNode = state.nodes.find(n => n.id === nodeId)
    if (!targetNode) return

    const leavingLoopTargetRole =
      targetNode.metadata.nodeRole === 'loop_target' && role !== 'loop_target'
    const shouldDisbandRepeatGroup =
      role !== 'loop_target' &&
      !!targetNode.metadata.repeatGroupId &&
      (!!targetNode.metadata.isLoopStart || targetNode.metadata.nodeRole === 'loop_target')

    const groupIdToClear = shouldDisbandRepeatGroup ? targetNode.metadata.repeatGroupId : null

    const nodes = state.nodes.map(n => {
      if (groupIdToClear && n.metadata.repeatGroupId === groupIdToClear) {
        const restMetadata = stripRepeatLoopStructure(n.metadata)
        if (n.id === nodeId) {
          return {
            ...n,
            metadata: metadataWithUserRoleAndLazyCandidates(n, role, restMetadata),
          }
        }
        return {
          ...n,
          metadata: restMetadata,
        }
      }

      if (n.id !== nodeId) return n
      const baseMetadata = leavingLoopTargetRole ? stripRepeatLoopStructure(n.metadata) : n.metadata
      return {
        ...n,
        metadata: metadataWithUserRoleAndLazyCandidates(n, role, baseMetadata),
      }
    })
    set({ nodes })
  },

  toggleCandidate: (nodeId, candidateIndex) => {
    const nodes = get().nodes.map(n => {
      if (n.id !== nodeId || !n.metadata.candidates) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          candidates: n.metadata.candidates.map((c, i) =>
            i === candidateIndex
              ? { ...c, selected: !c.selected }
              : c
          ),
        },
      }
    })
    set({ nodes })
  },

  confirmEnumNode: (nodeId) => {
    const state = get()
    const target = state.nodes.find(n => n.id === nodeId)
    const gid = target?.metadata.repeatGroupId
    const shouldStripAutoRepeatGroup = !!gid && gid.startsWith('auto-repeat')

    const nodes = state.nodes.map(n => {
      if (n.id === nodeId) {
        const confirmedCandidates = (n.metadata.candidates || []).filter(c => c.selected)
        const baseMeta =
          shouldStripAutoRepeatGroup && n.metadata.repeatGroupId === gid
            ? stripRepeatLoopStructure(n.metadata)
            : n.metadata
        return {
          ...n,
          metadata: {
            ...baseMeta,
            nodeRole: 'enum_param' as const,
            nodeRoleSource: 'user' as const,
            enumGroupId: n.metadata.enumGroupId || uuidv4(),
            candidates: confirmedCandidates,
          },
        }
      }
      if (shouldStripAutoRepeatGroup && n.metadata.repeatGroupId === gid) {
        return { ...n, metadata: stripRepeatLoopStructure(n.metadata) }
      }
      return n
    })
    set({ nodes })
  },

  confirmBranchNode: (nodeId) => {
    // 确认分支点：为每个选中的候选项创建子分支占位节点
    const { nodes } = get()
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    // 用 index > 0 排除自身（第一项是被点击的元素自身），
    // 不用 selector 比较——兄弟元素可能生成相同的 CSS selector
    const selectedCandidates = (node.metadata.candidates || []).filter(
      (c, index) => c.selected && index > 0
    )

    if (selectedCandidates.length === 0) return

    // 分支从当前节点的父节点分叉
    const parentId = node.parentId

    // 为每个选中的候选创建分支占位节点（使用 parentSelector + nth-child 确保选择器唯一）
    const newBranchNodes: OperationNode[] = selectedCandidates.map(candidate => ({
      id: uuidv4(),
      parentId: parentId,
      action: {
        id: uuidv4(),
        type: node.action.type,
        selector: candidate.parentSelector && candidate.elementIndex !== undefined
          ? `${candidate.parentSelector} > ${candidate.tagName || '*'}:nth-child(${candidate.elementIndex + 1})`
          : candidate.selector,
        innerText: candidate.innerText,
        tagName: candidate.tagName,
        attributes: candidate.attributes,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
      metadata: {
        branchSide: 'right' as const,
        branchLabel: candidate.innerText?.slice(0, 20),
        nodeRole: 'normal' as const,
        nodeRoleSource: 'auto' as const,
      },
    }))

    // 标记原节点为已确认的分支点
    const updatedNodes = nodes.map(n => {
      if (n.id !== nodeId) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          nodeRole: 'branch_point' as const,
          nodeRoleSource: 'user' as const,
        },
      }
    })

    set({ nodes: [...updatedNodes, ...newBranchNodes] })
  },

  // 选择器拾取 / loop_target Methods
  startSelectorPicker: (nodeId) => {
    const node = get().nodes.find(n => n.id === nodeId)
    if (!node) return
    set({ selectorPickerActive: true, selectorPickerNodeId: nodeId, selectorPickerError: null })
    sendToBackground(MSG.START_SELECTOR_PICKER, {
      originalSelector: node.action.selector,
      originalTagName: node.action.tagName,
      originalText: node.action.innerText,
      parentSelector: node.action.parentSelector,
      elementIndex: node.action.elementIndex,
    }).catch(console.error)
  },

  cancelSelectorPicker: () => {
    set({ selectorPickerActive: false, selectorPickerNodeId: null })
    sendToBackground(MSG.STOP_SELECTOR_PICKER).catch(console.error)
  },

  handleSelectorPickerResult: (pattern) => {
    const { selectorPickerNodeId } = get()
    if (!selectorPickerNodeId) return
    const nodes = get().nodes.map(n => {
      if (n.id !== selectorPickerNodeId) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          loopTargetPattern: pattern,
        },
      }
    })
    set({ nodes, selectorPickerActive: false, selectorPickerNodeId: null })
  },

  startContentExtractPicker: (anchorNodeId) => {
    const anchorNode = get().nodes.find(n => n.id === anchorNodeId)
    if (!anchorNode) return
    set({
      contentExtractPickerActive: true,
      contentExtractAnchorNodeId: anchorNodeId,
      contentExtractError: null,
    })
    sendToBackground(MSG.START_CONTENT_EXTRACT_PICKER).catch((err: Error) => {
      console.error(err)
      set({
        contentExtractPickerActive: false,
        contentExtractAnchorNodeId: null,
        contentExtractError: translate(useLocaleStore.getState().locale, 'errors.contentExtractFailed'),
      })
    })
  },

  cancelContentExtractPicker: () => {
    set({ contentExtractPickerActive: false, contentExtractAnchorNodeId: null })
    sendToBackground(MSG.STOP_CONTENT_EXTRACT_PICKER).catch(console.error)
  },

  handleContentExtractResult: (result) => {
    const { contentExtractAnchorNodeId, status } = get()
    if (!contentExtractAnchorNodeId) return

    const actionId = uuidv4()
    const action: RecordedAction = {
      id: actionId,
      type: 'extract_selected_content',
      selector: result.selector,
      extractedSelector: result.selector,
      extractedText: result.extractedText,
      extractedScreenshot: result.extractedScreenshot,
      extractMode: result.extractMode,
      comment: translate(
        useLocaleStore.getState().locale,
        result.extractMode === 'screenshot' ? 'comments.extractScreenshot' : 'comments.extractText'
      ),
      timestamp: Date.now(),
    }

    get().insertNodeAfter(contentExtractAnchorNodeId, action)
    set({
      contentExtractPickerActive: false,
      contentExtractAnchorNodeId: null,
      contentExtractError: null,
      // 录制进行中时，将父指针前移到提取节点，避免后续操作与提取节点形成意外分支
      ...(status === 'recording' ? { activeRecordingParentId: actionId } : {}),
    })
  },

  startUploadPicker: (anchorNodeId) => {
    const anchorNode = get().nodes.find(n => n.id === anchorNodeId)
    if (!anchorNode) return
    set({
      uploadPickerActive: true,
      uploadPickerAnchorNodeId: anchorNodeId,
      uploadPickerError: null,
    })
    sendToBackground(MSG.START_UPLOAD_PICKER).catch((err: Error) => {
      console.error(err)
      set({
        uploadPickerActive: false,
        uploadPickerAnchorNodeId: null,
        uploadPickerError: translate(useLocaleStore.getState().locale, 'errors.uploadPickerFailed'),
      })
    })
  },

  cancelUploadPicker: () => {
    set({ uploadPickerActive: false, uploadPickerAnchorNodeId: null })
    sendToBackground(MSG.STOP_UPLOAD_PICKER).catch(console.error)
  },

  handleUploadPickerResult: (result) => {
    const { uploadPickerAnchorNodeId, status } = get()
    if (!uploadPickerAnchorNodeId) return

    const actionId = uuidv4()
    const action: RecordedAction = {
      id: actionId,
      type: 'upload',
      selector: result.selector,
      innerText: result.innerText,
      tagName: result.tagName,
      attributes: result.attributes,
      comment: translate(useLocaleStore.getState().locale, 'comments.uploadFile'),
      timestamp: Date.now(),
      filePathArgName: 'filePath',
    }

    get().insertNodeAfter(uploadPickerAnchorNodeId, action)
    set({
      uploadPickerActive: false,
      uploadPickerAnchorNodeId: null,
      uploadPickerError: null,
      ...(status === 'recording' ? { activeRecordingParentId: actionId } : {}),
    })
  },

  startHoverPicker: (anchorNodeId) => {
    const anchorNode = get().nodes.find(n => n.id === anchorNodeId)
    if (!anchorNode) return
    set({
      hoverPickerActive: true,
      hoverPickerAnchorNodeId: anchorNodeId,
      hoverPickerError: null,
    })
    sendToBackground(MSG.START_HOVER_PICKER).catch((err: Error) => {
      console.error(err)
      set({
        hoverPickerActive: false,
        hoverPickerAnchorNodeId: null,
        hoverPickerError: translate(useLocaleStore.getState().locale, 'errors.hoverPickerFailed'),
      })
    })
  },

  cancelHoverPicker: () => {
    set({ hoverPickerActive: false, hoverPickerAnchorNodeId: null })
    sendToBackground(MSG.STOP_HOVER_PICKER).catch(console.error)
  },

  handleHoverPickerResult: (result) => {
    const { hoverPickerAnchorNodeId, status } = get()
    if (!hoverPickerAnchorNodeId) return

    const actionId = uuidv4()
    const action: RecordedAction = {
      id: actionId,
      type: 'hover',
      selector: result.selector,
      innerText: result.innerText,
      tagName: result.tagName,
      attributes: result.attributes,
      timestamp: Date.now(),
    }

    get().insertNodeAfter(hoverPickerAnchorNodeId, action)
    set({
      hoverPickerActive: false,
      hoverPickerAnchorNodeId: null,
      hoverPickerError: null,
      ...(status === 'recording' ? { activeRecordingParentId: actionId } : {}),
    })
  },

  confirmLoopTarget: (nodeId) => {
    const allNodes = get().nodes
    const loopTargetNode = allNodes.find(n => n.id === nodeId)
    if (!loopTargetNode) return

    // Auto-detected nodes already have the correct group structure — only update source
    if (loopTargetNode.metadata.repeatGroupId) {
      const nodes = allNodes.map(n => {
        if (n.id !== nodeId) return n
        return {
          ...n,
          metadata: {
            ...n.metadata,
            nodeRole: 'loop_target' as const,
            nodeRoleSource: 'user' as const,
          },
        }
      })
      set({ nodes })
      return
    }

    // Manual mode: build the loop group from loopBodyEndNodeId
    const loopBodyEndNodeId = loopTargetNode.metadata.loopBodyEndNodeId
    const hasMultiStepBody = !!loopBodyEndNodeId && loopBodyEndNodeId !== LOOP_BODY_END_SELF

    const loopBodyNodeIds = new Set<string>()
    if (hasMultiStepBody) {
      let current = allNodes.find(n => n.parentId === nodeId)
      while (current) {
        loopBodyNodeIds.add(current.id)
        if (current.id === loopBodyEndNodeId) break
        current = allNodes.find(n => n.parentId === current!.id)
      }
    }

    const groupId = hasMultiStepBody ? `manual-loop-${nodeId}` : undefined

    const nodes = allNodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          metadata: {
            ...n.metadata,
            nodeRole: 'loop_target' as const,
            nodeRoleSource: 'user' as const,
            ...(groupId ? { isLoopStart: true, repeatGroupId: groupId } : {}),
          },
        }
      }
      if (groupId && loopBodyNodeIds.has(n.id)) {
        return {
          ...n,
          metadata: {
            ...n.metadata,
            repeatGroupId: groupId,
          },
        }
      }
      return n
    })
    set({ nodes })
  },

  setLoopBodyEnd: (loopTargetNodeId, endNodeId) => {
    const nodes = get().nodes.map(n => {
      if (n.id !== loopTargetNodeId) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          loopBodyEndNodeId: endNodeId,
        },
      }
    })
    set({ nodes })
  },

  setLoopPreviewIndex: (nodeId, index) => {
    const nextIndex = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1
    set({
      loopPreviewIndexByNodeId: {
        ...get().loopPreviewIndexByNodeId,
        [nodeId]: nextIndex,
      },
    })
  },

  setLoopPreviewScanK: (nodeId, k) => {
    const nextK = Number.isFinite(k) ? Math.max(1, Math.floor(k)) : 10
    set({
      loopPreviewScanKByNodeId: {
        ...get().loopPreviewScanKByNodeId,
        [nodeId]: nextK,
      },
    })
  },

  testLoopPreviewAtIndex: async (nodeId) => {
    const state = get()
    const node = state.nodes.find(n => n.id === nodeId)
    const pattern = node?.metadata.loopTargetPattern
    if (!pattern) return
    const uiIndex = state.loopPreviewIndexByNodeId[nodeId] ?? 1
    const indexZeroBased = Math.max(0, uiIndex - 1)
    set({ loopPreviewTesting: true, loopPreviewError: null })
    try {
      const result = await sendToBackground<LoopPreviewSingleResult>(MSG.LOOP_TARGET_PREVIEW_TEST, {
        fullSelector: pattern.fullSelector,
        clickTargetWithinItem: pattern.clickTargetWithinItem,
        index: indexZeroBased,
        highlightMs: state.loopPreviewHighlightMs,
      })
      set({
        loopPreviewLastSingleResultByNodeId: {
          ...get().loopPreviewLastSingleResultByNodeId,
          [nodeId]: result,
        },
      })
    } catch (err) {
      set({
        loopPreviewError:
          (err as Error).message ||
          translate(useLocaleStore.getState().locale, 'errors.loopDetectFailed'),
      })
    } finally {
      set({ loopPreviewTesting: false })
    }
  },

  scanLoopPreviewRange: async (nodeId) => {
    const state = get()
    const node = state.nodes.find(n => n.id === nodeId)
    const pattern = node?.metadata.loopTargetPattern
    if (!pattern) return
    const scanK = state.loopPreviewScanKByNodeId[nodeId] ?? 10
    const maxScan = Math.max(1, Math.min(scanK, Math.max(1, pattern.matchCount || scanK)))
    set({ loopPreviewTesting: true, loopPreviewError: null })
    try {
      const result = await sendToBackground<LoopPreviewScanResult>(MSG.LOOP_TARGET_PREVIEW_SCAN, {
        fullSelector: pattern.fullSelector,
        clickTargetWithinItem: pattern.clickTargetWithinItem,
        maxScan,
      })
      set({
        loopPreviewLastScanResultsByNodeId: {
          ...get().loopPreviewLastScanResultsByNodeId,
          [nodeId]: result,
        },
      })
    } catch (err) {
      set({
        loopPreviewError:
          (err as Error).message ||
          translate(useLocaleStore.getState().locale, 'errors.loopScanFailed'),
      })
    } finally {
      set({ loopPreviewTesting: false })
    }
  },

  clearLoopPreviewResults: (nodeId) => {
    const singleMap = { ...get().loopPreviewLastSingleResultByNodeId }
    const scanMap = { ...get().loopPreviewLastScanResultsByNodeId }
    delete singleMap[nodeId]
    delete scanMap[nodeId]
    set({
      loopPreviewLastSingleResultByNodeId: singleMap,
      loopPreviewLastScanResultsByNodeId: scanMap,
      loopPreviewError: null,
    })
  },

  updateNodeSelector: (nodeId, newSelector) => {
    const state = get()
    const nodes = state.nodes.map(n => {
      if (n.id !== nodeId) return n
      return {
        ...n,
        metadata: {
          ...n.metadata,
          selectorOverride: newSelector || undefined,
        },
      }
    })
    const clearTest =
      state.selectorTestResultNodeId === nodeId
        ? { selectorTestResult: null, selectorTestResultNodeId: null }
        : {}
    set({ nodes, ...clearTest })
  },

  resetNodeSelector: (nodeId) => {
    const state = get()
    const nodes = state.nodes.map(n => {
      if (n.id !== nodeId) return n
      const { selectorOverride: _, ...restMetadata } = n.metadata
      return { ...n, metadata: restMetadata }
    })
    const clearTest =
      state.selectorTestResultNodeId === nodeId
        ? { selectorTestResult: null, selectorTestResultNodeId: null }
        : {}
    set({ nodes, ...clearTest })
  },

  testSelectorHighlight: async (nodeId) => {
    const node = get().nodes.find(n => n.id === nodeId)
    if (!node) return
    const effectiveSelector = node.metadata.selectorOverride || node.action.selector
    if (!effectiveSelector) return
    set({
      selectorTestingNodeId: nodeId,
      selectorTestResult: null,
      selectorTestResultNodeId: null,
    })
    try {
      const result = await sendToBackground<{
        matched: boolean
        visible: boolean
        tagName?: string
        innerText?: string
      }>(MSG.TEST_SELECTOR_HIGHLIGHT, {
        selector: effectiveSelector,
        highlightMs: 2000,
        frameId: node.action.frameId,
        frameUrl: node.action.frameUrl,
      })
      set({
        selectorTestResult: result,
        selectorTestingNodeId: null,
        selectorTestResultNodeId: nodeId,
      })
    } catch (err) {
      set({
        selectorTestResult: { matched: false, visible: false },
        selectorTestingNodeId: null,
        selectorTestResultNodeId: nodeId,
      })
    }
  },
}))
