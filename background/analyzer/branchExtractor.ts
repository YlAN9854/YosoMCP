import type { OperationNode } from '@/types/operationTree'
import { LOOP_BODY_END_SELF } from '@/types/operationTree'
import type { Branch, BranchParam, BranchReturn } from '@/types/branch'

/** 录制未保存本地路径时，供分支参数与生成代码使用的占位默认值（需通过非空字符串校验） */
const UPLOAD_PARAM_PLACEHOLDER_PATH = 'C://'

const DETERMINISTIC_ACTION_TYPES = new Set([
  'navigate', 'scroll',
  'wait_for_url', 'wait_for_selector', 'wait_for_timeout', 'wait_for_navigation',
  'fill', 'select', 'check', 'keydown',
  'hover', 'extract_selected_content', 'upload',
])

/**
 * 与 {@link extractBranches} 中各叶路径的 `unconfirmedNodeIds` 一致：任一路径上需确认的节点并集。
 * 用于侧栏操作树与「分支」面板的就绪提示对齐（含 `nodeRole === 'normal'` 但有分支候选的节点）。
 */
export function getAllUnconfirmedNodeIdsInTree(nodes: OperationNode[]): Set<string> {
  if (nodes.length === 0) return new Set()
  const branches = extractBranches(nodes)
  const ids = new Set<string>()
  for (const b of branches) {
    for (const id of b.unconfirmedNodeIds) ids.add(id)
  }
  return ids
}

export function extractBranches(nodes: OperationNode[]): Branch[] {
  const childrenMap = new Map<string, OperationNode[]>()
  const nodeMap = new Map<string, OperationNode>()
  let rootId: string | null = null

  for (const node of nodes) {
    nodeMap.set(node.id, node)
    if (!node.parentId) {
      rootId = node.id
    } else {
      const siblings = childrenMap.get(node.parentId) || []
      siblings.push(node)
      childrenMap.set(node.parentId, siblings)
    }
  }

  if (!rootId) return []

  const leaves = nodes.filter(n => {
    const children = childrenMap.get(n.id)
    return !children || children.length === 0
  })

  return leaves.map(leaf => {
    const path = buildPathToRoot(leaf.id, nodeMap)
    const startUrl = path.find(n => n.action.type === 'navigate' && !!n.action.url)?.action.url
    const unconfirmedNodeIds = getUnconfirmedNodes(path)
    const params = extractParams(path, nodeMap)
    const returns = extractReturns(path)

    return {
      id: leaf.id,
      leafNodeId: leaf.id,
      path,
      startUrl,
      isReady: unconfirmedNodeIds.length === 0,
      unconfirmedNodeIds,
      replayStatus: 'text-only',
      failReason: '尚未执行回溯验证',
      params,
      returns,
    }
  })
}

function buildPathToRoot(
  leafId: string,
  nodeMap: Map<string, OperationNode>
): OperationNode[] {
  const path: OperationNode[] = []
  let currentId: string | null = leafId

  while (currentId) {
    const node = nodeMap.get(currentId)
    if (!node) break
    path.unshift(node)
    currentId = node.parentId
  }

  return path
}

/**
 * 当前路径上该 repeatGroup 是否仍存在「循环目标」。
 * 误检循环后用户把首节点改为枚举时，组内可能仍带 auto-repeat id，但已无 loop_target；
 * 若仍按循环体处理会吞掉后续枚举参数，且折叠 UI 会隐藏节点。
 */
function hasLoopTargetOnPath(path: OperationNode[], repeatGroupId: string): boolean {
  return path.some(
    n =>
      n.metadata.repeatGroupId === repeatGroupId &&
      n.metadata.nodeRole === 'loop_target'
  )
}

function isLoopBodyNode(node: OperationNode, path: OperationNode[]): boolean {
  const meta = node.metadata
  const gid = meta.repeatGroupId
  if (!gid) return false
  if (!hasLoopTargetOnPath(path, gid)) return false
  const isLoopStart = !!meta.isLoopStart
  const isLoopTarget = meta.nodeRole === 'loop_target'
  return !isLoopStart && !isLoopTarget
}

function getUnconfirmedNodes(path: OperationNode[]): string[] {
  return path
    .filter(node => {
      // 确定性动作不需要确认
      if (DETERMINISTIC_ACTION_TYPES.has(node.action.type)) return false
      // 已被用户确认角色的节点不需要再次确认
      if (node.metadata.nodeRoleSource === 'user') return false
      // 循环体内部的节点对工具函数结构影响很小，不强制确认
      if (isLoopBodyNode(node, path)) return false
      // 普通节点且没有分支候选，认为不需要确认
      if (node.metadata.nodeRole === 'normal' && !node.action.branchCandidates?.length) return false
      return true
    })
    .map(n => n.id)
}

