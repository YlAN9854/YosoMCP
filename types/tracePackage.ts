import type { ActionType, FillSemantics } from './action'
import type { ContentExtractMode } from './contentExtract'
import type { NodeRole, NodeRoleSource } from './operationTree'

export const TRACE_PACKAGE_FORMAT = 'yoso-trace-package' as const
export const TRACE_PACKAGE_FORMAT_VERSION = 1 as const
export const TRACE_SCHEMA_VERSION = 1 as const
export const TRACE_REDACTION_POLICY_VERSION = 1 as const
export const TRACE_CLIPBOARD_FORMAT = 'yoso-trace-clipboard' as const
export const TRACE_CLIPBOARD_FORMAT_VERSION = 1 as const
export const TRACE_CLIPBOARD_SENTINEL = 'YOSO_TRACE_CLIPBOARD_V1' as const
export const TRACE_CLIPBOARD_INSTRUCTION = '请使用 $yoso-trace-compiler 验证并导入以下 YOSO 剪贴板轨迹。' as const

export type TraceRedactionCode =
  | 'action-value'
  | 'credential'
  | 'url-query'
  | 'url-fragment'
  | 'file-path'
  | 'attributes'
  | 'screenshot'
  | 'extracted-text'
  | 'llm-settings'
  | 'text-secret'

export type TraceRedactionEventV1 = {
  readonly path: string
  readonly code: TraceRedactionCode
}

export type TraceRedactionSummaryV1 = {
  readonly policyVersion: typeof TRACE_REDACTION_POLICY_VERSION
  readonly mode: 'safe-default'
  readonly total: number
  readonly byCode: Readonly<Partial<Record<TraceRedactionCode, number>>>
}

export type TracePackageManifestV1 = {
  readonly format: typeof TRACE_PACKAGE_FORMAT
  readonly formatVersion: typeof TRACE_PACKAGE_FORMAT_VERSION
  readonly traceSchemaVersion: typeof TRACE_SCHEMA_VERSION
  readonly packageId: string
  readonly createdAt: string
  readonly producer: {
    readonly name: 'YOSO'
    readonly version: string
  }
  readonly traceFile: 'trace.json'
  readonly summary: {
    readonly treeCount: number
    readonly nodeCount: number
  }
  readonly redaction: TraceRedactionSummaryV1
}

export type TraceTreeV1 = {
  readonly id: string
  readonly rootNodeId: string
  readonly label?: string
}

export type TraceBranchCandidateV1 = {
  readonly selector: string
  readonly tagName?: string
  readonly elementIndex?: number
  readonly parentSelector?: string
}

export type TraceNodeRoleCandidateV1 = TraceBranchCandidateV1 & {
  readonly selected: boolean
}

export type TraceLoopTargetPatternV1 = {
  readonly containerSelector: string
  readonly itemSelector: string
  readonly fullSelector: string
  readonly matchCount: number
  readonly clickTargetWithinItem?: string
  readonly sampleTexts?: readonly string[]
}

export type TraceNodeMetadataV1 = {
  readonly isToolBoundary?: boolean
  readonly branchLabel?: string
  readonly branchSide?: 'left' | 'right'
  readonly isLoopStart?: boolean
  readonly loopCount?: number
  readonly enumGroupId?: string
  readonly repeatGroupId?: string
  readonly repeatLabel?: string
  readonly branchInferenceConfirmed?: boolean
  readonly nodeRole?: NodeRole
  readonly nodeRoleSource?: NodeRoleSource
  readonly candidates?: readonly TraceNodeRoleCandidateV1[]
  readonly enumParamName?: string
  readonly loopTargetPattern?: TraceLoopTargetPatternV1
  readonly loopBodyEndNodeId?: string
  readonly selectorOverride?: string
}

export type TraceActionV1 = {
  readonly id: string
  readonly type: ActionType
  readonly selector: string
  readonly timestamp: number
  readonly url?: string
  readonly key?: string
  readonly filePathArgName?: string
  readonly branchCandidates?: readonly TraceBranchCandidateV1[]
  readonly innerText?: string
  readonly comment?: string
  readonly elementIndex?: number
  readonly parentSelector?: string
  readonly selectorMatchIndex?: number
  readonly waitTimeout?: number
  readonly waitPattern?: string
  readonly waitState?: 'visible' | 'hidden' | 'attached' | 'detached'
  readonly extractMode?: ContentExtractMode
  readonly extractedSelector?: string
  readonly tagName?: string
  readonly inputType?: string
  readonly checked?: boolean
  readonly scrollPosition?: Readonly<{ x: number; y: number }>
  readonly selectedText?: string
  readonly frameId?: number
  readonly frameUrl?: string
  readonly frameSelector?: string
  readonly frameSelectors?: readonly string[]
  readonly fillSemantics?: Readonly<FillSemantics>
  readonly redactedFields: readonly TraceRedactionCode[]
}

export type TraceNodeV1 = {
  readonly id: string
  readonly parentId: string | null
  readonly timestamp: number
  readonly metadata: TraceNodeMetadataV1
  readonly action: TraceActionV1
}

export type TraceDocumentV1 = {
  readonly schemaVersion: typeof TRACE_SCHEMA_VERSION
  readonly traceId: string
  readonly name: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly targetUrl?: string
  readonly trees: readonly TraceTreeV1[]
  readonly nodes: readonly TraceNodeV1[]
  readonly redactions: readonly TraceRedactionEventV1[]
}

export type TraceClipboardEnvelopeV1 = {
  readonly format: typeof TRACE_CLIPBOARD_FORMAT
  readonly formatVersion: typeof TRACE_CLIPBOARD_FORMAT_VERSION
  readonly manifest: TracePackageManifestV1
  readonly trace: TraceDocumentV1
}

export type TracePackageFile = {
  readonly filename: 'manifest.json' | 'trace.json'
  readonly content: string
}

export type TracePackageOutput = {
  readonly filename: string
  readonly files: readonly TracePackageFile[]
  readonly clipboardText: string
  readonly summary: {
    readonly treeCount: number
    readonly nodeCount: number
    readonly redactionCount: number
  }
}

export type TracePackageGenerationContext = {
  readonly packageId: string
  readonly createdAt: string
  readonly producerVersion: string
}
