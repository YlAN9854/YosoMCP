// Content Script 录制器 — DOM 事件捕获核心模块

import type { RecordedAction } from '@/types/action'
import { CS_MSG } from '@/types/message'
import { computeSelectorMatchIndex, generateSelector } from './selectorGenerator'
import { detectListPosition } from './listDetector'
import { collectBranchCandidates } from './branchCollector'
import { EventFilterPipeline } from './eventFilter'
import { createRecordingIndicator, updateIndicator, removeIndicator } from './indicator'

let isRecording = false
let isPaused = false
let filterPipeline: EventFilterPipeline | null = null
let indicator: HTMLElement | null = null
let lastUrl = location.href
let urlCheckTimer: ReturnType<typeof setInterval> | null = null
let lastInteractionTime = 0
const PICKER_BLOCK_FLAG = '__YOSO_BLOCK_RECORDING_INTERACTIONS__'

function shouldBlockByPicker(): boolean {
  return Boolean((window as any)[PICKER_BLOCK_FLAG])
}

function resolveFrameElementSelector(frameEl: HTMLIFrameElement): string | undefined {
  if (frameEl.id && !/^el-|^rc-|[-_]\d{4,}$/.test(frameEl.id)) {
    return `#${CSS.escape(frameEl.id)}`
  }
  const name = frameEl.getAttribute('name')
  if (name) return `iframe[name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
  const src = frameEl.getAttribute('src')
  if (src) {
    const part = src.split('?')[0].slice(-80)
    if (part) return `iframe[src*="${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
  }
  return undefined
}

function getFrameContext(): Pick<RecordedAction, 'frameSelector' | 'frameSelectors'> {
  try {
    if (window === window.top) return {}
    const selectors: string[] = []
    let current: Window = window
    while (current !== current.top) {
      const frameEl = current.frameElement
      if (!(frameEl instanceof HTMLIFrameElement)) break
      const selector = resolveFrameElementSelector(frameEl)
      if (!selector) break
      selectors.unshift(selector)
      if (current.parent === current) break
      current = current.parent
    }
    if (selectors.length === 0) return {}
    return {
      frameSelector: selectors[selectors.length - 1],
      frameSelectors: selectors,
    }
  } catch {
    return {}
  }
  return {}
}

function onActionCaptured(action: RecordedAction) {
  const payload = { ...action }
  const frameContext = getFrameContext()
  if (frameContext.frameSelector) payload.frameSelector = frameContext.frameSelector
  if (frameContext.frameSelectors?.length) payload.frameSelectors = frameContext.frameSelectors
  chrome.runtime.sendMessage(
    { type: CS_MSG.ACTION_CAPTURED, data: payload },
    () => void chrome.runtime.lastError,
  )
}

function handleClick(e: MouseEvent) {
  if (isPaused || !filterPipeline || shouldBlockByPicker()) return
  lastInteractionTime = Date.now()

  const target = e.target as Element
  if (!target || !target.tagName) return

  const selector = generateSelector(target)
  const selectorMatchIndex = computeSelectorMatchIndex(selector, target)
  const branchCandidates = collectBranchCandidates(target)
  const listPosition = detectListPosition(target)

  filterPipeline.filter({
    type: 'click',
    target,
    selector,
    selectorMatchIndex,
    innerText: target.textContent?.trim().slice(0, 100),
    tagName: target.tagName.toLowerCase(),
    branchCandidates,
    ...(listPosition && {
      elementIndex: listPosition.elementIndex,
      parentSelector: listPosition.parentSelector,
    }),
    attributes: getKeyAttributes(target),
  })
}

function handleDblClick(e: MouseEvent) {
  if (isPaused || !filterPipeline || shouldBlockByPicker()) return
  lastInteractionTime = Date.now()

  const target = e.target as Element
  if (!target || !target.tagName) return

  const selector = generateSelector(target)
  const selectorMatchIndex = computeSelectorMatchIndex(selector, target)

  filterPipeline.filter({
    type: 'dblclick',
    target,
    selector,
    selectorMatchIndex,
    innerText: target.textContent?.trim().slice(0, 100),
    tagName: target.tagName.toLowerCase(),
    attributes: getKeyAttributes(target),
  })
}

/**
 * 获取 contenteditable 的“编辑器根”元素，用于将同一编辑器内的多次 input 合并为一条 fill。
 * - 若当前在编辑器内部子节点（如 <p>）上触发 input，target 会变化，导致防抖无法合并；
 * - 统一归一到该 contenteditable 根，则所有在该编辑器内的输入都视为同一元素。
 */
function getClosestContentEditable(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  if (el.isContentEditable) return el
  const byAttr = el.closest?.('[contenteditable]')
  if (byAttr instanceof HTMLElement) return byAttr
  let cur: HTMLElement | null = el.parentElement
  while (cur) {
    if (cur.isContentEditable) return cur
    cur = cur.parentElement
  }
  return null
}

