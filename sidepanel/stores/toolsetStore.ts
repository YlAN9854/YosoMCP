import { create } from 'zustand'
import type { ToolSet } from '@/types/toolset'
import { sendToBackground } from '@/utils/messaging'
import { MSG } from '@/types/message'

interface ToolsetState {
  toolSets: ToolSet[]
  currentToolSetId: string | null
  selectedNodeId: string | null

  setToolSets: (toolSets: ToolSet[]) => void
  setCurrentToolSetId: (id: string | null) => void
  setSelectedNodeId: (id: string | null) => void
  updateCurrentToolSet: (updates: Partial<ToolSet>) => void
}

export const useToolsetStore = create<ToolsetState>((set, get) => ({
  toolSets: [],
  currentToolSetId: null,
  selectedNodeId: null,

  setToolSets: (toolSets) => set({ toolSets }),
  setCurrentToolSetId: (id) => set({ currentToolSetId: id }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  updateCurrentToolSet: (updates) => {
    const { toolSets, currentToolSetId } = get()
    if (!currentToolSetId) return
    
    const current = toolSets.find(ts => ts.id === currentToolSetId)
    if (!current) return

    const nextTs = { ...current, ...updates, updatedAt: Date.now() }
    
    set({
      toolSets: toolSets.map(ts =>
        ts.id === currentToolSetId ? nextTs : ts
      ),
    })

    sendToBackground(MSG.TOOLSET_SAVE, nextTs).catch(console.error)
  },
}))
