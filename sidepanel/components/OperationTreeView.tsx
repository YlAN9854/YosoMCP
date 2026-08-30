import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type { OperationNode } from '@/types/operationTree'
import { LOOP_BODY_END_SELF } from '@/types/operationTree'
import type { ActionType } from '@/types/action'
import type { NodeRole } from '@/types/operationTree'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useToolsetStore } from '@/sidepanel/stores/toolsetStore'
import { useReplayStore } from '@/sidepanel/stores/replayStore'
import NodeContextMenu from './NodeContextMenu'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import { getActionLabel, getRoleLabel, ROLE_STYLES } from '@/sidepanel/utils/actionLabels'
import { getPendingConfirmationNodeIds } from '@/sidepanel/utils/pendingConfirmations'

// ===== Layout Constants =====
const FULL_W = 180
const MINI_W = 36
const CARD_H = 52
const V_GAP = 40
const H_GAP = 12
const PAD = 24

type NodeVisState = 'main' | 'mini' | 'hidden'

// ===== Action Icons =====
const ACTION_ICONS: Record<ActionType, string> = {
  click: '🖱️',
  dblclick: '🖱️',
  fill: '✏️',
  select: '📋',
  check: '☑️',
  upload: '📎',
  keydown: '⌨️',
  navigate: '🔗',
  scroll: '📜',
  hover: '👆',
  wait_for_url: '⏳',
  wait_for_selector: '⏳',
  wait_for_timeout: '⏳',
  wait_for_navigation: '⏳',
  extract_selected_content: '📝',
}

// ===== Tree Types =====
interface TreeNodeData {
  node: OperationNode
  children: TreeNodeData[]
  allChildrenNodes: OperationNode[]
}

interface NodeLayout {
  node: OperationNode
  x: number
  y: number
  isLeaf: boolean
  allChildrenNodes: OperationNode[]
  state: NodeVisState
}

interface ConnectionLayout {
  fromId: string
  toId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  fromState: NodeVisState
  toState: NodeVisState
  isMainPath: boolean
}

// ===== Tree Building =====
function buildTree(nodes: OperationNode[]): TreeNodeData | null {
  if (nodes.length === 0) return null

  const childrenMap = new Map<string, OperationNode[]>()
  let root: OperationNode | null = null

  for (const node of nodes) {
    if (!node.parentId) {
      if (!root) root = node
    } else {
      const children = childrenMap.get(node.parentId) || []
      children.push(node)
      childrenMap.set(node.parentId, children)
    }
  }

  if (!root) root = nodes[0]

  function buildSubtree(n: OperationNode): TreeNodeData {
    const rawChildren = childrenMap.get(n.id) || []
    // Sort: left branches first, then trunk (no branchSide), then right branches
    const sorted = [...rawChildren].sort((a, b) => {
      const sideOrder = (s?: string) => s === 'left' ? 0 : !s ? 1 : 2
      const oa = sideOrder(a.metadata.branchSide)
      const ob = sideOrder(b.metadata.branchSide)
      if (oa !== ob) return oa - ob
      return a.timestamp - b.timestamp
    })

    return { 
      node: n, 
      children: sorted.map(buildSubtree),
      allChildrenNodes: sorted
    }
  }

  return buildSubtree(root)
}

// ===== Loop Group Collapse =====
function computeVisibleNodes(nodes: OperationNode[], collapsed: Set<string>): OperationNode[] {
  if (collapsed.size === 0) return nodes

  // Build map: hiddenNodeId → loopStartNodeId for parentId remapping
  const hiddenToStart = new Map<string, string>()
  for (const node of nodes) {
    const groupId = node.metadata.repeatGroupId
    if (!groupId || !collapsed.has(groupId) || node.metadata.isLoopStart) continue
    const loopStart = nodes.find(n => n.metadata.repeatGroupId === groupId && n.metadata.isLoopStart)
    if (loopStart) hiddenToStart.set(node.id, loopStart.id)
  }

  if (hiddenToStart.size === 0) return nodes

  return nodes
    .filter(n => !hiddenToStart.has(n.id))
    .map(n => {
      if (!n.parentId || !hiddenToStart.has(n.parentId)) return n
      return { ...n, parentId: hiddenToStart.get(n.parentId)! }
    })
}

// ===== Layout Computation =====
function computeLayout(root: TreeNodeData, activeBranchMap: Record<string, string>): {
  nodes: NodeLayout[]
  connections: ConnectionLayout[]
  width: number
  height: number
} {
  const nodeLayouts: NodeLayout[] = []
  const connections: ConnectionLayout[] = []

  let maxDepth = 0
  let maxX = 0

  function dfs(treeNode: TreeNodeData, depth: number, parentState: NodeVisState, startX: number, isActiveChild: boolean) {
    maxDepth = Math.max(maxDepth, depth)

    // main = 当前聚焦路径；mini = 并排展示的其它分支（含其下嵌套分叉）。
    // 在非聚焦子树内原先把「非 active 子边」标为 hidden，会导致兄弟分支下的多层分叉整段消失（缩略图同步错误）。
    let state: NodeVisState = 'hidden'
    if (depth === 0) {
      state = 'main'
    } else if (parentState === 'main') {
      state = isActiveChild ? 'main' : 'mini'
    } else if (parentState === 'mini') {
      state = 'mini'
    }

    const x = startX
    const y = PAD + depth * (CARD_H + V_GAP)
    const width = state === 'main' ? FULL_W : MINI_W

    if (state !== 'hidden') {
      maxX = Math.max(maxX, x + width)
    }

    nodeLayouts.push({
      node: treeNode.node,
      x,
      y,
      isLeaf: treeNode.children.length === 0,
      allChildrenNodes: treeNode.allChildrenNodes,
      state
    })

    if (treeNode.children.length > 0) {
      let activeChildId = activeBranchMap[treeNode.node.id] || treeNode.children[0].node.id
      if (!treeNode.children.some(c => c.node.id === activeChildId)) {
        activeChildId = treeNode.children[0].node.id
      }
      let currentX = x

      for (const child of treeNode.children) {
        const isChildActive = child.node.id === activeChildId

        let childState: NodeVisState = 'hidden'
        if (state === 'main') {
          childState = isChildActive ? 'main' : 'mini'
        } else if (state === 'mini') {
          childState = 'mini'
        }

        dfs(child, depth + 1, state, currentX, isChildActive)

        if (childState !== 'hidden') {
          const childWidth = childState === 'main' ? FULL_W : MINI_W

          connections.push({
            fromId: treeNode.node.id,
            toId: child.node.id,
            fromX: x + (state === 'main' ? FULL_W : MINI_W) / 2,
            fromY: y + CARD_H,
            toX: currentX + childWidth / 2,
            toY: y + CARD_H + V_GAP,
            fromState: state,
            toState: childState,
            isMainPath: state === 'main' && childState === 'main'
          })

          currentX += childWidth + H_GAP
        }
      }
    }
  }

  dfs(root, 0, 'main', PAD, true)

  return {
    nodes: nodeLayouts,
    connections,
    width: Math.max(PAD * 2 + maxX, FULL_W + PAD * 2),
    height: PAD * 2 + (maxDepth + 1) * CARD_H + maxDepth * V_GAP + V_GAP + 28,
  }
}

