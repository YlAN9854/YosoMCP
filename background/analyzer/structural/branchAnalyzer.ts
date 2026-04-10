// 分支分析 — LCS 相似度比较

import type { OperationNode } from '@/types/operationTree'
import type { BranchPath, BranchComparison, EnumBranchGroup } from '@/types/analysis'
import { generateSignature } from './signature'

// 提取分支路径：从操作树的分叉点出发，收集每条分支路径
export function extractBranchPaths(nodes: OperationNode[]): BranchPath[] {
  // 构建 parentId -> children 映射
  const childrenMap = new Map<string | null, OperationNode[]>()
  for (const node of nodes) {
    const list = childrenMap.get(node.parentId) || []
    list.push(node)
    childrenMap.set(node.parentId, list)
  }

  const paths: BranchPath[] = []

  // 找分叉点
  for (const [parentId, children] of childrenMap) {
    if (children.length <= 1 || parentId === null) continue

    for (const child of children) {
      // 收集该分支的路径 (从 child 开始向下走)
      const pathNodes: OperationNode[] = []
      let current: OperationNode | undefined = child

      while (current) {
        pathNodes.push(current)
        const nextChildren = childrenMap.get(current.id)
        current = nextChildren?.[0] // 取第一个子节点（线性路径）
      }

      const leafNode = pathNodes[pathNodes.length - 1]

      paths.push({
        leafNodeId: leafNode.id,
        forkNodeId: parentId,
        nodeIds: pathNodes.map(n => n.id),
        signatures: pathNodes.map(n => generateSignature(n).signature),
        label: child.metadata.branchLabel,
      })
    }
  }

  return paths
}

// LCS 相似度: similarity = (2 × LCS_length) / (len1 + len2)
export function calculateBranchSimilarity(branch1: string[], branch2: string[]): number {
  const m = branch1.length
  const n = branch2.length
  if (m === 0 || n === 0) return 0

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (branch1[i - 1] === branch2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const lcsLength = dp[m][n]
  return (2 * lcsLength) / (m + n)
}

// 比较所有分支对
export function compareAllBranches(paths: BranchPath[]): BranchComparison[] {
  const comparisons: BranchComparison[] = []

  // 按 forkNodeId 分组
  const groups = new Map<string, BranchPath[]>()
  for (const path of paths) {
    const list = groups.get(path.forkNodeId) || []
    list.push(path)
    groups.set(path.forkNodeId, list)
  }

  for (const groupPaths of groups.values()) {
    for (let i = 0; i < groupPaths.length; i++) {
      for (let j = i + 1; j < groupPaths.length; j++) {
        const b1 = groupPaths[i]
        const b2 = groupPaths[j]
        const similarity = calculateBranchSimilarity(b1.signatures, b2.signatures)
        const lcsLength = Math.round((similarity * (b1.signatures.length + b2.signatures.length)) / 2)

        // 找第一个不同
        let firstDifference: BranchComparison['firstDifference'] = null
        const minLen = Math.min(b1.signatures.length, b2.signatures.length)
        for (let k = 0; k < minLen; k++) {
          if (b1.signatures[k] !== b2.signatures[k]) {
            const sig1Parts = b1.signatures[k].split(':')
            firstDifference = {
              index: k,
              branch1Value: b1.signatures[k],
              branch2Value: b2.signatures[k],
              selector: sig1Parts[1] || '',
              actionType: sig1Parts[0] || '',
            }
            break
          }
        }

        comparisons.push({
          branch1LeafId: b1.leafNodeId,
          branch2LeafId: b2.leafNodeId,
          similarity,
          lcsLength,
          firstDifference,
          recommendation: similarity >= 0.7 ? 'merge_as_enum' : 'split_as_tools',
        })
      }
    }
  }

  return comparisons
}

// 枚举分支组识别
export function identifyEnumBranchGroups(
  comparisons: BranchComparison[],
  paths: BranchPath[],
  nodes: OperationNode[]
): EnumBranchGroup[] {
  const groups: EnumBranchGroup[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // 找出建议合并为枚举的分支对
  const enumComparisons = comparisons.filter(c => c.recommendation === 'merge_as_enum')

  // 按分支组归类
  const processed = new Set<string>()
  for (const comp of enumComparisons) {
    const key = `${comp.branch1LeafId}:${comp.branch2LeafId}`
    if (processed.has(key)) continue
    processed.add(key)

    const path1 = paths.find(p => p.leafNodeId === comp.branch1LeafId)
    const path2 = paths.find(p => p.leafNodeId === comp.branch2LeafId)
    if (!path1 || !path2) continue

    // 提取枚举值（从分支的第一个不同操作获取）
    const enumValues: string[] = []
    const branchLeafIds = [path1.leafNodeId, path2.leafNodeId]

    if (comp.firstDifference) {
      const idx = comp.firstDifference.index
      const node1 = nodeMap.get(path1.nodeIds[idx])
      const node2 = nodeMap.get(path2.nodeIds[idx])
      if (node1) enumValues.push(node1.action.innerText || node1.action.value || node1.action.selector)
      if (node2) enumValues.push(node2.action.innerText || node2.action.value || node2.action.selector)
    }

    groups.push({
      forkNodeId: path1.forkNodeId,
      branchLeafIds,
      enumValues,
      differenceSelector: comp.firstDifference?.selector || '',
    })
  }

  return groups
}
