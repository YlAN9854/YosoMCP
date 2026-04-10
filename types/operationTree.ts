import type { RecordedAction } from './action'

export const LOOP_BODY_END_SELF = '__LOOP_BODY_END_SELF__'

// ===== 节点角色类型 =====
export type NodeRole = 'normal' | 'branch_point' | 'enum_param' | 'dynamic_param' | 'loop_target'
export type NodeRoleSource = 'auto' | 'user'

export interface NodeRoleCandidate {
  selector: string
  innerText?: string
  tagName?: string
  attributes?: Record<string, string>
  selected: boolean
  elementIndex?: number
  parentSelector?: string
}

export interface NodeRoleRecommendation {
  nodeId: string
  recommendedRole: NodeRole
  confidence: number
  reasoning: string
  candidates?: NodeRoleCandidate[]
}

export interface LoopTargetPattern {
  containerSelector: string
  itemSelector: string
  fullSelector: string
  matchCount: number
  clickTargetWithinItem?: string
  sampleTexts?: string[]
}

export interface OperationNodeMetadata {
  isToolBoundary?: boolean
  branchLabel?: string
  branchSide?: 'left' | 'right'
  isLoopStart?: boolean
  loopCount?: number
  enumGroupId?: string
  repeatGroupId?: string
  repeatLabel?: string
  branchInferenceConfirmed?: boolean

  // 节点角色
  nodeRole?: NodeRole
  nodeRoleSource?: NodeRoleSource
  candidates?: NodeRoleCandidate[]
  enumParamName?: string

  // loop_target
  loopTargetPattern?: LoopTargetPattern
  loopBodyEndNodeId?: string

  // 用户手动覆盖的选择器（原始值保留在 action.selector 中）
  selectorOverride?: string
}

export interface OperationNode {
  id: string
  parentId: string | null
  action: RecordedAction
  timestamp: number
  metadata: OperationNodeMetadata
}

export interface OperationTreeInfo {
  id: string
  rootNodeId: string
  label?: string
}

// ===== 回溯重放相关类型 =====

export interface ReplayStepResult {
  nodeId: string
  stepIndex: number
  totalSteps: number
  success: boolean
  error?: string
  duration: number
}

export interface ReplayCompleteResult {
  success: boolean
  totalSteps: number
  completedSteps: number
  failedAtIndex?: number
  failedError?: string
  totalDuration: number
  stepResults: ReplayStepResult[]
}
