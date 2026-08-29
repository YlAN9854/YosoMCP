import { create } from 'zustand'
import type { ToolSet } from '@/types/toolset'
import type { TracePackageOutput } from '@/types/tracePackage'
import { MSG } from '@/types/message'
import { sendToBackground } from '@/utils/messaging'

interface TracePackageState {
  isExporting: boolean
  error: string | null
  lastSummary: TracePackageOutput['summary'] | null
  exportTracePackage: (toolSet: ToolSet) => Promise<TracePackageOutput | null>
}

export const useTracePackageStore = create<TracePackageState>((set, get) => ({
  isExporting: false,
  error: null,
  lastSummary: null,

  exportTracePackage: async (toolSet) => {
    if (get().isExporting) return null

    set({ isExporting: true, error: null, lastSummary: null })
    try {
      const output = await sendToBackground<TracePackageOutput>(
        MSG.GENERATE_TRACE_PACKAGE,
        { toolSet },
      )
      set({ lastSummary: output.summary })
      return output
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message, lastSummary: null })
      return null
    } finally {
      set({ isExporting: false })
    }
  },
}))
