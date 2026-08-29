import type { ToolSet } from '../../types/toolset.ts'
import type { TraceTreeV1 } from '../../types/tracePackage.ts'

export type TracePackageErrorCode =
  | 'TRACE_PACKAGE_EMPTY'
  | 'TRACE_PACKAGE_INVALID_ID'
  | 'TRACE_PACKAGE_INVALID_TREE'

export class TracePackageError extends Error {
  readonly code: TracePackageErrorCode

  constructor(code: TracePackageErrorCode) {
    super(code)
    this.name = 'TracePackageError'
    this.code = code
  }
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

export function assertSafeTraceId(value: string): void {
  if (!SAFE_ID_PATTERN.test(value) || value === '.' || value === '..') {
    throw new TracePackageError('TRACE_PACKAGE_INVALID_ID')
  }
}

export function normalizeTraceTrees(toolSet: ToolSet): TraceTreeV1[] {
  const nodes = new Map<string, string | null>()
  for (const node of toolSet.operationNodes) {
    assertSafeTraceId(node.id)
    assertSafeTraceId(node.action.id)
    if (node.parentId !== null) assertSafeTraceId(node.parentId)
    if (nodes.has(node.id)) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
    nodes.set(node.id, node.parentId)
  }
  for (const parentId of nodes.values()) {
    if (parentId !== null && !nodes.has(parentId)) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
  }

  const sourceByRoot = new Map<string, ToolSet['operationTrees'][number]>()
  const sourceIds = new Set<string>()
  for (const tree of toolSet.operationTrees) {
    assertSafeTraceId(tree.id)
    assertSafeTraceId(tree.rootNodeId)
    if (sourceIds.has(tree.id) || sourceByRoot.has(tree.rootNodeId)) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
    if (!nodes.has(tree.rootNodeId) || nodes.get(tree.rootNodeId) !== null) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
    sourceIds.add(tree.id)
    sourceByRoot.set(tree.rootNodeId, tree)
  }

  const roots = [...nodes].filter(([, parentId]) => parentId === null).map(([id]) => id)
  const trees = roots.map(rootNodeId => {
    const source = sourceByRoot.get(rootNodeId)
    const id = source?.id ?? rootNodeId
    assertSafeTraceId(id)
    return { id, rootNodeId, label: source?.label }
  })
  if (new Set(trees.map(tree => tree.id)).size !== trees.length) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')

  const visits = new Map([...nodes.keys()].map(id => [id, 0]))
  const children = new Map([...nodes.keys()].map(id => [id, [] as string[]]))
  for (const [id, parentId] of nodes) if (parentId !== null) children.get(parentId)?.push(id)
  const visit = (id: string, active: Set<string>): void => {
    if (active.has(id)) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
    active.add(id)
    visits.set(id, (visits.get(id) ?? 0) + 1)
    for (const childId of children.get(id) ?? []) visit(childId, active)
    active.delete(id)
  }
  for (const tree of trees) visit(tree.rootNodeId, new Set())
  if ([...visits.values()].some(count => count !== 1)) throw new TracePackageError('TRACE_PACKAGE_INVALID_TREE')
  return trees
}
