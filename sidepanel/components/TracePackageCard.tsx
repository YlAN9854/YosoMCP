import type { OperationTreeInfo } from '@/types/operationTree'
import type { ToolSet } from '@/types/toolset'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import { useBranchStore } from '@/sidepanel/stores/branchStore'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useToolsetStore } from '@/sidepanel/stores/toolsetStore'
import { useTracePackageStore } from '@/sidepanel/stores/tracePackageStore'
import { downloadAsZip } from '@/sidepanel/utils/export'

function currentTrees(toolSet: ToolSet, nodes: ToolSet['operationNodes']): OperationTreeInfo[] {
  const existingByRoot = new Map(toolSet.operationTrees.map(tree => [tree.rootNodeId, tree]))
  return nodes
    .filter(node => node.parentId === null)
    .map(node => existingByRoot.get(node.id) ?? {
      id: `tree-${node.id}`,
      rootNodeId: node.id,
      label: node.action.url ?? node.action.type,
    })
}

export default function TracePackageCard() {
  const { t } = useI18n()
  const nodes = useRecorderStore(state => state.nodes)
  const targetUrl = useRecorderStore(state => state.targetUrl)
  const branches = useBranchStore(state => state.branches)
  const currentToolSet = useToolsetStore(state => {
    const id = state.currentToolSetId
    return id ? state.toolSets.find(toolSet => toolSet.id === id) ?? null : null
  })
  const isExporting = useTracePackageStore(state => state.isExporting)
  const error = useTracePackageStore(state => state.error)
  const lastSummary = useTracePackageStore(state => state.lastSummary)
  const exportTracePackage = useTracePackageStore(state => state.exportTracePackage)
  const canExport = currentToolSet !== null && nodes.length > 0 && !isExporting

  const handleExport = async () => {
    if (!currentToolSet || nodes.length === 0) return
    const snapshot: ToolSet = {
      ...currentToolSet,
      operationTrees: currentTrees(currentToolSet, nodes),
      operationNodes: nodes,
      branches,
      targetUrl: targetUrl ?? currentToolSet.targetUrl,
      updatedAt: Date.now(),
    }
    const output = await exportTracePackage(snapshot)
    if (output) downloadAsZip(output.files, output.filename)
  }

  return (
    <section className="shrink-0 border-b border-violet-100 bg-white px-3 py-2">
      <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-violet-800">YOSO Trace Package</span>
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
            {t('trace.badge')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!canExport}
          aria-describedby="trace-package-status"
          className={`min-h-11 w-full rounded px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 ${
            canExport
              ? 'bg-violet-600 text-white hover:bg-violet-700'
              : 'cursor-not-allowed bg-gray-100 text-gray-400'
          }`}
        >
          {isExporting ? t('trace.exporting') : t('trace.download')}
        </button>
        <div className="break-keep text-xs leading-relaxed text-violet-700">{t('trace.hint')}</div>
        <div
          id="trace-package-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`min-h-4 break-words text-xs leading-relaxed ${error ? 'text-red-600' : 'text-violet-600'}`}
        >
          {error
            ? t('trace.error', { msg: error })
            : isExporting
              ? t('trace.exporting')
              : lastSummary
                ? t('trace.summary', {
                    nodes: lastSummary.nodeCount,
                    redactions: lastSummary.redactionCount,
                  })
                : ''}
        </div>
      </div>
    </section>
  )
}
