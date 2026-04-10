import type { ContentExtractMode } from './contentExtract'
import type { FillSemantics } from './action'

export type ToolArgType = 'string' | 'number' | 'boolean' | 'enum'

export interface ToolArg {
  name: string
  type: ToolArgType
  description: string
  required: boolean
  defaultValue?: unknown
  enumOptions?: string[]
  source: 'explicit' | 'implicit'
  nodeId?: string
}

export type ToolStepAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'upload'
  | 'press'
  | 'wait'
  | 'wait_for_url'
  | 'wait_for_selector'
  | 'wait_for_timeout'
  | 'wait_for_navigation'
  | 'extract_selected_content'

export interface ToolStep {
  action: ToolStepAction
  selector?: string
  innerText?: string
  url?: string
  value?: string
  value_var?: string
  filePath?: string
  filePath_var?: string
  key?: string
  comment?: string
  waitPattern?: string
  waitTimeout?: number
  waitState?: 'visible' | 'hidden' | 'attached' | 'detached'
  extractMode?: ContentExtractMode
  extractedSelector?: string
  extractedText?: string
  elementIndex?: number
  parentSelector?: string
  /** 与 RecordedAction.selectorMatchIndex 一致，导出 Playwright 时代 `.nth()` 用 */
  selectorMatchIndex?: number
  useIndexVar?: boolean
  index_var?: string
  isLoopBody?: boolean
  loopCountVar?: string
  // loop_target 支持
  isLoopTarget?: boolean
  loopTargetSelector?: string       // LoopTargetPattern.fullSelector
  clickTargetWithinItem?: string    // 列表项内部的点击目标
  // iframe 内操作：主文档中定位 iframe 的 CSS 选择器
  frameSelector?: string
  frameSelectors?: string[]
  fillSemantics?: FillSemantics
}

export interface ToolDefinition {
  id: string
  name: string
  description: string
  args: ToolArg[]
  stepNodeIds: string[]
  nodeIds?: string[]
  steps: ToolStep[]
  dependencies: string[]
  metadata: {
    createdAt: number
    updatedAt: number
    testedAt?: number
    testResult?: 'success' | 'failed' | 'untested'
  }
}
