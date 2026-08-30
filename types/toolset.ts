import type { OperationTreeInfo, OperationNode } from './operationTree'

export interface ToolSet {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  targetUrl?: string
  operationTrees: OperationTreeInfo[]
  operationNodes: OperationNode[]
  metadata: {
    website?: string
    tags?: string[]
    [key: string]: unknown
  }
}
