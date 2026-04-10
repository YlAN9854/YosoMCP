import type { LoopTargetPattern } from './operationTree'

export interface DOMPathSegment {
  tagName: string
  classList: string[]
  id?: string
  index: number
  siblingCount: number
  attributes: Record<string, string>
}

export interface PickedElementInfo {
  selector: string
  tagName: string
  classList: string[]
  attributes: Record<string, string>
  innerText?: string
  rect: { x: number; y: number; width: number; height: number }
  domPath: DOMPathSegment[]
}

export interface SelectorPatternResult {
  success: boolean
  pattern?: LoopTargetPattern
  error?: string
}
