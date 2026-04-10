import type { ContentExtractMode } from './contentExtract'

export type ActionType =
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'select'
  | 'check'
  | 'upload'
  | 'keydown'
  | 'navigate'
  | 'scroll'
  | 'hover'
  | 'wait_for_url'
  | 'wait_for_selector'
  | 'wait_for_timeout'
  | 'wait_for_navigation'
  | 'extract_selected_content'

export interface BranchCandidate {
  selector: string
  tagName?: string
  innerText?: string
  attributes?: Record<string, string>
  elementIndex?: number
  parentSelector?: string
}

export interface FillSemantics {
  richText?: boolean
  cursorAtEnd?: boolean
  incremental?: boolean
  preserveUndoStack?: boolean
}

export interface RecordedAction {
  // ========== 核心字段 ==========
  id: string
  type: ActionType
  selector: string
  value?: string
  url?: string
  key?: string
  filePath?: string
  filePathArgName?: string
  timestamp: number
  branchCandidates?: BranchCandidate[]

  // ========== 分析相关 ==========
  innerText?: string
  comment?: string
  elementIndex?: number
  parentSelector?: string
  /**
   * 当 `selector` 在页面上匹配多个元素时，录制时点击目标在 `querySelectorAll` 结果中的下标（0-based）。
   * 用于同名文案（如多组筛选里的「不限」）回放时点到正确那一项。
   */
  selectorMatchIndex?: number

  // ========== 等待操作参数 ==========
  waitTimeout?: number
  waitPattern?: string
  waitState?: 'visible' | 'hidden' | 'attached' | 'detached'

  // ========== 内容提取 ==========
  extractMode?: ContentExtractMode
  extractedText?: string
  extractedSelector?: string
  extractedScreenshot?: string  // base64 data URL，截图模式下录制时捕获的元素快照

  // ========== UI 显示 ==========
  tagName?: string
  attributes?: Record<string, string>
  inputType?: string
  checked?: boolean
  scrollPosition?: { x: number; y: number }
  selectedText?: string

  // ========== iframe 内操作 ==========
  /** 录制时所在 frame（来自 sender.frameId），同会话回放用 */
  frameId?: number
  /** 该 frame 的文档 URL（重载后按 URL 解析 frameId） */
  frameUrl?: string
  /** 主文档中定位该 iframe 的 CSS 选择器，供 Playwright frameLocator 使用 */
  frameSelector?: string
  /** 从顶层到当前 frame 的选择器路径，支持嵌套 iframe */
  frameSelectors?: string[]

  // ========== fill 语义 ==========
  fillSemantics?: FillSemantics
}
