import { useState } from 'react'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useToolsetStore } from '@/sidepanel/stores/toolsetStore'
import { useTracePackageStore } from '@/sidepanel/stores/tracePackageStore'
import { copyToClipboard, downloadAsZip } from '@/sidepanel/utils/export'
import { buildToolSetSnapshot } from '@/sidepanel/utils/toolsetSnapshot'

type ExportAction = 'copy' | 'download'

export default function TracePackageCard() {
  const { t } = useI18n()
  const [activeAction, setActiveAction] = useState<ExportAction | null>(null)
  const [lastAction, setLastAction] = useState<ExportAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const nodes = useRecorderStore(state => state.nodes)
  const targetUrl = useRecorderStore(state => state.targetUrl)
  const currentToolSet = useToolsetStore(state => {
    const id = state.currentToolSetId
    return id ? state.toolSets.find(toolSet => toolSet.id === id) ?? null : null
  })
  const isExporting = useTracePackageStore(state => state.isExporting)
  const error = useTracePackageStore(state => state.error)
  const lastSummary = useTracePackageStore(state => state.lastSummary)
  const exportTracePackage = useTracePackageStore(state => state.exportTracePackage)
  const canExport = currentToolSet !== null
    && nodes.length > 0
    && !isExporting
    && activeAction === null

  const generateOutput = () => {
    if (!currentToolSet || nodes.length === 0) return Promise.resolve(null)
    const snapshot = buildToolSetSnapshot(currentToolSet, nodes, targetUrl)
    return exportTracePackage(snapshot)
  }

  const handleCopy = async () => {
    setActiveAction('copy')
    setActionError(null)
    setLastAction(null)
    try {
      const output = await generateOutput()
      if (!output) return
      await copyToClipboard(output.clipboardText)
      setLastAction('copy')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveAction(null)
    }
  }

  const handleDownload = async () => {
    setActiveAction('download')
    setActionError(null)
    setLastAction(null)
    try {
      const output = await generateOutput()
      if (!output) return
      downloadAsZip(output.files, output.filename)
      setLastAction('download')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActiveAction(null)
    }
  }

  const visibleError = actionError ?? error
  let statusMessage = ''
  if (visibleError) {
    statusMessage = t('trace.error', { msg: visibleError })
  } else if (activeAction === 'copy') {
    statusMessage = t('trace.copying')
  } else if (activeAction === 'download') {
    statusMessage = t('trace.downloading')
  } else if (lastAction === 'copy') {
    statusMessage = t('trace.copied')
  } else if (lastSummary) {
    statusMessage = t(lastAction === 'download' ? 'trace.downloaded' : 'trace.summary', {
      nodes: lastSummary.nodeCount,
      redactions: lastSummary.redactionCount,
    })
  }

  return (
    <section className="shrink-0 border-t border-violet-100 bg-white px-3 py-2">
      <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-violet-800">YOSO Trace Package</span>
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
            {t('trace.badge')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!canExport}
          aria-describedby="trace-package-status"
          className={`min-h-11 w-full rounded px-2 py-2 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 ${
            canExport
              ? 'bg-violet-600 text-white hover:bg-violet-700'
              : 'cursor-not-allowed bg-gray-100 text-gray-400'
          }`}
        >
          {activeAction === 'copy'
            ? t('trace.copying')
            : lastAction === 'copy'
              ? t('trace.copiedButton')
              : t('trace.copy')}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!canExport}
          aria-describedby="trace-package-status"
          className={`min-h-10 w-full rounded border px-2 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 ${
            canExport
              ? 'border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-100/70'
              : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
          }`}
        >
          {activeAction === 'download' ? t('trace.downloading') : t('trace.download')}
        </button>
        <div className="break-keep text-xs leading-relaxed text-violet-700">{t('trace.hint')}</div>
        <div
          id="trace-package-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`min-h-4 break-words text-xs leading-relaxed ${
            visibleError
              ? 'text-red-600'
              : lastAction
                ? 'text-green-700'
                : 'text-violet-600'
          }`}
        >
          {statusMessage}
        </div>
      </div>
    </section>
  )
}