// ===== Candidate Panel Sub-Component =====
function CandidatePanel({ node, x, y, onClose }: {
  node: OperationNode
  x: number
  y: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const nodes = useRecorderStore(s => s.nodes)
  const acceptNodeRole = useRecorderStore(s => s.acceptNodeRole)
  const setNodeRole = useRecorderStore(s => s.setNodeRole)
  const toggleCandidate = useRecorderStore(s => s.toggleCandidate)
  const confirmEnumNode = useRecorderStore(s => s.confirmEnumNode)
  const confirmBranchNode = useRecorderStore(s => s.confirmBranchNode)
  const startSelectorPicker = useRecorderStore(s => s.startSelectorPicker)
  const cancelSelectorPicker = useRecorderStore(s => s.cancelSelectorPicker)
  const confirmLoopTarget = useRecorderStore(s => s.confirmLoopTarget)
  const setLoopBodyEnd = useRecorderStore(s => s.setLoopBodyEnd)
  const selectorPickerActive = useRecorderStore(s => s.selectorPickerActive)
  const selectorPickerError = useRecorderStore(s => s.selectorPickerError)
  const loopPreviewIndexByNodeId = useRecorderStore(s => s.loopPreviewIndexByNodeId)
  const loopPreviewScanKByNodeId = useRecorderStore(s => s.loopPreviewScanKByNodeId)
  const loopPreviewLastSingleResultByNodeId = useRecorderStore(s => s.loopPreviewLastSingleResultByNodeId)
  const loopPreviewLastScanResultsByNodeId = useRecorderStore(s => s.loopPreviewLastScanResultsByNodeId)
  const loopPreviewTesting = useRecorderStore(s => s.loopPreviewTesting)
  const loopPreviewError = useRecorderStore(s => s.loopPreviewError)
  const setLoopPreviewIndex = useRecorderStore(s => s.setLoopPreviewIndex)
  const setLoopPreviewScanK = useRecorderStore(s => s.setLoopPreviewScanK)
  const testLoopPreviewAtIndex = useRecorderStore(s => s.testLoopPreviewAtIndex)
  const scanLoopPreviewRange = useRecorderStore(s => s.scanLoopPreviewRange)
  const clearLoopPreviewResults = useRecorderStore(s => s.clearLoopPreviewResults)
  const updateNodeSelector = useRecorderStore(s => s.updateNodeSelector)
  const resetNodeSelector = useRecorderStore(s => s.resetNodeSelector)
  const testSelectorHighlight = useRecorderStore(s => s.testSelectorHighlight)
  const selectorTestingNodeId = useRecorderStore(s => s.selectorTestingNodeId)
  const selectorTestResult = useRecorderStore(s => s.selectorTestResult)
  const selectorTestResultNodeId = useRecorderStore(s => s.selectorTestResultNodeId)
  const setSelectedNodeId = useToolsetStore(s => s.setSelectedNodeId)

  const [editingSelector, setEditingSelector] = useState(false)
  const [selectorDraft, setSelectorDraft] = useState('')

  const effectiveSelector = node.metadata.selectorOverride ?? node.action.selector
  const hasOverride = !!node.metadata.selectorOverride
  const hasMeaningfulSelector = !!node.action.selector && node.action.type !== 'navigate' && node.action.type !== 'scroll' && node.action.type !== 'wait_for_timeout' && node.action.type !== 'wait_for_navigation'

  const role = node.metadata.nodeRole
  const rec = useRecorderStore.getState().nodeRoleRecommendations.find(
    r => r.nodeId === node.id
  )
  const matchCount = Math.max(1, node.metadata.loopTargetPattern?.matchCount || 1)
  const previewIndex = Math.min(loopPreviewIndexByNodeId[node.id] ?? 1, matchCount)
  const scanK = Math.min(loopPreviewScanKByNodeId[node.id] ?? Math.min(10, matchCount), matchCount)
  const previewSingle = loopPreviewLastSingleResultByNodeId[node.id]
  const previewScan = loopPreviewLastScanResultsByNodeId[node.id]

  return (
    <div
      className="absolute z-30 bg-white border border-blue-200 rounded-lg shadow-lg p-2 text-xs"
      style={{
        left: x + FULL_W + 8,
        top: y,
        width: 220,
        maxHeight: 280,
        overflowY: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 仅结构分析产生的 auto-repeat 组显示「自动检测」；手动切到循环仍为 auto 待确认，不显示此条 */}
      {role === 'loop_target' &&
        node.metadata.nodeRoleSource === 'auto' &&
        node.metadata.repeatGroupId?.startsWith('auto-repeat') && (
        <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-gray-50 rounded border border-gray-100">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 font-medium shrink-0">{t('tree.autoDetected')}</span>
          <span className="text-[10px] text-gray-400">{t('tree.autoDetectedHint')}</span>
        </div>
      )}

      {/* Role recommendation info */}
      {rec && (
        <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
          💡 {rec.reasoning}
          <span className="ml-1 text-gray-400">{t('tree.confidence', { pct: (rec.confidence * 100).toFixed(0) })}</span>
        </div>
      )}

      {/* Role selector */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {(['normal', 'branch_point', 'enum_param', 'dynamic_param', 'loop_target'] as NodeRole[]).map(r => (
          <button
            key={r}
            onClick={() => setNodeRole(node.id, r)}
            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              role === r
                ? `${ROLE_STYLES[r].bg} ${ROLE_STYLES[r].color} border-current`
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
            }`}
          >
            {getRoleLabel(r, t)}
          </button>
        ))}
      </div>

      {/* Selector display / edit / test */}
      {hasMeaningfulSelector && (
        <div className="space-y-1 mb-2">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 font-medium">{t('tree.selectorLabel')}</span>
            {hasOverride && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600">{t('tree.modified')}</span>
            )}
          </div>
          {editingSelector ? (
            <div className="space-y-1">
              <input
                type="text"
                value={selectorDraft}
                onChange={(e) => setSelectorDraft(e.target.value)}
                className="w-full p-1 border border-blue-300 rounded text-[10px] font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (selectorDraft.trim() && selectorDraft.trim() !== node.action.selector) {
                      updateNodeSelector(node.id, selectorDraft.trim())
                    } else if (selectorDraft.trim() === node.action.selector) {
                      resetNodeSelector(node.id)
                    }
                    setEditingSelector(false)
                  } else if (e.key === 'Escape') {
                    setEditingSelector(false)
                  }
                }}
              />
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (selectorDraft.trim() && selectorDraft.trim() !== node.action.selector) {
                      updateNodeSelector(node.id, selectorDraft.trim())
                    } else if (selectorDraft.trim() === node.action.selector) {
                      resetNodeSelector(node.id)
                    }
                    setEditingSelector(false)
                  }}
                  className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {t('tree.ok')}
                </button>
                <button
                  onClick={() => setEditingSelector(false)}
                  className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                >
                  {t('wait.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="bg-gray-50 p-1.5 rounded text-[10px] font-mono break-all text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors"
              onClick={() => {
                setSelectorDraft(effectiveSelector)
                setEditingSelector(true)
              }}
              title={t('tree.editSelectorTitle')}
            >
              {effectiveSelector}
            </div>
          )}
          <div className="flex gap-1">
            <button
              onClick={() => testSelectorHighlight(node.id)}
              disabled={selectorTestingNodeId === node.id}
              className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {selectorTestingNodeId === node.id ? t('tree.testing') : t('tree.test')}
            </button>
            {hasOverride && (
              <button
                onClick={() => resetNodeSelector(node.id)}
                className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
              >
                {t('tree.reset')}
              </button>
            )}
          </div>
          {selectorTestResult &&
            selectorTestingNodeId === null &&
            selectorTestResultNodeId === node.id && (
            <div className={`text-[10px] p-1 rounded ${
              selectorTestResult.matched
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-600'
            }`}>
              {selectorTestResult.matched
                ? t('tree.matchOk', {
                    hidden: selectorTestResult.visible ? '' : t('tree.matchHiddenSuffix'),
                    tag: selectorTestResult.tagName || '',
                    inner: selectorTestResult.innerText ? ` "${selectorTestResult.innerText.slice(0, 30)}"` : '',
                  })
                : t('tree.matchNone')}
            </div>
          )}
        </div>
      )}

      {/* Candidate list */}
      {(role === 'branch_point' || role === 'enum_param') && node.metadata.candidates && node.metadata.candidates.length > 0 && (
        <div className="space-y-1 mb-2">
          <div className="text-[10px] text-gray-500 font-medium">{t('tree.candidates')}</div>
          {node.metadata.candidates.map((c, ci) => (
            <label
              key={ci}
              className={`flex items-center gap-1.5 p-1 rounded cursor-pointer ${
                c.selected ? 'bg-blue-50' : 'bg-gray-50'
              } hover:bg-blue-100`}
            >
              <input
                type="checkbox"
                checked={c.selected}
                onChange={() => toggleCandidate(node.id, ci)}
                className="w-3 h-3 rounded"
              />
              <span className="truncate flex-1">
                {c.innerText || c.selector.slice(0, 25)}
              </span>
              {ci === 0 && (
                <span className="text-[9px] text-blue-500 shrink-0">{t('tree.current')}</span>
              )}
            </label>
          ))}
        </div>
      )}

      {/* Loop target 配置 */}
      {role === 'loop_target' && (
        <div className="space-y-2 mb-2">
          {/* 选择器模式 */}
          {node.metadata.loopTargetPattern ? (
            <div className="text-[10px] space-y-1">
              <div className="text-gray-500 font-medium">{t('tree.patternMode')}</div>
              <div className="bg-purple-50 p-1.5 rounded text-purple-700 font-mono break-all">
                {node.metadata.loopTargetPattern.fullSelector}
              </div>
              <div className="text-gray-500">
                {t('tree.matchesN', { n: node.metadata.loopTargetPattern.matchCount })}
              </div>
              {node.metadata.loopTargetPattern.sampleTexts && node.metadata.loopTargetPattern.sampleTexts.length > 0 && (
                <div className="text-gray-400">
                  {t('tree.samples', { text: node.metadata.loopTargetPattern.sampleTexts.slice(0, 3).join(', ') })}
                </div>
              )}
              <div className="border border-purple-100 rounded p-1.5 space-y-1.5 bg-white">
                <div className="text-gray-500 font-medium">{t('tree.detectRound')}</div>
                <div className="flex items-center gap-1">
                  <select
                    value={previewIndex}
                    onChange={(e) => setLoopPreviewIndex(node.id, Number(e.target.value))}
                    className="flex-1 p-1 border border-gray-200 rounded text-[10px] bg-white"
                  >
                    {Array.from({ length: matchCount }, (_, idx) => idx + 1).map(v => (
                      <option key={v} value={v}>{t('tree.itemNth', { n: v })}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => testLoopPreviewAtIndex(node.id)}
                    disabled={loopPreviewTesting}
                    className="px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {t('tree.detect')}
                  </button>
                </div>
                {previewSingle && (
                  <div className="text-[10px] text-gray-600 bg-gray-50 rounded p-1">
                    {t('tree.preview.itemHit', { yes: previewSingle.itemMatched ? t('tree.yes') : t('tree.no'), vis: previewSingle.itemVisible ? t('tree.yes') : t('tree.no') })}
                    <br />
                    {t('tree.preview.childHit', { yes: previewSingle.clickTargetMatched ? t('tree.yes') : t('tree.no'), vis: previewSingle.clickTargetVisible ? t('tree.yes') : t('tree.no') })}
                    {previewSingle.reason ? t('tree.preview.reason', { reason: previewSingle.reason }) : ''}
                  </div>
                )}
                {!node.metadata.loopTargetPattern.clickTargetWithinItem && (
                  <div className="text-[10px] text-amber-600 bg-amber-50 rounded p-1">
                    {t('tree.noClickTargetHint')}
                  </div>
                )}
                <div className="border-t border-gray-100 pt-1 space-y-1">
                  <div className="text-gray-500">{t('tree.batchScan')}</div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={matchCount}
                      value={scanK}
                      onChange={(e) => setLoopPreviewScanK(node.id, Number(e.target.value || 1))}
                      className="w-16 p-1 border border-gray-200 rounded text-[10px]"
                    />
                    <button
                      onClick={() => scanLoopPreviewRange(node.id)}
                      disabled={loopPreviewTesting}
                      className="px-2 py-1 text-[10px] bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {t('tree.startScan')}
                    </button>
                    <button
                      onClick={() => clearLoopPreviewResults(node.id)}
                      className="px-2 py-1 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      {t('tree.clearScan')}
                    </button>
                  </div>
                  {previewScan && previewScan.rows.length > 0 && (
                    <div className="max-h-24 overflow-y-auto border border-gray-100 rounded">
                      <table className="w-full text-[10px]">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left px-1 py-0.5">{t('tree.colIndex')}</th>
                            <th className="text-left px-1 py-0.5">{t('tree.colItem')}</th>
                            <th className="text-left px-1 py-0.5">{t('tree.colChild')}</th>
                            <th className="text-left px-1 py-0.5">{t('tree.colVis')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewScan.rows.map((row) => (
                            <tr key={row.index} className="border-t border-gray-100">
                              <td className="px-1 py-0.5">{t('tree.rowItem', { n: row.index + 1 })}</td>
                              <td className="px-1 py-0.5">{row.itemMatched ? t('tree.hit') : t('tree.miss')}</td>
                              <td className="px-1 py-0.5">{row.clickTargetMatched ? t('tree.hit') : t('tree.miss')}</td>
                              <td className="px-1 py-0.5">{row.itemVisible && row.clickTargetVisible ? t('tree.visible') : t('tree.abnormal')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {loopPreviewError && (
                  <div className="text-[10px] text-red-600 bg-red-50 rounded p-1">
                    {loopPreviewError}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-gray-400">
              {t('tree.needPattern')}
            </div>
          )}

          {/* 拾取按钮 */}
          {selectorPickerActive ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-purple-500 animate-pulse">{t('tree.picking')}</span>
              <button
                onClick={() => cancelSelectorPicker()}
                className="px-2 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors"
              >
                {t('wait.cancel')}
              </button>
            </div>
          ) : (
            <>
              {selectorPickerError && (
                <div className="text-[10px] text-red-500 bg-red-50 p-1.5 rounded mb-1">
                  ⚠ {selectorPickerError}
                </div>
              )}
              <button
                onClick={() => startSelectorPicker(node.id)}
                className="w-full px-2 py-1 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors border border-purple-200"
              >
                {node.metadata.loopTargetPattern ? t('tree.repickSame') : t('tree.pickSimilar')}
              </button>
            </>
          )}

          {/* 循环体终止节点选择 */}
          <div className="text-[10px]">
            <div className="text-gray-500 font-medium mb-1">{t('tree.loopEnd')}</div>
            <select
              value={node.metadata.loopBodyEndNodeId || ''}
              onChange={(e) => setLoopBodyEnd(node.id, e.target.value)}
              className="w-full p-1 border border-gray-200 rounded text-[10px] bg-white"
            >
              <option value="">{t('tree.selectEnd')}</option>
              <option value={LOOP_BODY_END_SELF}>{t('tree.loopEndSelf')}</option>
              {nodes
                .filter(n => {
                  const nodeIdx = nodes.findIndex(nn => nn.id === node.id)
                  const nIdx = nodes.findIndex(nn => nn.id === n.id)
                  return nIdx > nodeIdx
                })
                .map(n => (
                  <option key={n.id} value={n.id}>
                    {getActionLabel(n, t)}
                  </option>
                ))
              }
            </select>
            {node.metadata.loopTargetPattern && !node.metadata.loopBodyEndNodeId && (
              <div className="mt-1 text-amber-600 bg-amber-50 border border-amber-100 rounded p-1">
                {t('tree.loopEndWarn')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5 pt-1 border-t border-gray-100">
        {role === 'enum_param' && (
          <button
            onClick={() => { confirmEnumNode(node.id); onClose(); setSelectedNodeId(null) }}
            className="flex-1 px-2 py-1 text-[10px] bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
          >
            {t('tree.confirmEnum')}
          </button>
        )}
        {role === 'branch_point' && (
          <button
            onClick={() => { confirmBranchNode(node.id); onClose(); setSelectedNodeId(null) }}
            className="flex-1 px-2 py-1 text-[10px] bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
          >
            {t('tree.confirmBranch')}
          </button>
        )}
        {role === 'loop_target' && node.metadata.nodeRoleSource !== 'user' && (
          <button
            onClick={() => { confirmLoopTarget(node.id); onClose(); setSelectedNodeId(null) }}
            disabled={!node.metadata.loopTargetPattern}
            className="flex-1 px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {t('tree.confirmLoop')}
          </button>
        )}
        {role === 'loop_target' && node.metadata.nodeRoleSource === 'user' && (
          <button
            disabled
            className="flex-1 px-2 py-1 text-[10px] bg-purple-100 text-purple-500 rounded border border-purple-200 cursor-default"
          >
            {t('tree.confirmed')}
          </button>
        )}
        <button
          onClick={() => { acceptNodeRole(node.id); onClose() }}
          className="flex-1 px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          {t('tree.accept')}
        </button>
      </div>
    </div>
  )
}

// ===== Extract Preview Panel Sub-Component =====
function ExtractPreviewPanel({ node, x, y, onClose }: {
  node: OperationNode
  x: number
  y: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const action = node.action
  const isScreenshot = action.extractMode === 'screenshot'

  return (
    <div
      className="absolute z-30 bg-white border border-teal-200 rounded-lg shadow-lg text-xs"
      style={{
        left: x + FULL_W + 8,
        top: y,
        width: 240,
        maxHeight: 320,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1.5 border-b border-teal-100 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">📝</span>
          <span className="font-medium text-gray-700">
            {isScreenshot ? t('tree.shotPreview') : t('tree.textPreview')}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
            isScreenshot ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-600'
          }`}>
            {isScreenshot ? t('tree.shot') : t('tree.text')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-sm leading-none px-0.5"
          title={t('tree.close')}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2">
        {isScreenshot ? (
          action.extractedScreenshot ? (
            <img
              src={action.extractedScreenshot}
              alt={t('tree.screenshotCapAlt')}
              className="w-full rounded border border-gray-100 object-contain"
              style={{ maxHeight: 200 }}
            />
          ) : (
            <div className="text-gray-400 text-center py-4 text-[11px]">
              <div className="text-2xl mb-1.5">🖼️</div>
              <div>{t('tree.shotFail')}</div>
              <div className="text-[10px] mt-0.5 text-gray-300">{t('tree.shotFailHint')}</div>
            </div>
          )
        ) : (
          action.extractedText ? (
            <div className="bg-gray-50 rounded p-1.5 text-[11px] text-gray-700 leading-relaxed break-words whitespace-pre-wrap">
              {action.extractedText}
            </div>
          ) : (
            <div className="text-gray-400 text-center py-4 text-[11px]">
              <div className="text-2xl mb-1.5">📭</div>
              <div>{t('tree.noText')}</div>
            </div>
          )
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-2.5 py-1.5 border-t border-gray-100 shrink-0">
        <div className="text-[9px] text-gray-400 leading-snug">
          {t('tree.snapshotDisclaimer')}
        </div>
      </div>
    </div>
  )
}

// ===== Minimap Sub-Component =====
function Minimap({ layout, setActiveBranchMap }: { 
  layout: { nodes: NodeLayout[], connections: ConnectionLayout[], width: number, height: number },
  setActiveBranchMap: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  if (layout.nodes.length === 0) return null

  const minX = Math.min(...layout.nodes.map(n => n.x))
  const maxX = Math.max(...layout.nodes.map(n => n.x + (n.state === 'main' ? FULL_W : MINI_W)))
  const minY = Math.min(...layout.nodes.map(n => n.y))
  const maxY = Math.max(...layout.nodes.map(n => n.y + CARD_H))

  const pad = 10
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  
  const scale = Math.min((100 - pad * 2) / w, (100 - pad * 2) / h)
  
  const tx = (x: number) => pad + (x - minX) * scale
  const ty = (y: number) => pad + (y - minY) * scale

  return (
    <div className="w-28 h-24 bg-white/80 backdrop-blur-md border border-gray-200 shadow-sm rounded-xl flex items-center justify-center overflow-hidden pointer-events-none">
      <svg width="100" height="100" viewBox="0 0 100 100" className="overflow-visible pointer-events-auto">
        {layout.connections.map(conn => {
          const fromNode = layout.nodes.find(n => n.node.id === conn.fromId)
          const toNode = layout.nodes.find(n => n.node.id === conn.toId)
          if (!fromNode || !toNode) return null
          
          if (fromNode.state === 'hidden' || toNode.state === 'hidden') return null
          
          const fx = tx(conn.fromX)
          const fy = ty(conn.fromY)
          const tx_ = tx(conn.toX)
          const ty_ = ty(conn.toY)

          const d = Math.abs(fx - tx_) < 1
            ? `M ${fx} ${fy} L ${tx_} ${ty_}`
            : `M ${fx} ${fy} C ${fx} ${fy + (ty_ - fy)/2}, ${tx_} ${ty_ - (ty_ - fy)/2}, ${tx_} ${ty_}`

          return (
            <path
              key={`mm-${conn.fromId}-${conn.toId}`}
              d={d}
              strokeWidth="1.5"
              fill="none"
              className={`transition-all duration-500 ${
                conn.isMainPath ? 'stroke-blue-500' : 'stroke-slate-300'
              }`}
            />
          )
        })}
        {layout.nodes.map(n => {
          if (n.state === 'hidden') return null
          const cx = tx(n.x + (n.state === 'main' ? FULL_W : MINI_W) / 2)
          const cy = ty(n.y + CARD_H / 2)
          const role = n.node.metadata.nodeRole
          
          let fillClass = 'fill-slate-400'
          if (n.state === 'main') {
            if (role === 'branch_point') fillClass = 'fill-orange-500'
            else if (role === 'enum_param') fillClass = 'fill-green-500'
            else if (role === 'loop_target') fillClass = 'fill-purple-500'
            else fillClass = 'fill-blue-500'
          }
          
          return (
            <circle
              key={`mm-dot-${n.node.id}`}
              cx={cx}
              cy={cy}
              r={n.state === 'main' ? 3 : 2}
              className={`transition-all duration-500 ${fillClass} ${
                n.state === 'mini' ? 'cursor-pointer hover:fill-blue-400' : ''
              }`}
              onClick={() => {
                if (n.state === 'mini') {
                  let current = n.node
                  while (current.parentId) {
                    const parentNode = layout.nodes.find(ln => ln.node.id === current.parentId)
                    if (parentNode && parentNode.allChildrenNodes.length > 1) {
                      setActiveBranchMap(prev => ({ ...prev, [current.parentId!]: current.id }))
                      break
                    }
                    const nextCurrent = layout.nodes.find(ln => ln.node.id === current.parentId)?.node
                    if (!nextCurrent) break
                    current = nextCurrent
                  }
                }
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

// ===== Main Component =====
export default function OperationTreeView() {
  const { t } = useI18n()
  const nodes = useRecorderStore(s => s.nodes)
  const clearNodes = useRecorderStore(s => s.clearNodes)
  const status = useRecorderStore(s => s.status)
  const recordingMode = useRecorderStore(s => s.recordingMode)
  const selectedNodeId = useToolsetStore(s => s.selectedNodeId)
  const setSelectedNodeId = useToolsetStore(s => s.setSelectedNodeId)
  const replayStatus = useReplayStore(s => s.status)
  const containerRef = useRef<HTMLDivElement>(null)

  const [contextMenu, setContextMenu] = useState<{
    node: OperationNode
    position: { x: number; y: number }
  } | null>(null)

  const [hoveredConnection, setHoveredConnection] = useState<string | null>(null)
  const [expandedRoleNode, setExpandedRoleNode] = useState<string | null>(null)
  const [collapsedLoopGroups, setCollapsedLoopGroups] = useState<Set<string>>(new Set())
  const [activeBranchMap, setActiveBranchMap] = useState<Record<string, string>>({})

  const visibleNodes = useMemo(() => {
    const v = computeVisibleNodes(nodes, collapsedLoopGroups)
    if (v.length === 0 && nodes.length > 0) {
      return nodes
    }
    return v
  }, [nodes, collapsedLoopGroups])

  const tree = useMemo(() => buildTree(visibleNodes), [visibleNodes])
  const layout = useMemo(() => (tree ? computeLayout(tree, activeBranchMap) : null), [tree, activeBranchMap])

  const pendingConfirmationIds = useMemo(
    () => getPendingConfirmationNodeIds(visibleNodes),
    [visibleNodes]
  )

  // Auto-switch branch to show the newly added node
  const prevNodesRef = useRef(nodes)
  useEffect(() => {
    if (nodes.length === 0) {
      prevNodesRef.current = nodes
      return
    }

    const prevNodes = prevNodesRef.current
    prevNodesRef.current = nodes

    if (nodes.length > prevNodes.length) {
      const prevNodeIds = new Set(prevNodes.map(n => n.id))
      const newNodes = nodes.filter(n => !prevNodeIds.has(n.id))
      
      if (newNodes.length > 0) {
        const targetNode = newNodes[newNodes.length - 1]
        
        const mapToUpdate: Record<string, string> = {}
        let current = targetNode
        while (current.parentId) {
          mapToUpdate[current.parentId] = current.id
          const parent = nodes.find(n => n.id === current.parentId)
          if (!parent) break
          current = parent
        }
        
        if (Object.keys(mapToUpdate).length > 0) {
          setActiveBranchMap(prev => {
            let changed = false
            const next = { ...prev }
            for (const [pid, cid] of Object.entries(mapToUpdate)) {
              if (next[pid] !== cid) {
                next[pid] = cid
                changed = true
              }
            }
            return changed ? next : prev
          })
        }
      }
    }
  }, [nodes])

  // Auto-scroll to latest node when nodes change
  const prevNodeCount = useRef(nodes.length)
  useEffect(() => {
    if (layout && nodes.length > prevNodeCount.current && containerRef.current) {
      const lastNode = layout.nodes[layout.nodes.length - 1]
      containerRef.current.scrollTo({
        top: Math.max(0, lastNode.y - 100),
        left: Math.max(0, lastNode.x - containerRef.current.clientWidth / 2 + FULL_W / 2),
        behavior: 'smooth',
      })
    }
    prevNodeCount.current = nodes.length
  }, [nodes.length, layout])

  // 重复组：新组默认折叠；解散组后移除对应 id，避免已无 repeatGroup 仍折叠或状态残留
  useEffect(() => {
    const activeGroupIds = new Set(
      nodes.map(n => n.metadata.repeatGroupId).filter((id): id is string => !!id)
    )
    setCollapsedLoopGroups(prev => {
      const next = new Set<string>()
      for (const id of prev) {
        if (activeGroupIds.has(id)) next.add(id)
      }
      for (const id of activeGroupIds) {
        if (!next.has(id)) next.add(id)
      }
      if (next.size !== prev.size) return next
      for (const id of next) {
        if (!prev.has(id)) return next
      }
      return prev
    })
  }, [nodes])

  const toggleLoopGroup = useCallback((groupId: string) => {
    setCollapsedLoopGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  // Show ➕ buttons only when idle
  const isIdle = status === 'idle' && replayStatus === 'idle' && recordingMode === 'normal'

  const handleContinueRecording = useCallback(async (leafNodeId: string) => {
    const store = useRecorderStore.getState()
    store.setRecordingMode('continue')
    store.setActiveRecordingParentId(leafNodeId)
    store.setRecordingContinuationRootId(leafNodeId)
    const result = await useReplayStore.getState().startReplay(leafNodeId, store.nodes)
    if (result === 'rejected') store.resetTreeRecording()
  }, [])

  const handleBranchRecording = useCallback(async (parentNodeId: string, side: 'left' | 'right') => {
    const store = useRecorderStore.getState()
    store.setRecordingMode('branch')
    store.setActiveRecordingParentId(parentNodeId)
    store.setPendingBranchSide(side)
    const result = await useReplayStore.getState().startReplay(parentNodeId, store.nodes)
    if (result === 'rejected') store.resetTreeRecording()
  }, [])

  const handleContextMenu = (e: React.MouseEvent, node: OperationNode) => {
    e.preventDefault()
    setContextMenu({ node, position: { x: e.clientX, y: e.clientY } })
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="sticky top-0 z-40 shrink-0 bg-gray-50/90 backdrop-blur-sm text-xs text-gray-500 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between shadow-sm">
          <span>{t('tree.header', { count: 0 })}</span>
          <button
            type="button"
            onClick={clearNodes}
            disabled
            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {t('statusBar.clear')}
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-gray-400 text-sm gap-2 p-8 min-h-0">
          <span className="text-4xl">📝</span>
          <span>{t('tree.emptyTitle')}</span>
          <span className="text-xs">{t('tree.emptyHint')}</span>
        </div>
      </div>
    )
  }

  if (!layout) return null

  return (
    <div ref={containerRef} className="overflow-auto h-full">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-gray-50/90 backdrop-blur-sm text-xs text-gray-500 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between gap-2 shadow-sm">
        <span className="min-w-0 truncate">{t('tree.header', { count: nodes.length })}</span>
        <button
          type="button"
          onClick={clearNodes}
          className="shrink-0 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
        >
          {t('statusBar.clear')}
        </button>
      </div>

      <div className="sticky top-[53px] z-50 h-0 w-full overflow-visible pointer-events-none">
        <div className="absolute right-4 top-0 pointer-events-auto">
          <Minimap layout={layout} setActiveBranchMap={setActiveBranchMap} />
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative"
        style={{
          width: layout.width,
          height: layout.height,
          minWidth: '100%',
        }}
      >
        {/* SVG Connection Lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={layout.width}
          height={layout.height}
          style={{ overflow: 'visible' }}
        >
          {layout.connections.map(conn => {
            if (conn.fromState === 'hidden' || conn.toState === 'hidden') return null

            const d = Math.abs(conn.fromX - conn.toX) < 5
              ? `M ${conn.fromX} ${conn.fromY} L ${conn.toX} ${conn.toY}`
              : `M ${conn.fromX} ${conn.fromY} C ${conn.fromX} ${(conn.fromY + conn.toY) / 2}, ${conn.toX} ${(conn.fromY + conn.toY) / 2}, ${conn.toX} ${conn.toY}`
            return (
              <path
                key={`${conn.fromId}-${conn.toId}`}
                d={d}
                fill="none"
                strokeWidth={conn.isMainPath ? 3 : 2}
                strokeLinecap="round"
                strokeDasharray={conn.isMainPath ? 'none' : '4 4'}
                className={`transition-all duration-500 ${
                  conn.isMainPath ? 'stroke-blue-500' : 'stroke-slate-300'
                }`}
              />
            )
          })}
        </svg>

        {/* Branch ➕ buttons on connection lines (visible on hover) */}
        {isIdle && layout.connections.map(conn => {
          if (conn.fromState === 'hidden' || conn.toState === 'hidden') return null
          const connKey = `${conn.fromId}-${conn.toId}`
          const midY = (conn.fromY + conn.toY) / 2
          const midX = (conn.fromX + conn.toX) / 2
          const isHovered = hoveredConnection === connKey

          return (
            <div
              key={`branch-${connKey}`}
              className="absolute"
              style={{
                left: midX - 40,
                top: midY - 14,
                width: 80,
                height: 28,
              }}
              onMouseEnter={() => setHoveredConnection(connKey)}
              onMouseLeave={() => setHoveredConnection(null)}
            >
              {/* Left ➕ */}
              <button
                className={`absolute left-0 top-0.5 w-6 h-6 rounded-full bg-white border border-gray-300 text-gray-400 text-xs flex items-center justify-center hover:bg-blue-50 hover:border-blue-400 hover:text-blue-500 transition-all shadow-sm ${
                  isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}
                style={{ pointerEvents: isHovered ? 'auto' : 'none' }}
                onClick={() => handleBranchRecording(conn.fromId, 'left')}
                title={t('tree.branchLeft')}
              >
                +
              </button>
              {/* Right ➕ */}
              <button
                className={`absolute right-0 top-0.5 w-6 h-6 rounded-full bg-white border border-gray-300 text-gray-400 text-xs flex items-center justify-center hover:bg-blue-50 hover:border-blue-400 hover:text-blue-500 transition-all shadow-sm ${
                  isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}
                style={{ pointerEvents: isHovered ? 'auto' : 'none' }}
                onClick={() => handleBranchRecording(conn.fromId, 'right')}
                title={t('tree.branchRight')}
              >
                +
              </button>
            </div>
          )
        })}

        {/* Node Cards */}
        {layout.nodes.map(item => {
          const role = item.node.metadata.nodeRole
          const roleStyle = role ? ROLE_STYLES[role] : null
          const isExpanded = expandedRoleNode === item.node.id
          const hasCandidates = (item.node.metadata.candidates?.length ?? 0) > 0
          const hasLoopTarget = role === 'loop_target'
          const isExtractNode = item.node.action.type === 'extract_selected_content'
          const hasExtractResult = isExtractNode &&
            (!!item.node.action.extractedText || !!item.node.action.extractedScreenshot)
          const hasSelectorForEdit = !!item.node.action.selector &&
                                    item.node.action.type !== 'navigate' &&
                                    item.node.action.type !== 'scroll' &&
                                    item.node.action.type !== 'wait_for_timeout' &&
                                    item.node.action.type !== 'wait_for_navigation'
          const isExpandable = hasCandidates || 
                               hasLoopTarget || 
                               hasExtractResult || 
                               hasSelectorForEdit ||
                               role === 'enum_param' || 
                               role === 'branch_point' || 
                               role === 'dynamic_param' ||
                               item.node.action.type === 'click' || 
                               item.node.action.type === 'dblclick'
          const isUserConfirmed = item.node.metadata.nodeRoleSource === 'user'
          const isUnconfirmed = pendingConfirmationIds.has(item.node.id)
          const isEffectiveLoopTarget = role === 'loop_target' && !!item.node.metadata.loopTargetPattern
          
          const groupId = item.node.metadata.repeatGroupId
          const isLoopStartNode =
            role === 'loop_target' && !!item.node.metadata.isLoopStart && !!groupId
          const isGroupCollapsed = !!groupId && collapsedLoopGroups.has(groupId)
          const groupNodeCount = groupId ? nodes.filter(n => n.metadata.repeatGroupId === groupId).length : 0

          return (
            <div
              key={item.node.id}
              className="absolute transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                top: item.y,
                left: item.x,
                width: item.state === 'main' ? FULL_W : MINI_W,
                height: CARD_H,
                opacity: item.state === 'hidden' ? 0 : (item.state === 'mini' ? 0.7 : 1),
                transform: item.state === 'hidden' ? 'translateY(-20px) scale(0.5)' : 'none',
                pointerEvents: item.state === 'hidden' ? 'none' : 'auto',
                filter: item.state === 'mini' ? 'grayscale(60%)' : 'none',
                zIndex: item.state === 'main' ? 20 : (item.state === 'mini' ? 10 : 1),
              }}
            >
              {/* Node Card */}
              <div
                className={`w-full h-full rounded-lg border bg-white cursor-pointer overflow-hidden transition-colors box-border ${
                  item.state === 'main' ? (
                    isEffectiveLoopTarget
                      ? `border-purple-400 bg-purple-50 hover:border-purple-500 hover:shadow ${
                          selectedNodeId === item.node.id ? 'ring-2 ring-purple-200' : ''
                        }`
                      : role === 'enum_param' && isUserConfirmed
                      ? `border-green-400 bg-green-50 hover:border-green-500 hover:shadow ${
                          selectedNodeId === item.node.id ? 'ring-2 ring-green-200' : ''
                        }`
                      : role === 'branch_point' && isUserConfirmed
                      ? `border-orange-400 bg-orange-50 hover:border-orange-500 hover:shadow ${
                          selectedNodeId === item.node.id ? 'ring-2 ring-orange-200' : ''
                        }`
                      : isUnconfirmed
                      ? `border-blue-400 bg-blue-50 ${
                          selectedNodeId === item.node.id ? 'ring-2 ring-blue-200' : ''
                        }`
                      : selectedNodeId === item.node.id
                      ? 'border-blue-400 ring-2 ring-blue-100'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow'
                  ) : (
                    'border-gray-200 hover:border-gray-400 hover:shadow'
                  )
                } ${item.state === 'main' && isUnconfirmed ? 'shadow-[0_0_8px] shadow-blue-500/60 animate-pulse' : 'shadow-sm'}`}
                onClick={() => {
                  if (item.state === 'mini') {
                    // Find the ancestor fork where this branch diverged
                    let current = item.node
                    while (current.parentId) {
                      const parentNode = layout.nodes.find(n => n.node.id === current.parentId)
                      if (parentNode && parentNode.allChildrenNodes.length > 1) {
                        setActiveBranchMap(prev => ({ ...prev, [current.parentId!]: current.id }))
                        break
                      }
                      const nextCurrent = layout.nodes.find(n => n.node.id === current.parentId)?.node
                      if (!nextCurrent) break
                      current = nextCurrent
                    }
                  } else {
                    setSelectedNodeId(item.node.id)
                    if (isExpandable) {
                      setExpandedRoleNode(isExpanded ? null : item.node.id)
                    } else {
                      setExpandedRoleNode(null)
                    }
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, item.node)}
              >
                <div className="flex items-center h-full px-2" style={{ width: FULL_W }}>
                  <span className="text-sm leading-none shrink-0 w-5 text-center flex items-center justify-center">
                    {ACTION_ICONS[item.node.action.type] || '❓'}
                  </span>
                  
                  <div className={`flex flex-col ml-2 whitespace-nowrap transition-opacity duration-300 ${item.state !== 'main' ? 'opacity-0' : 'opacity-100'} flex-1 min-w-0`}>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium text-gray-800 text-xs">
                        {getActionLabel(item.node, t)}
                      </span>
                      {roleStyle && role !== 'normal' && (
                        <span
                          className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${roleStyle.bg} ${roleStyle.color} ${isUserConfirmed ? 'ring-1 ring-current' : 'opacity-70'}`}
                          title={isUserConfirmed ? t('tree.roleConfirmed') : t('tree.rolePending')}
                        >
                          {role ? getRoleLabel(role, t) : ''}
                        </span>
                      )}
                      {item.node.metadata.isToolBoundary && (
                        <span className="text-yellow-500 text-[10px] shrink-0" title={t('tree.toolBoundary')}>⚡</span>
                      )}
                      {isLoopStartNode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleLoopGroup(groupId!) }}
                          className="text-purple-400 text-[9px] px-1 py-0.5 rounded hover:bg-purple-100 hover:text-purple-600 shrink-0 transition-colors leading-none ml-auto"
                          title={isGroupCollapsed ? t('tree.expandOps') : t('tree.collapseOps')}
                        >
                          {isGroupCollapsed
                            ? (groupNodeCount > 1 ? `×${groupNodeCount}` : '↻')
                            : t('tree.collapseShort')}
                        </button>
                      )}
                    </div>
                    
                    <div className="text-gray-400 truncate text-[10px] mt-0.5">
                      {role === 'enum_param' && isUserConfirmed && item.node.metadata.candidates?.length
                        ? item.node.metadata.candidates.map(c => c.innerText || '?').join(' / ')
                        : role === 'loop_target' && item.node.metadata.loopTargetPattern
                        ? item.node.metadata.loopTargetPattern.fullSelector.slice(0, 30)
                        : isExtractNode && item.node.action.extractedText
                        ? item.node.action.extractedText.slice(0, 30)
                        : isExtractNode && item.node.action.extractedScreenshot
                        ? t('tree.screenshotCaptured')
                        : (item.node.action.selector.slice(0, 30) || item.node.action.url || '')
                      }
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Panel: extract preview or candidate roles panel */}
              {isExpanded && isExpandable && item.state === 'main' && (
                hasExtractResult
                  ? <ExtractPreviewPanel node={item.node} x={0} y={0} onClose={() => setExpandedRoleNode(null)} />
                  : <CandidatePanel node={item.node} x={0} y={0} onClose={() => setExpandedRoleNode(null)} />
              )}
            </div>
          )
        })}

        {/* Continue ➕ below leaf nodes */}
        {isIdle && layout.nodes
          .filter(item => item.isLeaf && item.state === 'main')
          .map(item => (
            <button
              key={`continue-${item.node.id}`}
              className="absolute w-7 h-7 rounded-full bg-white border-2 border-dashed border-gray-300 text-gray-400 text-sm flex items-center justify-center hover:bg-green-50 hover:border-green-400 hover:text-green-500 transition-all shadow-sm"
              style={{
                left: item.x + FULL_W / 2 - 14,
                top: item.y + CARD_H + (V_GAP - 28) / 2,
              }}
              onClick={() => handleContinueRecording(item.node.id)}
              title={t('tree.continueRec')}
            >
              +
            </button>
          ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <NodeContextMenu
          node={contextMenu.node}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
