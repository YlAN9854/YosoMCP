import type { ToolSet } from '../../types/toolset.ts'
import {
  TRACE_CLIPBOARD_FORMAT,
  TRACE_CLIPBOARD_FORMAT_VERSION,
  TRACE_CLIPBOARD_INSTRUCTION,
  TRACE_CLIPBOARD_SENTINEL,
  TRACE_PACKAGE_FORMAT,
  TRACE_PACKAGE_FORMAT_VERSION,
  TRACE_REDACTION_POLICY_VERSION,
  TRACE_SCHEMA_VERSION,
  type TracePackageGenerationContext,
  type TraceClipboardEnvelopeV1,
  type TracePackageManifestV1,
  type TracePackageOutput,
  type TraceRedactionCode,
} from '../../types/tracePackage.ts'
import { assertSafeTraceId, TracePackageError } from './traceGraph.ts'
import { redactToolSetToTrace } from './traceRedactor.ts'

function safeFilename(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\-_.]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 96)
  return normalized === '' ? 'yoso-trace.yoso' : `${normalized}.yoso`
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function generateTracePackage(
  toolSet: ToolSet,
  context: TracePackageGenerationContext,
): TracePackageOutput {
  if (toolSet.operationNodes.length === 0) throw new TracePackageError('TRACE_PACKAGE_EMPTY')
  assertSafeTraceId(context.packageId)
  const trace = redactToolSetToTrace(toolSet)
  const byCode: Partial<Record<TraceRedactionCode, number>> = {}
  for (const event of trace.redactions) byCode[event.code] = (byCode[event.code] ?? 0) + 1
  const manifest: TracePackageManifestV1 = {
    format: TRACE_PACKAGE_FORMAT,
    formatVersion: TRACE_PACKAGE_FORMAT_VERSION,
    traceSchemaVersion: TRACE_SCHEMA_VERSION,
    packageId: context.packageId,
    createdAt: context.createdAt,
    producer: { name: 'YOSO', version: context.producerVersion },
    traceFile: 'trace.json',
    summary: { treeCount: trace.trees.length, nodeCount: trace.nodes.length },
    redaction: {
      policyVersion: TRACE_REDACTION_POLICY_VERSION,
      mode: 'safe-default',
      total: trace.redactions.length,
      byCode,
    },
  }
  const clipboardEnvelope: TraceClipboardEnvelopeV1 = {
    format: TRACE_CLIPBOARD_FORMAT,
    formatVersion: TRACE_CLIPBOARD_FORMAT_VERSION,
    manifest,
    trace,
  }
  return {
    filename: safeFilename(toolSet.name),
    files: [
      { filename: 'manifest.json', content: serialize(manifest) },
      { filename: 'trace.json', content: serialize(trace) },
    ],
    clipboardText: `${TRACE_CLIPBOARD_INSTRUCTION}\n${TRACE_CLIPBOARD_SENTINEL}\n${JSON.stringify(clipboardEnvelope)}\n`,
    summary: {
      treeCount: trace.trees.length,
      nodeCount: trace.nodes.length,
      redactionCount: trace.redactions.length,
    },
  }
}

export { TracePackageError }
