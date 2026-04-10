import { create } from 'zustand'
import type { Branch, BranchReplayStatus, ToolRegistration } from '@/types/branch'
import type { OperationNode } from '@/types/operationTree'
import { sendToBackground } from '@/utils/messaging'
import { MSG } from '@/types/message'
import type { LLMSettings, SessionExportStrategy, SkillSessionExportResult } from '@/types/message'
import type { SkillOutput } from '@/background/generator/skillGen'
import type { McpOutput } from '@/background/generator/mcpGen'
import { useToolsetStore } from './toolsetStore'

export type BranchRegistrationStatus = 'idle' | 'registering' | 'done' | 'error'
export type BranchCodeGenStatus = 'idle' | 'generating' | 'done' | 'error'

interface BranchMeta {
  registrationStatus: BranchRegistrationStatus
  codeGenStatus: BranchCodeGenStatus
  error?: string
}

interface ReplayValidationResult {
  replayStatus: BranchReplayStatus
  failReason: string
}

interface ExtractBranchOptions {
  markAsHistoricalTextOnly?: boolean
}

interface BranchState {
  branches: Branch[]
  branchMeta: Record<string, BranchMeta>
  currentBranchId: string | null
  skillContent: SkillOutput | null
  mcpContent: McpOutput | null
  isExtracting: boolean
  isGeneratingSkill: boolean
  isGeneratingMcp: boolean
  isExportingSession: boolean
  autoExtractKey: string | null

  setAutoExtractKey: (key: string | null) => void
  setBranches: (branches: Branch[]) => void
  extractBranches: (nodes: OperationNode[], options?: ExtractBranchOptions) => Promise<void>
  registerTool: (branchId: string, llmSettings?: LLMSettings) => Promise<void>
  generateBranchCode: (branchId: string) => Promise<void>
  generateSkill: (toolSetName: string, llmSettings?: LLMSettings, hint?: string) => Promise<void>
  generateMcpServer: (toolSetName: string, llmSettings?: LLMSettings) => Promise<void>
  exportSkillSession: (toolSetName: string, strategy?: SessionExportStrategy) => Promise<SkillSessionExportResult>
  setCurrentBranchId: (id: string | null) => void
  updateBranchRegistration: (branchId: string, reg: ToolRegistration) => void
  updateBranchHint: (branchId: string, hint: string) => void
  updateBranchParamDefaultValue: (branchId: string, nodeId: string, value: string) => void
  confirmBranchParamDefaultValue: (branchId: string, nodeId: string) => void
  confirmAllBranchParamDefaults: (branchId: string) => void
  downgradeBranchToTextOnly: (branchId: string) => void
  reset: () => void
}

const defaultMeta: BranchMeta = { registrationStatus: 'idle', codeGenStatus: 'idle' }

function isParamDefaultValid(param: Branch['params'][number]): boolean {
  if (param.type === 'number') {
    if (param.defaultValue === undefined || param.defaultValue === null) return false
    const num = typeof param.defaultValue === 'number' ? param.defaultValue : Number(param.defaultValue)
    return Number.isFinite(num) && num > 0
  }
  if (param.type === 'enum') {
    if (typeof param.defaultValue !== 'string' || !param.defaultValue.trim()) return false
    if (!param.enumOptions || param.enumOptions.length === 0) return false
    return param.enumOptions.includes(param.defaultValue)
  }
  return typeof param.defaultValue === 'string' && !!param.defaultValue.trim()
}

function areBranchParamDefaultsConfirmed(branch: Branch): boolean {
  return branch.params.every(param => isParamDefaultValid(param) && !!param.defaultValueConfirmed)
}

const syncBranchesToToolset = (branches: Branch[]) => {
  useToolsetStore.getState().updateCurrentToolSet({ branches })
}

