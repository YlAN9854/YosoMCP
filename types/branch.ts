import type { OperationNode } from './operationTree'
import type { ContentExtractMode } from './contentExtract'

export type BranchReplayStatus = 'code-ready' | 'text-only'

export interface BranchParam {
  nodeId: string
  name: string
  type: 'string' | 'number' | 'enum'
  description: string
  required: boolean
  defaultValue?: unknown
  defaultValueConfirmed?: boolean
  enumOptions?: string[]
  enumSelectorMap?: Record<string, string>
  source: 'enum_param' | 'dynamic_param' | 'loop_target'
}

export interface BranchReturn {
  nodeId: string
  selector: string
  extractMode: ContentExtractMode
  description?: string
}

export interface ToolRegistration {
  toolName: string
  toolDescription: string
  paramDescriptions: Record<string, string>
  /** 当 LLM 解析失败回退到默认命名时，记录原因供 UI 展示 */
  fallbackReason?: string
}

export interface Branch {
  id: string
  leafNodeId: string
  path: OperationNode[]
  startUrl?: string
  isReady: boolean
  unconfirmedNodeIds: string[]
  replayStatus: BranchReplayStatus
  failReason: string

  params: BranchParam[]
  returns: BranchReturn[]

  registration?: ToolRegistration
  generatedCode?: string
  hint?: string
}
