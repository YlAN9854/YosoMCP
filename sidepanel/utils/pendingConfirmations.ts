import type { OperationNode } from '@/types/operationTree'

const DETERMINISTIC_ACTION_TYPES = new Set([
  'navigate',
  'scroll',
  'wait_for_url',
  'wait_for_selector',
  'wait_for_timeout',
  'wait_for_navigation',
  'fill',
  'select',
  'check',
  'keydown',
  'hover',
  'extract_selected_content',
  'upload',
])

function hasLoopTarget(path: OperationNode[], groupId: string): boolean {
  return path.some(node => (
    node.metadata.repeatGroupId === groupId
    && node.metadata.nodeRole === 'loop_target'
  ))
}

function isLoopBodyNode(node: OperationNode, path: OperationNode[]): boolean {
  const groupId = node.metadata.repeatGroupId
  if (!groupId || !hasLoopTarget(path, groupId)) return false
  return !node.metadata.isLoopStart && node.metadata.nodeRole !== 'loop_target'
}

function needsConfirmation(node: OperationNode, path: OperationNode[]): boolean {
  if (DETERMINISTIC_ACTION_TYPES.has(node.action.type)) return false
  if (node.metadata.nodeRoleSource === 'user') return false
  if (isLoopBodyNode(node, path)) return false
  return node.metadata.nodeRole !== 'normal' || Boolean(node.action.branchCandidates?.length)
}

function buildPath(node: OperationNode, nodeMap: Map<string, OperationNode>): OperationNode[] {
  const path: OperationNode[] = []
  let current: OperationNode | undefined = node
  while (current) {
    path.unshift(current)
    current = current.parentId ? nodeMap.get(current.parentId) : undefined
  }
  return path
}

export function getPendingConfirmationNodeIds(nodes: OperationNode[]): Set<string> {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const parentIds = new Set(nodes.map(node => node.parentId).filter((id): id is string => id !== null))
  const pendingIds = new Set<string>()

  for (const leaf of nodes.filter(node => !parentIds.has(node.id))) {
    const path = buildPath(leaf, nodeMap)
    for (const node of path) {
      if (needsConfirmation(node, path)) pendingIds.add(node.id)
    }
  }

  return pendingIds
}
