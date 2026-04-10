// 拆分点检测 + 工具片段生成

import type { OperationNode } from '@/types/operationTree'
import type { SplitPoint, ToolSegment, RepeatPattern } from '@/types/analysis'
import { v4 as uuidv4 } from 'uuid'

export function detectSplitPoints(nodes: OperationNode[]): SplitPoint[] {
  const points: SplitPoint[] = []

  for (const node of nodes) {
    // loop_target 节点不作为拆分点
    if (node.metadata.nodeRole === 'loop_target') continue

    // 1. 用户标记的边界
    if (node.metadata.isToolBoundary) {
      points.push({
        nodeId: node.id,
        type: 'user_marked',
        confidence: 1.0,
      })
    }

    // 2. 等待操作作为拆分点
    if (
      ['wait_for_url', 'wait_for_selector', 'wait_for_navigation'].includes(node.action.type)
    ) {
      points.push({
        nodeId: node.id,
        type: 'wait_point',
        confidence: 0.8,
        reason: '等待操作表示状态转换',
      })
    }

    // 3. URL 边界
    if (node.action.type === 'navigate') {
      points.push({
        nodeId: node.id,
        type: 'url_boundary',
        confidence: 0.6,
        reason: '页面导航表示新阶段',
      })
    }
  }

  return points
}

// 按拆分点将节点序列切割为工具片段
export function generateToolSegments(
  nodes: OperationNode[],
  splitPoints: SplitPoint[],
  repeatPatterns: RepeatPattern[]
): ToolSegment[] {
  if (nodes.length === 0) return []

  const splitNodeIds = new Set(splitPoints.map(sp => sp.nodeId))
  const segments: ToolSegment[] = []
  let currentNodeIds: string[] = []

  for (const node of nodes) {
    if (splitNodeIds.has(node.id) && currentNodeIds.length > 0) {
      segments.push(buildSegment(currentNodeIds, nodes, repeatPatterns, splitPoints, node.id))
      currentNodeIds = []
    }
    currentNodeIds.push(node.id)
  }

  // 最后一段
  if (currentNodeIds.length > 0) {
    segments.push(buildSegment(currentNodeIds, nodes, repeatPatterns, splitPoints))
  }

  return segments
}

function buildSegment(
  nodeIds: string[],
  allNodes: OperationNode[],
  repeatPatterns: RepeatPattern[],
  splitPoints: SplitPoint[],
  splitNodeId?: string
): ToolSegment {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))

  // 检测该片段中是否包含循环
  const loopPattern = repeatPatterns.find(rp =>
    rp.patternNodeIds.some(pids => pids.some(pid => nodeIds.includes(pid)))
  )

  // 提取关键操作
  const keyActions = nodeIds
    .map(id => nodeMap.get(id)!)
    .filter(n => ['click', 'fill', 'navigate', 'select'].includes(n.action.type))
    .slice(0, 5)
    .map(n => ({
      type: n.action.type,
      target: n.action.selector,
      value: n.action.value,
    }))

  const sp = splitNodeId ? splitPoints.find(s => s.nodeId === splitNodeId) : undefined

  return {
    id: uuidv4(),
    nodeIds,
    hasLoop: !!loopPattern,
    loopPattern,
    keyActions,
    splitReason: sp?.type || 'auto',
  }
}