function extractParams(
  path: OperationNode[],
  nodeMap: Map<string, OperationNode>
): BranchParam[] {
  const params: BranchParam[] = []

  for (const node of path) {
    const role = node.metadata.nodeRole

    // 循环体内部的枚举、动态节点不作为工具参数提取
    if ((role === 'enum_param' || role === 'dynamic_param') && isLoopBodyNode(node, path)) {
      continue
    }

    if (role === 'enum_param') {
      const candidates = node.metadata.candidates || []
      const selected = candidates.filter(c => c.selected)
      const enumOptions = selected.map(c => c.innerText || c.selector).filter(Boolean)
      const rawDefault = node.action.innerText?.trim()
      const defaultValue = rawDefault && enumOptions.includes(rawDefault) ? rawDefault : undefined
      const selectorMap: Record<string, string> = {}
      for (const c of selected) {
        const label = c.innerText || c.selector
        if (label) selectorMap[label] = c.selector
      }

      params.push({
        nodeId: node.id,
        name: node.metadata.enumParamName || `param_${params.length + 1}`,
        type: 'enum',
        description: `Enum parameter from ${node.action.type} on ${node.action.selector}`,
        required: true,
        enumOptions,
        enumSelectorMap: selectorMap,
        defaultValue,
        defaultValueConfirmed: defaultValue !== undefined,
        source: 'enum_param',
      })
    }

    if (role === 'dynamic_param') {
      const attrName = node.action.attributes?.['name']
        || node.action.attributes?.['placeholder']
        || `input_${params.length + 1}`
      params.push({
        nodeId: node.id,
        name: attrName,
        type: 'string',
        description: `Input value for ${node.action.selector}`,
        required: true,
        defaultValue: node.action.value,
        defaultValueConfirmed: true,
        source: 'dynamic_param',
      })
    }

    if (node.action.type === 'upload') {
      const recorded = node.action.filePath?.trim()
      const defaultValue = recorded && recorded.length > 0 ? recorded : UPLOAD_PARAM_PLACEHOLDER_PATH
      params.push({
        nodeId: node.id,
        name: node.action.filePathArgName || 'filePath',
        type: 'string',
        description: `File path for upload to ${node.action.selector}`,
        required: true,
        defaultValue,
        defaultValueConfirmed: true,
        source: 'dynamic_param',
      })
    }

    if (role === 'loop_target') {
      const pattern = node.metadata.loopTargetPattern
      params.push({
        nodeId: node.id,
        name: 'count',
        type: 'number',
        description: `Number of items to iterate (${pattern?.matchCount ?? '?'} available)`,
        required: false,
        defaultValue: pattern?.matchCount ?? 5,
        defaultValueConfirmed: true,
        source: 'loop_target',
      })
    }
  }

  return params
}

function extractReturns(path: OperationNode[]): BranchReturn[] {
  return path
    .filter(n => n.action.type === 'extract_selected_content')
    .map(n => ({
      nodeId: n.id,
      selector: n.action.extractedSelector || n.action.selector,
      extractMode: n.action.extractMode || 'text',
    }))
}

export function getLoopBodyNodes(
  loopTargetNode: OperationNode,
  path: OperationNode[]
): OperationNode[] {
  const startIdx = path.findIndex(n => n.id === loopTargetNode.id)
  if (startIdx < 0) return []

  const endNodeId = loopTargetNode.metadata.loopBodyEndNodeId
  if (!endNodeId || endNodeId === LOOP_BODY_END_SELF) return []

  const body: OperationNode[] = []
  for (let i = startIdx + 1; i < path.length; i++) {
    body.push(path[i])
    if (path[i].id === endNodeId) break
  }
  return body
}

export function getBranchSummary(branch: Branch): string {
  const keySteps = branch.path
    .filter(n => !['wait_for_selector', 'wait_for_url', 'wait_for_timeout', 'wait_for_navigation'].includes(n.action.type))
    .map(n => {
      const role = n.metadata.nodeRole
      const type = n.action.type
      const text = n.action.innerText?.slice(0, 20) || ''
      if (role === 'enum_param') return `[enum] ${type} "${text}"`
      if (role === 'dynamic_param') return `[input] ${type} "${n.action.value?.slice(0, 20) || ''}"`
      if (role === 'loop_target') return `[loop] ${type} "${text}"`
      if (type === 'extract_selected_content') return `[extract] ${n.action.extractMode || 'text'}`
      if (type === 'hover') return `[hover] "${text}"`
      if (type === 'navigate') return `[nav] ${n.action.url?.slice(0, 40) || ''}`
      return `${type} "${text}"`
    })

  return keySteps.join(' → ')
}