function getSelectionAnchorElement(): HTMLElement | null {
  const selection = window.getSelection()
  if (!selection?.anchorNode) return null
  if (selection.anchorNode instanceof HTMLElement) return selection.anchorNode
  return selection.anchorNode.parentElement
}

function normalizeEditableValue(text: string): string {
  return text.replace(/\u200B/g, '').replace(/\r\n/g, '\n')
}

function resolveEditableInputTarget(rawTarget: HTMLElement): HTMLElement {
  const anchor = getSelectionAnchorElement()
  if (anchor && rawTarget.contains(anchor)) {
    let leaf: HTMLElement = anchor
    while (leaf.parentElement && leaf.parentElement !== rawTarget) {
      leaf = leaf.parentElement
    }
    return leaf
  }

  const fromTarget = getClosestContentEditable(rawTarget)
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const fromActive = getClosestContentEditable(active)
  const anchorEl = getSelectionAnchorElement()
  const fromAnchor = getClosestContentEditable(anchorEl)
  const root = fromTarget || fromActive || fromAnchor
  if (!root) {
    if (anchorEl) return anchorEl
    if (active) return active
    return rawTarget
  }
  if (!anchorEl || !root.contains(anchorEl)) return root

  let leaf: HTMLElement = anchorEl
  while (leaf.parentElement && leaf.parentElement !== root) {
    leaf = leaf.parentElement
  }
  return leaf
}

function getEditableValue(target: HTMLElement): string {
  const selectionAnchor = getSelectionAnchorElement()
  if (selectionAnchor && target.contains(selectionAnchor)) {
    return normalizeEditableValue(selectionAnchor.innerText ?? selectionAnchor.textContent ?? '')
  }

  const editableRoot = getClosestContentEditable(target)
  if (!editableRoot) return normalizeEditableValue(target.innerText ?? target.textContent ?? '')

  if (selectionAnchor && editableRoot.contains(selectionAnchor)) {
    let block = selectionAnchor
    while (block.parentElement && block.parentElement !== editableRoot) {
      block = block.parentElement
    }
    return normalizeEditableValue(block.innerText ?? block.textContent ?? '')
  }

  const active = document.activeElement
  if (active instanceof HTMLElement && editableRoot.contains(active)) {
    let block = active
    while (block.parentElement && block.parentElement !== editableRoot) {
      block = block.parentElement
    }
    return normalizeEditableValue(block.innerText ?? block.textContent ?? '')
  }

  return normalizeEditableValue(editableRoot.innerText ?? editableRoot.textContent ?? '')
}

function handleInput(e: Event) {
  if (isPaused || !filterPipeline || shouldBlockByPicker()) return
  lastInteractionTime = Date.now()

  const rawTarget = e.target as HTMLElement
  if (!rawTarget || !rawTarget.tagName) return

  // input[type=file] 的 input/change 事件不应产生 fill action，由 upload action 处理
  if (rawTarget instanceof HTMLInputElement && rawTarget.type === 'file') return

  const isNativeInput = rawTarget instanceof HTMLInputElement || rawTarget instanceof HTMLTextAreaElement
  const target = isNativeInput ? rawTarget : resolveEditableInputTarget(rawTarget)

  const selector = generateSelector(target)

  const value = (target.isContentEditable || getClosestContentEditable(target))
    ? getEditableValue(target)
    : (target as HTMLInputElement | HTMLTextAreaElement).value
  const richText = target.isContentEditable || !!getClosestContentEditable(target)
  const fillSemantics = richText
    ? {
        richText: true,
        cursorAtEnd: true,
        incremental: true,
        preserveUndoStack: true,
      }
    : undefined

  filterPipeline.filter({
    type: 'input',
    target,
    selector,
    value,
    tagName: target.tagName.toLowerCase(),
    inputType: (target as HTMLInputElement).type,
    attributes: getKeyAttributes(target),
    fillSemantics,
  })
}

function handleChange(e: Event) {
  if (isPaused || !filterPipeline || shouldBlockByPicker()) return
  lastInteractionTime = Date.now()

  const target = e.target as HTMLSelectElement | HTMLInputElement
  if (!target || !target.tagName) return

  if (target instanceof HTMLInputElement && target.type === 'file') return

  const selector = generateSelector(target)
  const tag = target.tagName.toLowerCase()

  filterPipeline.filter({
    type: 'change',
    target,
    selector,
    value: target.value,
    tagName: tag,
    checked: (target as HTMLInputElement).checked,
    inputType: (target as HTMLInputElement).type,
    attributes: getKeyAttributes(target),
  })
}

function handleKeydown(e: KeyboardEvent) {
  if (isPaused || !filterPipeline || shouldBlockByPicker()) return
  lastInteractionTime = Date.now()

  const target = e.target as Element
  if (!target || !target.tagName) return

  const selector = generateSelector(target)

  filterPipeline.filter({
    type: 'keydown',
    target,
    selector,
    key: e.key,
    tagName: target.tagName.toLowerCase(),
    attributes: getKeyAttributes(target),
  })
}

function getKeyAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  const keys = ['href', 'type', 'role', 'data-testid', 'aria-label', 'name', 'placeholder', 'contenteditable']
  for (const k of keys) {
    const val = el.getAttribute(k)
    if (val) attrs[k] = val
  }
  return attrs
}

function startNavigationDetection() {
  lastUrl = location.href
  urlCheckTimer = setInterval(() => {
    if (location.href !== lastUrl) {
      const newUrl = location.href
      lastUrl = newUrl

      // 如果 URL 变化发生在最近一次交互后的 2 秒内，则认为是交互导致的变化，不记录 navigate Action
      if (Date.now() - lastInteractionTime < 2000) {
        return
      }

      onActionCaptured({
        id: crypto.randomUUID?.() ?? Date.now().toString(),
        type: 'navigate',
        selector: '',
        url: newUrl,
        timestamp: Date.now(),
      })
    }
  }, 500)
}

function stopNavigationDetection() {
  if (urlCheckTimer) {
    clearInterval(urlCheckTimer)
    urlCheckTimer = null
  }
}

export function startRecording(options?: { showIndicator?: boolean }) {
  if (isRecording) return

  isRecording = true
  isPaused = false
  filterPipeline = new EventFilterPipeline(onActionCaptured)

  if (options?.showIndicator !== false) {
    indicator = createRecordingIndicator()
  }

  document.addEventListener('click', handleClick, true)
  document.addEventListener('dblclick', handleDblClick, true)
  document.addEventListener('input', handleInput, true)
  document.addEventListener('change', handleChange, true)
  document.addEventListener('keydown', handleKeydown, true)
  startNavigationDetection()
}

export function pauseRecording() {
  isPaused = true
  if (indicator) updateIndicator(indicator, true)
}

export function resumeRecording() {
  isPaused = false
  if (indicator) updateIndicator(indicator, false)
}

export function stopRecording() {
  isRecording = false
  isPaused = false

  document.removeEventListener('click', handleClick, true)
  document.removeEventListener('dblclick', handleDblClick, true)
  document.removeEventListener('input', handleInput, true)
  document.removeEventListener('change', handleChange, true)
  document.removeEventListener('keydown', handleKeydown, true)
  stopNavigationDetection()

  if (filterPipeline) {
    filterPipeline.flushPendingFill()
    filterPipeline.destroy()
    filterPipeline = null
  }

  if (indicator) {
    removeIndicator(indicator)
    indicator = null
  }
}

export function getRecordingStatus() {
  return { isRecording, isPaused }
}

/** 提取元素的直接文本节点内容（不含子元素的文本），去除多余空白 */
function getDirectText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeInnerText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? ''
  return raw.replace(/\s+/g, ' ').trim()
}

export function getPageSnapshot() {
  // 对齐文档方案：id + 按钮/链接文本；控制候选规模，降低“登录后大批动态内容替换”噪声。
  const MAX_ID_SELECTORS = 20
  const MAX_TOTAL_SELECTORS = 30
  const elements: Array<{
    selector: string
    key: string
    tagName: string
    text: string
    id?: string
    href?: string
    ariaLabel?: string
  }> = []
  const seenKeys = new Set<string>()

  const pushElement = (item: {
    selector: string
    key: string
    tagName: string
    text: string
    id?: string
    href?: string
    ariaLabel?: string
  }) => {
    if (elements.length >= MAX_TOTAL_SELECTORS) return
    if (seenKeys.has(item.key)) return
    elements.push(item)
    seenKeys.add(item.key)
  }

  // 1) 带 id 元素（最多 20 个）
  let idCount = 0
  const idElements = Array.from(document.querySelectorAll('[id]'))
  for (const el of idElements) {
    if (elements.length >= MAX_TOTAL_SELECTORS || idCount >= MAX_ID_SELECTORS) break
    const id = el.id
    if (!id || id.startsWith('yoso-')) continue
    const text = normalizeInnerText(el).slice(0, 40)
    pushElement({
      selector: `#${CSS.escape(id)}`,
      key: `id:${id}`,
      tagName: el.tagName.toLowerCase(),
      text,
      id,
      ariaLabel: el.getAttribute('aria-label') || undefined,
    })
    idCount++
  }

  // 2) button / a[href] / [role="button"] 文本选择器（总数补足到 30）
  const interactiveElements = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
  for (const el of interactiveElements) {
    if (elements.length >= MAX_TOTAL_SELECTORS) break
    const tagName = el.tagName.toLowerCase()
    const text = normalizeInnerText(el).slice(0, 20)
    if (!text) continue
    const selector = `${tagName}:has-text("${escapeAttrValue(text)}")`
    const key = `${tagName}::text:${text.toLowerCase()}`
    pushElement({
      selector,
      key,
      tagName,
      text,
      href: tagName === 'a' ? (el as HTMLAnchorElement).getAttribute('href') || undefined : undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
    })
  }

  // 旧版兼容：保留纯字符串选择器列表（以 elements 为准）
  const selectors = elements.map(e => e.selector)

  return {
    url: location.href,
    title: document.title,
    selectors,
    elements,
  }
}
