import { create } from 'zustand'
import { sendToBackground } from '@/utils/messaging'
import { MSG } from '@/types/message'
import type { ReplayStepResult, ReplayCompleteResult } from '@/types/operationTree'

export type ReplayStatus = 'idle' | 'replaying' | 'completed' | 'failed' | 'aborted'
export type ReplayStartResult = 'started' | 'rejected'

interface ReplayState {
  status: ReplayStatus
  currentStep: number
  totalSteps: number
  stepResults: ReplayStepResult[]
  replayingNodeId: string | null

  startReplay: (
    leafNodeId: string,
    nodes: import('@/types/operationTree').OperationNode[]
  ) => Promise<ReplayStartResult>
  abortReplay: () => Promise<void>
  handleStepResult: (result: ReplayStepResult) => void
  handleComplete: (result: ReplayCompleteResult) => void
  handleAborted: () => void
  reset: () => void
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  status: 'idle',
  currentStep: 0,
  totalSteps: 0,
  stepResults: [],
  replayingNodeId: null,

  startReplay: async (leafNodeId, nodes) => {
    set({
      status: 'replaying',
      currentStep: 0,
      totalSteps: 0,
      stepResults: [],
      replayingNodeId: leafNodeId,
    })

    try {
      await sendToBackground(MSG.REPLAY_START, { leafNodeId, nodes })
      return 'started'
    } catch {
      set({
        status: 'failed',
        replayingNodeId: null,
      })
      return 'rejected'
    }
  },

  abortReplay: async () => {
    try {
      await sendToBackground(MSG.REPLAY_ABORT)
    } catch {
      set({
        status: 'aborted',
        replayingNodeId: null,
      })
    }
  },

  handleStepResult: (result) => {
    set(state => ({
      currentStep: result.stepIndex + 1,
      totalSteps: result.totalSteps,
      stepResults: [...state.stepResults, result],
    }))
  },

  handleComplete: (result) => {
    set({
      status: result.success ? 'completed' : 'failed',
      currentStep: result.completedSteps,
      totalSteps: result.totalSteps,
    })
  },

  handleAborted: () => {
    set({ status: 'aborted' })
  },

  reset: () => {
    set({
      status: 'idle',
      currentStep: 0,
      totalSteps: 0,
      stepResults: [],
      replayingNodeId: null,
    })
  },
}))
