import type { BranchCandidate, RecordedAction } from '../../types/action.ts'
import type { NodeRoleCandidate, OperationNodeMetadata } from '../../types/operationTree.ts'
import type { ToolSet } from '../../types/toolset.ts'
import {
  TRACE_SCHEMA_VERSION,
  type TraceActionV1,
  type TraceBranchCandidateV1,
  type TraceDocumentV1,
  type TraceNodeMetadataV1,
  type TraceNodeRoleCandidateV1,
  type TraceNodeV1,
  type TraceRedactionCode,
  type TraceRedactionEventV1,
  type TraceTreeV1,
} from '../../types/tracePackage.ts'
import { assertSafeTraceId, normalizeTraceTrees } from './traceGraph.ts'

type RedactionCollector = {
  readonly events: Map<string, TraceRedactionEventV1>
}

const TEXT_SECRET_PATTERN = /\b(password|passwd|token|secret|api[_-]?key|authorization)\b\s*[:=]\s*([^\s,;]+)/gi
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi
const CREDENTIAL_HINT_PATTERN = /password|passwd|current-password|new-password|one-time-code|credential|secret|token/i

function addRedaction(
  collector: RedactionCollector,
  path: string,
  code: TraceRedactionCode,
  actionCodes?: Set<TraceRedactionCode>,
): void {
  collector.events.set(`${path}\0${code}`, { path, code })
  actionCodes?.add(code)
}

