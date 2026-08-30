import type { OperationNode, OperationTreeInfo } from '@/types/operationTree'
import type { ToolSet } from '@/types/toolset'

function currentTrees(toolSet: ToolSet, nodes: OperationNode[]): OperationTreeInfo[] {
  const existingByRoot = new Map(
    toolSet.operationTrees.map(tree => [tree.rootNodeId, tree]),
  )

  return nodes
    .filter(node => node.parentId === null)
    .map(node => existingByRoot.get(node.id) ?? {
      id: `tree-${node.id}`,
      rootNodeId: node.id,
      label: node.action.url ?? node.action.type,
    })
}

export function buildToolSetSnapshot(
  toolSet: ToolSet,
  nodes: OperationNode[],
  targetUrl: string | null,
): ToolSet {
  return {
    ...toolSet,
    operationTrees: currentTrees(toolSet, nodes),
    operationNodes: nodes,
    targetUrl: targetUrl ?? toolSet.targetUrl,
    updatedAt: Date.now(),
  }
}
