import type { ToolDefinition } from './tool'

export interface OperationSignature {
  nodeId: string
  signature: string
  normalizedSelector: string
  actionType: string
  value?: string
}

export interface RepeatPattern {
  patternSignatures: string[]
  patternNodeIds: string[][]
  repeatCount: number
  startIndex: number
  endIndex: number
  patternLength: number
}

export interface BranchPath {
  leafNodeId: string
  forkNodeId: string
  nodeIds: string[]
  signatures: string[]
  label?: string
}

export interface BranchComparison {
  branch1LeafId: string
  branch2LeafId: string
  similarity: number
  lcsLength: number
  firstDifference: {
    index: number
    branch1Value: string
    branch2Value: string
    selector: string
    actionType: string
  } | null
  recommendation: 'merge_as_enum' | 'split_as_tools'
}

export interface EnumBranchGroup {
  forkNodeId: string
  branchLeafIds: string[]
  enumValues: string[]
  suggestedParamName?: string
  differenceSelector: string
}

export type SplitPointType =
  | 'user_marked'
  | 'wait_point'
  | 'login_complete'
  | 'url_boundary'
  | 'long_wait'

export interface SplitPoint {
  nodeId: string
  type: SplitPointType
  confidence: number
  reason?: string
}

export interface ToolSegment {
  id: string
  nodeIds: string[]
  hasLoop: boolean
  loopPattern?: RepeatPattern
  keyActions: { type: string; target: string; value?: string }[]
  splitReason: SplitPointType | 'auto'
}

export interface StructuralAnalysisResult {
  signatures: OperationSignature[]
  repeatPatterns: RepeatPattern[]
  branchPaths: BranchPath[]
  branchComparisons: BranchComparison[]
  enumBranchGroups: EnumBranchGroup[]
  splitPoints: SplitPoint[]
  toolSegments: ToolSegment[]
}

export interface AnalysisResult {
  tools: ToolDefinition[]
  paramSuggestions: {
    nodeId: string
    name: string
    type: 'string' | 'number' | 'boolean'
    description: string
    defaultValue: unknown
    source: 'fill_input' | 'loop_count' | 'enum_branch'
  }[]
  splitSuggestions: { nodeId: string; reason: string }[]
  structuralResult: StructuralAnalysisResult
  warnings: { type: string; message: string }[]
}

export interface AnalysisProgress {
  stage: 'structural' | 'semantic' | 'generation'
  stageName: string
  status: 'running' | 'completed' | 'error'
  message?: string
  percent?: number
}