function scrubText(
  value: string | undefined,
  path: string,
  collector: RedactionCollector,
  actionCodes?: Set<TraceRedactionCode>,
): string | undefined {
  if (value === undefined) return undefined
  const scrubbed = value
    .replace(TEXT_SECRET_PATTERN, '$1=[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  if (scrubbed !== value) addRedaction(collector, path, 'text-secret', actionCodes)
  return scrubbed
}

function scrubUrl(
  value: string | undefined,
  path: string,
  collector: RedactionCollector,
  actionCodes?: Set<TraceRedactionCode>,
): string | undefined {
  if (value === undefined) return undefined
  let cleaned = value
  try {
    const parsed = new URL(value)
    if (parsed.search) addRedaction(collector, path, 'url-query', actionCodes)
    if (parsed.hash) addRedaction(collector, path, 'url-fragment', actionCodes)
    if (parsed.username || parsed.password) {
      addRedaction(collector, path, 'credential', actionCodes)
      parsed.username = ''
      parsed.password = ''
    }
    parsed.search = ''
    parsed.hash = ''
    cleaned = parsed.toString()
  } catch {
    const queryIndex = value.indexOf('?')
    const fragmentIndex = value.indexOf('#')
    if (queryIndex >= 0) addRedaction(collector, path, 'url-query', actionCodes)
    if (fragmentIndex >= 0) addRedaction(collector, path, 'url-fragment', actionCodes)
    const cutAt = [queryIndex, fragmentIndex].filter(index => index >= 0).sort((a, b) => a - b)[0]
    cleaned = cutAt === undefined ? value : value.slice(0, cutAt)
  }
  return scrubText(cleaned, path, collector, actionCodes)
}

function redactBranchCandidate(
  candidate: BranchCandidate,
  path: string,
  collector: RedactionCollector,
  actionCodes: Set<TraceRedactionCode>,
): TraceBranchCandidateV1 {
  if (candidate.innerText !== undefined) addRedaction(collector, `${path}/innerText`, 'extracted-text', actionCodes)
  if (candidate.attributes !== undefined) addRedaction(collector, `${path}/attributes`, 'attributes', actionCodes)
  return {
    selector: scrubText(candidate.selector, `${path}/selector`, collector, actionCodes) ?? '',
    tagName: scrubText(candidate.tagName, `${path}/tagName`, collector, actionCodes),
    elementIndex: candidate.elementIndex,
    parentSelector: scrubText(candidate.parentSelector, `${path}/parentSelector`, collector, actionCodes),
  }
}

function redactRoleCandidate(
  candidate: NodeRoleCandidate,
  path: string,
  collector: RedactionCollector,
): TraceNodeRoleCandidateV1 {
  if (candidate.innerText !== undefined) addRedaction(collector, `${path}/innerText`, 'extracted-text')
  if (candidate.attributes !== undefined) addRedaction(collector, `${path}/attributes`, 'attributes')
  return {
    selector: scrubText(candidate.selector, `${path}/selector`, collector) ?? '',
    tagName: scrubText(candidate.tagName, `${path}/tagName`, collector),
    elementIndex: candidate.elementIndex,
    parentSelector: scrubText(candidate.parentSelector, `${path}/parentSelector`, collector),
    selected: candidate.selected,
  }
}

function redactMetadata(metadata: OperationNodeMetadata, path: string, collector: RedactionCollector): TraceNodeMetadataV1 {
  const loop = metadata.loopTargetPattern
  return {
    isToolBoundary: metadata.isToolBoundary,
    branchLabel: scrubText(metadata.branchLabel, `${path}/branchLabel`, collector),
    branchSide: metadata.branchSide,
    isLoopStart: metadata.isLoopStart,
    loopCount: metadata.loopCount,
    enumGroupId: scrubText(metadata.enumGroupId, `${path}/enumGroupId`, collector),
    repeatGroupId: scrubText(metadata.repeatGroupId, `${path}/repeatGroupId`, collector),
    repeatLabel: scrubText(metadata.repeatLabel, `${path}/repeatLabel`, collector),
    branchInferenceConfirmed: metadata.branchInferenceConfirmed,
    nodeRole: metadata.nodeRole,
    nodeRoleSource: metadata.nodeRoleSource,
    candidates: metadata.candidates?.map((candidate, index) => redactRoleCandidate(candidate, `${path}/candidates/${index}`, collector)),
    enumParamName: scrubText(metadata.enumParamName, `${path}/enumParamName`, collector),
    loopTargetPattern: loop === undefined ? undefined : {
      containerSelector: scrubText(loop.containerSelector, `${path}/loopTargetPattern/containerSelector`, collector) ?? '',
      itemSelector: scrubText(loop.itemSelector, `${path}/loopTargetPattern/itemSelector`, collector) ?? '',
      fullSelector: scrubText(loop.fullSelector, `${path}/loopTargetPattern/fullSelector`, collector) ?? '',
      matchCount: loop.matchCount,
      clickTargetWithinItem: scrubText(loop.clickTargetWithinItem, `${path}/loopTargetPattern/clickTargetWithinItem`, collector),
      sampleTexts: loop.sampleTexts?.map((text, index) => scrubText(text, `${path}/loopTargetPattern/sampleTexts/${index}`, collector) ?? ''),
    },
    loopBodyEndNodeId: scrubText(metadata.loopBodyEndNodeId, `${path}/loopBodyEndNodeId`, collector),
    selectorOverride: scrubText(metadata.selectorOverride, `${path}/selectorOverride`, collector),
  }
}

function isCredentialAction(action: RecordedAction): boolean {
  if (action.inputType?.toLowerCase() === 'password') return true
  return Object.entries(action.attributes ?? {}).some(([key, value]) => (
    CREDENTIAL_HINT_PATTERN.test(key) || CREDENTIAL_HINT_PATTERN.test(value)
  ))
}

function redactAction(action: RecordedAction, path: string, collector: RedactionCollector): TraceActionV1 {
  const codes = new Set<TraceRedactionCode>()
  if (action.value !== undefined) {
    addRedaction(collector, `${path}/value`, 'action-value', codes)
    if (isCredentialAction(action)) addRedaction(collector, `${path}/value`, 'credential', codes)
  }
  if (action.type === 'upload' || action.filePath !== undefined) {
    addRedaction(collector, `${path}/filePath`, 'file-path', codes)
  }
  if (action.attributes !== undefined) addRedaction(collector, `${path}/attributes`, 'attributes', codes)
  if (action.extractedText !== undefined) addRedaction(collector, `${path}/extractedText`, 'extracted-text', codes)
  if (action.extractedScreenshot !== undefined) addRedaction(collector, `${path}/extractedScreenshot`, 'screenshot', codes)
  const text = (value: string | undefined, field: string): string | undefined => scrubText(value, `${path}/${field}`, collector, codes)
  const url = (value: string | undefined, field: string): string | undefined => scrubUrl(value, `${path}/${field}`, collector, codes)
  return {
    id: action.id,
    type: action.type,
    selector: text(action.selector, 'selector') ?? '',
    timestamp: action.timestamp,
    url: url(action.url, 'url'),
    key: text(action.key, 'key'),
    filePathArgName: text(action.filePathArgName, 'filePathArgName'),
    branchCandidates: action.branchCandidates?.map((candidate, index) => redactBranchCandidate(candidate, `${path}/branchCandidates/${index}`, collector, codes)),
    innerText: text(action.innerText, 'innerText'),
    comment: text(action.comment, 'comment'),
    elementIndex: action.elementIndex,
    parentSelector: text(action.parentSelector, 'parentSelector'),
    selectorMatchIndex: action.selectorMatchIndex,
    waitTimeout: action.waitTimeout,
    waitPattern: text(action.waitPattern, 'waitPattern'),
    waitState: action.waitState,
    extractMode: action.extractMode,
    extractedSelector: text(action.extractedSelector, 'extractedSelector'),
    tagName: text(action.tagName, 'tagName'),
    inputType: text(action.inputType, 'inputType'),
    checked: action.checked,
    scrollPosition: action.scrollPosition === undefined ? undefined : { x: action.scrollPosition.x, y: action.scrollPosition.y },
    selectedText: text(action.selectedText, 'selectedText'),
    frameId: action.frameId,
    frameUrl: url(action.frameUrl, 'frameUrl'),
    frameSelector: text(action.frameSelector, 'frameSelector'),
    frameSelectors: action.frameSelectors?.map((selector, index) => text(selector, `frameSelectors/${index}`) ?? ''),
    fillSemantics: action.fillSemantics === undefined ? undefined : {
      richText: action.fillSemantics.richText,
      cursorAtEnd: action.fillSemantics.cursorAtEnd,
      incremental: action.fillSemantics.incremental,
      preserveUndoStack: action.fillSemantics.preserveUndoStack,
    },
    redactedFields: [...codes].sort(),
  }
}

export function redactToolSetToTrace(toolSet: ToolSet): TraceDocumentV1 {
  assertSafeTraceId(toolSet.id)
  const collector: RedactionCollector = { events: new Map() }
  const rawTrees = normalizeTraceTrees(toolSet)
  const sourceLabels = new Map(toolSet.operationTrees.map((tree, index) => [tree.id, { label: tree.label, index }]))
  const trees = rawTrees.map(tree => {
    const source = sourceLabels.get(tree.id)
    return {
      id: tree.id,
      rootNodeId: tree.rootNodeId,
      label: scrubText(tree.label, source === undefined ? `/operationNodes/${tree.rootNodeId}/label` : `/operationTrees/${source.index}/label`, collector),
    }
  })
  const nodes: TraceNodeV1[] = toolSet.operationNodes.map((node, index) => {
    const path = `/operationNodes/${index}`
    return {
      id: node.id,
      parentId: node.parentId,
      timestamp: node.timestamp,
      metadata: redactMetadata(node.metadata, `${path}/metadata`, collector),
      action: redactAction(node.action, `${path}/action`, collector),
    }
  })
  if (toolSet.metadata.llmSettings !== undefined) addRedaction(collector, '/metadata/llmSettings', 'llm-settings')
  const name = scrubText(toolSet.name, '/name', collector) ?? ''
  const description = scrubText(toolSet.description, '/description', collector) ?? ''
  const targetUrl = scrubUrl(toolSet.targetUrl, '/targetUrl', collector)
  const events = [...collector.events.values()].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    traceId: toolSet.id,
    name,
    description,
    createdAt: new Date(toolSet.createdAt).toISOString(),
    updatedAt: new Date(toolSet.updatedAt).toISOString(),
    targetUrl,
    trees,
    nodes,
    redactions: events,
  }
}

export { TracePackageError } from './traceGraph.ts'
