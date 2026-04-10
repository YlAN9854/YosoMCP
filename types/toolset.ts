import type { OperationTreeInfo, OperationNode } from './operationTree'
import type { Branch } from './branch'
import type { ToolDefinition } from './tool'
import type { AnalysisResult } from './analysis'
import type { LLMSettings } from './message'

export interface AnalysisCache {
  timestamp: number
  operationTreeHash: string
  result: AnalysisResult
  confirmed: boolean
  confirmedAt?: number
}

export interface ToolSet {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  targetUrl?: string
  operationTrees: OperationTreeInfo[]
  operationNodes: OperationNode[]
  branches?: Branch[]
  tools: ToolDefinition[]
  metadata: {
    website?: string
    tags?: string[]
    replayValidationVersion?: number
    // 可选：与此工具集绑定的 LLM 配置（用于导入/导出）
    llmSettings?: LLMSettings
  }
  analysisCache?: AnalysisCache
}
