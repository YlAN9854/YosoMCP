// OperationTree 工具类 — 管理树状操作节点

import type { OperationNode, OperationTreeInfo } from '@/types/operationTree'
import type { RecordedAction } from '@/types/action'
import { v4 as uuidv4 } from 'uuid'

export class OperationTree {
  id: string
  rootNodeId: string
  label?: string
  nodes: Map<string, OperationNode>
  private childrenMap: Map<string, string[]>

  constructor(info?: OperationTreeInfo) {
    this.id = info?.id || uuidv4()
    this.rootNodeId = info?.rootNodeId || ''
    this.label = info?.label
    this.nodes = new Map()
    this.childrenMap = new Map()
  }

  addNode(action: RecordedAction, parentId: string | null): OperationNode {
    const node: OperationNode = {
      id: action.id || uuidv4(),
      parentId,
      action,
      timestamp: action.timestamp,
      metadata: {},
    }

    this.nodes.set(node.id, node)

    if (!this.rootNodeId && parentId === null) {
      this.rootNodeId = node.id
    }

    if (parentId) {
      const children = this.childrenMap.get(parentId) || []
      children.push(node.id)
      this.childrenMap.set(parentId, children)
    }

    return node
  }

  getNode(id: string): OperationNode | undefined {
    return this.nodes.get(id)
  }

  getChildren(nodeId: string): OperationNode[] {
    const childIds = this.childrenMap.get(nodeId) || []
    return childIds.map(id => this.nodes.get(id)!).filter(Boolean)
  }

  getParent(nodeId: string): OperationNode | undefined {
    const node = this.nodes.get(nodeId)
    if (!node || !node.parentId) return undefined
    return this.nodes.get(node.parentId)
  }

  // 获取从根到指定节点的路径
  getPathToNode(nodeId: string): OperationNode[] {
    const path: OperationNode[] = []
    let current = this.nodes.get(nodeId)
    while (current) {
      path.unshift(current)
      current = current.parentId ? this.nodes.get(current.parentId) : undefined
    }
    return path
  }

  // 获取所有叶子节点
  getLeafNodes(): OperationNode[] {
    const leaves: OperationNode[] = []
    for (const [id, node] of this.nodes) {
      const children = this.childrenMap.get(id)
      if (!children || children.length === 0) {
        leaves.push(node)
      }
    }
    return leaves
  }

  // 获取分叉点（有多个子节点的节点）
  getForkNodes(): OperationNode[] {
    const forks: OperationNode[] = []
    for (const [id, children] of this.childrenMap) {
      if (children.length > 1) {
        const node = this.nodes.get(id)
        if (node) forks.push(node)
      }
    }
    return forks
  }

  deleteNode(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (!node) return

    // 递归删除子节点
    const children = this.childrenMap.get(nodeId) || []
    for (const childId of children) {
      this.deleteNode(childId)
    }

    // 从父节点的子列表中移除
    if (node.parentId) {
      const siblings = this.childrenMap.get(node.parentId) || []
      this.childrenMap.set(
        node.parentId,
        siblings.filter(id => id !== nodeId)
      )
    }

    this.nodes.delete(nodeId)
    this.childrenMap.delete(nodeId)
  }

  // 获取线性节点列表（DFS 遍历）
  toLinearList(): OperationNode[] {
    if (!this.rootNodeId) return Array.from(this.nodes.values())

    const result: OperationNode[] = []
    const stack = [this.rootNodeId]

    while (stack.length > 0) {
      const id = stack.pop()!
      const node = this.nodes.get(id)
      if (!node) continue

      result.push(node)

      const children = this.childrenMap.get(id) || []
      // 反转以保持顺序
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i])
      }
    }

    return result
  }

  // 从节点数组重建树
  static fromNodes(nodes: OperationNode[]): OperationTree {
    const tree = new OperationTree()
    for (const node of nodes) {
      tree.nodes.set(node.id, node)
      if (node.parentId) {
        const children = tree.childrenMap.get(node.parentId) || []
        children.push(node.id)
        tree.childrenMap.set(node.parentId, children)
      } else if (!tree.rootNodeId) {
        tree.rootNodeId = node.id
      }
    }
    return tree
  }

  toInfo(): OperationTreeInfo {
    return {
      id: this.id,
      rootNodeId: this.rootNodeId,
      label: this.label,
    }
  }

  getAllNodes(): OperationNode[] {
    return Array.from(this.nodes.values())
  }

  get size(): number {
    return this.nodes.size
  }
}