export const useBranchStore = create<BranchState>((set, get) => ({
  branches: [],
  branchMeta: {},
  currentBranchId: null,
  skillContent: null,
  mcpContent: null,
  isExtracting: false,
  isGeneratingSkill: false,
  isGeneratingMcp: false,
  isExportingSession: false,
  autoExtractKey: null,

  setAutoExtractKey: (key) => set({ autoExtractKey: key }),
  
  setBranches: (branches) => {
    const meta: Record<string, BranchMeta> = {}
    for (const b of branches) {
      meta[b.id] = {
        registrationStatus: b.registration ? 'done' : 'idle',
        codeGenStatus: b.generatedCode ? 'done' : 'idle',
      }
    }
    set({ branches, branchMeta: meta, currentBranchId: null, skillContent: null, mcpContent: null })
  },

  extractBranches: async (nodes, options) => {
    set({ isExtracting: true })
    try {
      const branches = await sendToBackground<Branch[]>(MSG.EXTRACT_BRANCHES, { nodes })
      const historicalReason = '历史操作树默认 text-only，建议重新录制后执行回溯验证'
      const enrichedBranches = await Promise.all(
        branches.map(async (branch) => {
          if (options?.markAsHistoricalTextOnly) {
            return {
              ...branch,
              replayStatus: 'text-only' as const,
              failReason: historicalReason,
            }
          }
          if (!branch.isReady) {
            return {
              ...branch,
              replayStatus: 'text-only' as const,
              failReason: `存在 ${branch.unconfirmedNodeIds.length} 个待确认节点，暂不可验证`,
            }
          }
          try {
            const validation = await sendToBackground<ReplayValidationResult>(MSG.VALIDATE_BRANCH_REPLAY, { branch })
            return {
              ...branch,
              replayStatus: validation.replayStatus,
              failReason: validation.failReason,
            }
          } catch (err) {
            return {
              ...branch,
              replayStatus: 'text-only' as const,
              failReason: `回溯验证服务异常: ${(err as Error).message}`,
            }
          }
        })
      )
      const meta: Record<string, BranchMeta> = {}
      for (const b of enrichedBranches) meta[b.id] = { ...defaultMeta }
      set({ branches: enrichedBranches, branchMeta: meta, skillContent: null, mcpContent: null })
      syncBranchesToToolset(enrichedBranches)
    } finally {
      set({ isExtracting: false })
    }
  },

  registerTool: async (branchId, llmSettings) => {
    const { branches, branchMeta } = get()
    const branch = branches.find(b => b.id === branchId)
    if (!branch) return
    if (branch.replayStatus !== 'code-ready') {
      set({
        branchMeta: {
          ...branchMeta,
          [branchId]: { ...branchMeta[branchId], registrationStatus: 'error', error: branch.failReason || '当前分支为 text-only，无法注册可执行工具' },
        },
      })
      return
    }
    if (!areBranchParamDefaultsConfirmed(branch)) {
      set({
        branchMeta: {
          ...branchMeta,
          [branchId]: { ...branchMeta[branchId], registrationStatus: 'error', error: '请先确认该分支所有参数默认值' },
        },
      })
      return
    }

    set({ branchMeta: { ...branchMeta, [branchId]: { ...branchMeta[branchId], registrationStatus: 'registering', error: undefined } } })
    try {
      const reg = await sendToBackground<ToolRegistration>(MSG.REGISTER_TOOL, { branch, llmSettings, hint: branch.hint })
      const updated = branches.map(b =>
        b.id === branchId ? { ...b, registration: reg } : b
      )
      set({
        branches: updated,
        branchMeta: { ...get().branchMeta, [branchId]: { ...get().branchMeta[branchId], registrationStatus: 'done' } },
      })
      syncBranchesToToolset(updated)
    } catch (err) {
      set({
        branchMeta: { ...get().branchMeta, [branchId]: { ...get().branchMeta[branchId], registrationStatus: 'error', error: (err as Error).message } },
      })
    }
  },

  generateBranchCode: async (branchId) => {
    const { branches, branchMeta } = get()
    const branch = branches.find(b => b.id === branchId)
    if (!branch) return
    if (branch.replayStatus !== 'code-ready') {
      set({
        branchMeta: {
          ...branchMeta,
          [branchId]: { ...branchMeta[branchId], codeGenStatus: 'error', error: branch.failReason || '当前分支为 text-only，不能生成可执行代码' },
        },
      })
      return
    }
    if (!areBranchParamDefaultsConfirmed(branch)) {
      set({
        branchMeta: {
          ...branchMeta,
          [branchId]: { ...branchMeta[branchId], codeGenStatus: 'error', error: '请先确认该分支所有参数默认值' },
        },
      })
      return
    }

    set({ branchMeta: { ...branchMeta, [branchId]: { ...branchMeta[branchId], codeGenStatus: 'generating', error: undefined } } })
    try {
      const code = await sendToBackground<string>(MSG.GENERATE_BRANCH_CODE, { branch })
      const updated = branches.map(b =>
        b.id === branchId ? { ...b, generatedCode: code } : b
      )
      set({
        branches: updated,
        branchMeta: { ...get().branchMeta, [branchId]: { ...get().branchMeta[branchId], codeGenStatus: 'done' } },
      })
      syncBranchesToToolset(updated)
    } catch (err) {
      set({
        branchMeta: { ...get().branchMeta, [branchId]: { ...get().branchMeta[branchId], codeGenStatus: 'error', error: (err as Error).message } },
      })
    }
  },

  generateSkill: async (toolSetName, llmSettings, hint) => {
    set({ isGeneratingSkill: true })
    try {
      const { branches } = get()
      const output = await sendToBackground<SkillOutput>(MSG.GENERATE_SKILL, {
        branches,
        toolSetName,
        llmSettings,
        hint,
      })
      set({ skillContent: output })
    } finally {
      set({ isGeneratingSkill: false })
    }
  },

  generateMcpServer: async (toolSetName, llmSettings) => {
    set({ isGeneratingMcp: true })
    try {
      const { branches } = get()
      const output = await sendToBackground<McpOutput>(MSG.GENERATE_MCP_SERVER, {
        branches,
        toolSetName,
        llmSettings,
      })
      set({ mcpContent: output })
    } finally {
      set({ isGeneratingMcp: false })
    }
  },

  exportSkillSession: async (toolSetName, strategy = 'main-and-login-chain') => {
    set({ isExportingSession: true })
    try {
      const { branches } = get()
      const exported = await sendToBackground<SkillSessionExportResult>(MSG.EXPORT_SKILL_SESSION, {
        branches,
        toolSetName,
        strategy,
      })
      return exported
    } finally {
      set({ isExportingSession: false })
    }
  },

  setCurrentBranchId: (id) => set({ currentBranchId: id }),

  updateBranchRegistration: (branchId, reg) => {
    const updated = get().branches.map(b =>
      b.id === branchId ? { ...b, registration: reg } : b
    )
    set({ branches: updated })
    syncBranchesToToolset(updated)
  },

  updateBranchHint: (branchId, hint) => {
    const updated = get().branches.map(b =>
      b.id === branchId ? { ...b, hint } : b
    )
    set({ branches: updated })
    syncBranchesToToolset(updated)
  },

  updateBranchParamDefaultValue: (branchId, nodeId, value) => {
    const updated = get().branches.map(branch => {
      if (branch.id !== branchId) return branch
      return {
        ...branch,
        params: branch.params.map(param => {
          if (param.nodeId !== nodeId) return param
          if (param.type === 'number') {
            const raw = value.trim()
            const parsed = Number(raw)
            return {
              ...param,
              defaultValue: raw ? (Number.isFinite(parsed) ? parsed : undefined) : undefined,
              defaultValueConfirmed: false,
            }
          }
          return {
            ...param,
            defaultValue: value,
            defaultValueConfirmed: false,
          }
        }),
      }
    })
    set({ branches: updated })
    syncBranchesToToolset(updated)
  },

  confirmBranchParamDefaultValue: (branchId, nodeId) => {
    const updated = get().branches.map(branch => {
      if (branch.id !== branchId) return branch
      return {
        ...branch,
        params: branch.params.map(param => {
          if (param.nodeId !== nodeId) return param
          if (!isParamDefaultValid(param)) return { ...param, defaultValueConfirmed: false }
          return { ...param, defaultValueConfirmed: true }
        }),
      }
    })
    set({ branches: updated })
    syncBranchesToToolset(updated)
  },

  confirmAllBranchParamDefaults: (branchId) => {
    const updated = get().branches.map(branch => {
      if (branch.id !== branchId) return branch
      return {
        ...branch,
        params: branch.params.map(param => ({
          ...param,
          defaultValueConfirmed: isParamDefaultValid(param),
        })),
      }
    })
    set({ branches: updated })
    syncBranchesToToolset(updated)
  },

  downgradeBranchToTextOnly: (branchId) => {
    const updated = get().branches.map(b => {
      if (b.id !== branchId || b.replayStatus !== 'code-ready') return b
      return {
        ...b,
        replayStatus: 'text-only' as const,
        failReason: '人工重标记为 text-only',
        generatedCode: undefined,
      }
    })
    set({ branches: updated, skillContent: null, mcpContent: null })
    syncBranchesToToolset(updated)
  },

  reset: () => set({
    branches: [],
    branchMeta: {},
    currentBranchId: null,
    skillContent: null,
    mcpContent: null,
  }),
}))
