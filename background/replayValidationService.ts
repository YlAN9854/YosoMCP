import type { Branch, BranchReplayStatus } from '@/types/branch'

export interface ReplayValidationResult {
  replayStatus: BranchReplayStatus
  failReason: string
}

const NEED_SELECTOR_ACTIONS = new Set([
  'click',
  'dblclick',
  'fill',
  'select',
  'check',
  'keydown',
  'hover',
  'extract_selected_content',
  'wait_for_selector',
])

export function validateBranchReplay(branch: Branch): ReplayValidationResult {
  if (!branch.isReady) {
    return {
      replayStatus: 'text-only',
      failReason: `存在 ${branch.unconfirmedNodeIds.length} 个待确认节点，无法执行回溯验证`,
    }
  }

  if (branch.path.length === 0) {
    return {
      replayStatus: 'text-only',
      failReason: '分支路径为空，无法执行回溯验证',
    }
  }

  for (const node of branch.path) {
    const action = node.action
    if (NEED_SELECTOR_ACTIONS.has(action.type) && !action.selector) {
      return {
        replayStatus: 'text-only',
        failReason: `${action.type} 步骤缺少 selector，关键步骤不可重放`,
      }
    }
    if (action.type === 'navigate' && !action.url) {
      return {
        replayStatus: 'text-only',
        failReason: 'navigate 步骤缺少 URL，回溯无法起播',
      }
    }
  }

  return {
    replayStatus: 'code-ready',
    failReason: '',
  }
}
