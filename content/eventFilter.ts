// 事件过滤管道 — 过滤无效事件、去重、合并填充

import type { RecordedAction, ActionType } from '@/types/action'
import { v4 as uuidv4 } from 'uuid'

interface RawDOMEvent {
  type: 'click' | 'dblclick' | 'input' | 'change' | 'keydown' | 'scroll'
  target: Element
  selector: string
  selectorMatchIndex?: number
  value?: string
  key?: string
  innerText?: string
  tagName?: string
  branchCandidates?: RecordedAction['branchCandidates']
  elementIndex?: number
  parentSelector?: string
  inputType?: string
  checked?: boolean
  attributes?: Record<string, string>
  scrollPosition?: { x: number; y: number }
  fillSemantics?: RecordedAction['fillSemantics']
}

export class EventFilterPipeline {
  private pendingFill: {
    element: Element
    selector: string
    timer: ReturnType<typeof setTimeout>
    value: string
    rawEvent: RawDOMEvent
  } | null = null

  private lastAction: {
    type: string
    selector: string
    target: Element
    timestamp: number
  } | null = null

  private onAction: (action: RecordedAction) => void

  constructor(onAction: (action: RecordedAction) => void) {
    this.onAction = onAction
  }

  filter(rawEvent: RawDOMEvent): void {
    // 阶段 1: 排除扩展自身元素
    if (this.isExtensionElement(rawEvent.target)) return

    // 阶段 2: 100ms 重复检测
    if (this.isDuplicate(rawEvent)) return

    // 阶段 3: Fill 智能合并（3000ms 缓冲）
    if (rawEvent.type === 'input') {
      this.handleFillDebounce(rawEvent)
      return
    }

    // 阶段 4: 无意义操作过滤
    if (this.isMeaningless(rawEvent)) return

    const action = this.buildAction(rawEvent)
    if (!action) return

    // 仅在当前事件会生成 action 时，才先发送 pending fill
    this.flushPendingFill()

    this.lastAction = {
      type: action.type,
      selector: action.selector,
      target: rawEvent.target,
      timestamp: action.timestamp,
    }
    this.onAction(action)
  }

  flushPendingFill(): void {
    if (this.pendingFill) {
      clearTimeout(this.pendingFill.timer)
      const action = this.buildAction({
        ...this.pendingFill.rawEvent,
        value: this.pendingFill.value,
      })
      if (action) {
        this.onAction(action)
      }
      this.pendingFill = null
    }
  }

  destroy(): void {
    if (this.pendingFill) {
      clearTimeout(this.pendingFill.timer)
      this.pendingFill = null
    }
  }

  private isExtensionElement(target: Element): boolean {
    return !!target.closest('#yoso-recording-indicator')
  }

  private isDuplicate(rawEvent: RawDOMEvent): boolean {
    if (!this.lastAction) return false
    const now = Date.now()
    return (
      this.lastAction.type === this.mapEventType(rawEvent.type) &&
      this.lastAction.target === rawEvent.target &&
      now - this.lastAction.timestamp < 100
    )
  }

  private handleFillDebounce(rawEvent: RawDOMEvent): void {
    if (this.pendingFill && this.pendingFill.element === rawEvent.target) {
      // 更新值，重置定时器
      clearTimeout(this.pendingFill.timer)
      this.pendingFill.selector = rawEvent.selector
      this.pendingFill.value = rawEvent.value || ''
      this.pendingFill.rawEvent = rawEvent
      this.pendingFill.timer = setTimeout(() => {
        this.flushPendingFill()
      }, 3000)
    } else {
      // 先 flush 之前的
      this.flushPendingFill()
      // 创建新的 pending
      this.pendingFill = {
        element: rawEvent.target,
        selector: rawEvent.selector,
        value: rawEvent.value || '',
        rawEvent,
        timer: setTimeout(() => {
          this.flushPendingFill()
        }, 3000),
      }
    }
  }

  private isMeaningless(rawEvent: RawDOMEvent): boolean {
    const tag = rawEvent.target.tagName.toLowerCase()
    // body/html 上的直接点击
    if (rawEvent.type === 'click' && (tag === 'body' || tag === 'html')) {
      return true
    }
    return false
  }

  private mapEventType(eventType: string): ActionType {
    switch (eventType) {
      case 'click': return 'click'
      case 'dblclick': return 'dblclick'
      case 'input': return 'fill'
      case 'change': return 'select'
      case 'keydown': return 'keydown'
      case 'scroll': return 'scroll'
      default: return 'click'
    }
  }

  private buildAction(rawEvent: RawDOMEvent): RecordedAction | null {
    const type = this.mapEventType(rawEvent.type)
    const target = rawEvent.target
    const tag = target.tagName.toLowerCase()

    // change 事件特殊处理
    if (rawEvent.type === 'change') {
      if (tag === 'select') {
        return {
          id: uuidv4(),
          type: 'select',
          selector: rawEvent.selector,
          selectorMatchIndex: rawEvent.selectorMatchIndex,
          value: rawEvent.value,
          timestamp: Date.now(),
          tagName: tag,
          innerText: rawEvent.innerText,
          branchCandidates: rawEvent.branchCandidates,
          elementIndex: rawEvent.elementIndex,
          parentSelector: rawEvent.parentSelector,
          attributes: rawEvent.attributes,
        }
      }
      if (tag === 'input' && (target as HTMLInputElement).type === 'checkbox') {
        return {
          id: uuidv4(),
          type: 'check',
          selector: rawEvent.selector,
          checked: rawEvent.checked,
          timestamp: Date.now(),
          tagName: tag,
          inputType: 'checkbox',
          attributes: rawEvent.attributes,
        }
      }
      return null // 其他 change 事件忽略
    }

    // keydown 只关心特殊键
    if (rawEvent.type === 'keydown') {
      const key = rawEvent.key || ''
      const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      if (!specialKeys.includes(key)) return null

      return {
        id: uuidv4(),
        type: 'keydown',
        selector: rawEvent.selector,
        key,
        timestamp: Date.now(),
        tagName: tag,
        attributes: rawEvent.attributes,
      }
    }

    return {
      id: uuidv4(),
      type,
      selector: rawEvent.selector,
      selectorMatchIndex: rawEvent.selectorMatchIndex,
      value: rawEvent.value,
      timestamp: Date.now(),
      innerText: rawEvent.innerText,
      tagName: tag,
      branchCandidates: rawEvent.branchCandidates,
      elementIndex: rawEvent.elementIndex,
      parentSelector: rawEvent.parentSelector,
      inputType: rawEvent.inputType,
      checked: rawEvent.checked,
      attributes: rawEvent.attributes,
      scrollPosition: rawEvent.scrollPosition,
      fillSemantics: rawEvent.fillSemantics,
    }
  }
}
