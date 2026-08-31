// 选择器拾取模式 — 在页面上交互式选择同类元素
// 使用 Shadow DOM 隔离样式（参考 indicator.ts 模式）

import type { PickedElementInfo, DOMPathSegment, SelectorPatternResult } from '@/types/selectorPicker'
import { inferSelectorPattern } from './selectorPatternInfer'

let pickerHost: HTMLElement | null = null
let hoverHighlight: HTMLElement | null = null
let pickedElements: { element: Element; marker: HTMLElement }[] = []
let originalElement: Element | null = null
let originalMarker: HTMLElement | null = null
let onComplete: ((picked: PickedElementInfo[], patternResult: SelectorPatternResult) => void) | null = null

// 缓存事件处理器引用，用于移除
let handleMouseMove: ((e: MouseEvent) => void) | null = null
let handleClick: ((e: MouseEvent) => void) | null = null
let handleKeyDown: ((e: KeyboardEvent) => void) | null = null

/**
 * 进入选择器拾取模式
 */
export function startSelectorPicker(
  originalSelector: string,
  callback: (result: PickedElementInfo[], patternResult: SelectorPatternResult) => void,
  options?: {
    originalTagName?: string
    originalText?: string
    parentSelector?: string
    elementIndex?: number
  },
): void {
  // 防止重复进入
  if (pickerHost) {
    stopSelectorPicker()
  }

  onComplete = callback

  // 尝试定位原始元素（多策略兜底）
  originalElement = findOriginalElement(originalSelector, options)

  // 创建 Shadow DOM 宿主
  pickerHost = document.createElement('div')
  pickerHost.id = 'yoso-selector-picker'
  const shadow = pickerHost.attachShadow({ mode: 'closed' })

  // 注入工具栏样式 + 容器
  shadow.innerHTML = `
    <style>
      .toolbar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        background: #1e293b;
        color: white;
        padding: 10px 16px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 -2px 12px rgba(0,0,0,0.3);
      }
      .toolbar-text {
        flex: 1;
      }
      .toolbar-count {
        color: #60a5fa;
        font-weight: 600;
      }
      .btn {
        padding: 6px 14px;
        border-radius: 6px;
        border: none;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .btn-confirm {
        background: #22c55e;
        color: white;
      }
      .btn-confirm:hover { background: #16a34a; }
      .btn-confirm:disabled {
        background: #4b5563;
        cursor: not-allowed;
      }
      .btn-cancel {
        background: #ef4444;
        color: white;
      }
      .btn-cancel:hover { background: #dc2626; }
    </style>
    <div class="toolbar">
      <span class="toolbar-text">
        YOSO Flow 选择器拾取 — 点击页面上的同类元素 | 已选 <span class="toolbar-count" id="pick-count">0</span> 个
      </span>
      <button class="btn btn-confirm" id="btn-done" disabled>完成选择</button>
      <button class="btn btn-cancel" id="btn-cancel">取消</button>
    </div>
  `

  document.body.appendChild(pickerHost)

  // 获取工具栏按钮引用
  const btnDone = shadow.getElementById('btn-done') as HTMLButtonElement
  const btnCancel = shadow.getElementById('btn-cancel') as HTMLButtonElement
  const pickCountEl = shadow.getElementById('pick-count')!

  btnDone.addEventListener('click', () => finishPicking())
  btnCancel.addEventListener('click', () => cancelPicking())

  // 高亮原始元素
  if (originalElement) {
    originalMarker = createMarker(originalElement, '原始', '#3b82f6')
    document.body.appendChild(originalMarker)
  }

  // 创建悬停高亮元素
  hoverHighlight = document.createElement('div')
  Object.assign(hoverHighlight.style, {
    position: 'absolute',
    border: '2px dashed #8b5cf6',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
    transition: 'all 0.05s',
  })
  document.body.appendChild(hoverHighlight)

  // 事件处理
  handleMouseMove = (e: MouseEvent) => {
    const target = getPickableTarget(e)
    if (!target || !hoverHighlight) return

    const rect = target.getBoundingClientRect()
    Object.assign(hoverHighlight.style, {
      display: 'block',
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  handleClick = (e: MouseEvent) => {
    const target = getPickableTarget(e)
    if (!target) return // 拾取器自身 UI 的点击放行，不拦截

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    // 检查是否已选中
    const existingIdx = pickedElements.findIndex(p => p.element === target)
    if (existingIdx >= 0) {
      // 取消选中
      pickedElements[existingIdx].marker.remove()
      pickedElements.splice(existingIdx, 1)
      // 重新编号
      pickedElements.forEach((p, i) => updateMarkerLabel(p.marker, `${i + 1}`))
    } else {
      // 新增选中
      const marker = createMarker(target, `${pickedElements.length + 1}`, '#22c55e')
      document.body.appendChild(marker)
      pickedElements.push({ element: target, marker })
    }

    // 更新工具栏计数
    pickCountEl.textContent = String(pickedElements.length)
    btnDone.disabled = pickedElements.length === 0
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelPicking()
    }
  }

  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)
  document.addEventListener('keydown', handleKeyDown, true)
}

/**
 * 退出拾取模式，清除所有 DOM 注入
 */
export function stopSelectorPicker(): void {
  // 移除事件
  if (handleMouseMove) document.removeEventListener('mousemove', handleMouseMove, true)
  if (handleClick) document.removeEventListener('click', handleClick, true)
  if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown, true)
  handleMouseMove = null
  handleClick = null
  handleKeyDown = null

  // 移除高亮
  hoverHighlight?.remove()
  hoverHighlight = null

  // 移除选中标记
  for (const p of pickedElements) {
    p.marker.remove()
  }
  pickedElements = []

  // 移除原始元素标记
  originalMarker?.remove()
  originalMarker = null
  originalElement = null

  // 移除 Shadow DOM 宿主
  pickerHost?.remove()
  pickerHost = null

  onComplete = null
}

/**
 * 获取当前拾取的原始 DOM Element（供推断算法使用）
 */
export function getPickerOriginalElement(): Element | null {
  return originalElement
}

/**
 * 获取当前拾取的 Element 列表（供推断算法使用）
 */
export function getPickedElements(): Element[] {
  return pickedElements.map(p => p.element)
}

// ===== 内部函数 =====

function finishPicking() {
  // 在清除状态之前运行推断算法（此时元素引用仍存在）
  const picked = pickedElements.map(p => p.element)
  const infos = pickedElements.map(p => buildPickedElementInfo(p.element))

  let patternResult: SelectorPatternResult
  let baseOriginal = originalElement
  let elementsForInfer = picked

  // 兜底：若原始元素恢复失败，但已选 >= 2 个元素，则用第一个已选元素作为临时原始元素继续推断
  if (!baseOriginal && picked.length >= 2) {
    baseOriginal = picked[0]
    elementsForInfer = picked.slice(1)
  }

  if (baseOriginal && elementsForInfer.length > 0) {
    patternResult = inferSelectorPattern(baseOriginal, elementsForInfer)
  } else {
    patternResult = { success: false, error: '缺少可用于推断的元素，请至少选择 2 个同类元素' }
  }

  const cb = onComplete
  stopSelectorPicker()
  cb?.(infos, patternResult)
}

function cancelPicking() {
  stopSelectorPicker()
}

/**
 * 获取鼠标事件下的可拾取目标。
 * 排除拾取器自身 UI 元素和已标记元素。
 */
function getPickableTarget(e: MouseEvent): Element | null {
  const target = e.target as Element | null
  if (!target) return null

  // 排除拾取器自身的 UI
  if (pickerHost && (pickerHost === target || pickerHost.contains(target))) return null
  if (target.closest?.('#yoso-selector-picker')) return null

  // 排除已存在的 marker
  if (target.classList?.contains('yoso-picker-marker')) return null
  if (target.closest?.('.yoso-picker-marker')) return null

  return target
}

/**
 * 创建元素标记（边框 + 角标）
 */
function createMarker(element: Element, label: string, color: string): HTMLElement {
  const rect = element.getBoundingClientRect()
  const marker = document.createElement('div')
  marker.className = 'yoso-picker-marker'
  Object.assign(marker.style, {
    position: 'absolute',
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: `2px solid ${color}`,
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
  })

  // 角标 badge
  const badge = document.createElement('span')
  badge.className = 'yoso-picker-badge'
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-10px',
    left: '-2px',
    background: color,
    color: 'white',
    fontSize: '10px',
    fontFamily: 'system-ui, sans-serif',
    padding: '1px 5px',
    borderRadius: '3px',
    fontWeight: '600',
    lineHeight: '14px',
    whiteSpace: 'nowrap',
  })
  badge.textContent = label
  marker.appendChild(badge)

  return marker
}

function updateMarkerLabel(marker: HTMLElement, label: string) {
  const badge = marker.querySelector('.yoso-picker-badge') as HTMLElement | null
  if (badge) badge.textContent = label
}

/**
 * 将 DOM Element 转为 PickedElementInfo
 */
function buildPickedElementInfo(element: Element): PickedElementInfo {
  const rect = element.getBoundingClientRect()

  return {
    selector: buildCssSelector(element),
    tagName: element.tagName.toLowerCase(),
    classList: Array.from(element.classList),
    attributes: getStructuralAttributes(element),
    innerText: element.textContent?.trim().slice(0, 50),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    domPath: buildDOMPath(element),
  }
}

function buildCssSelector(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  let depth = 0

  while (current && current !== document.body && depth < 5) {
    const tag = current.tagName.toLowerCase()

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`)
      break
    }

    const classes = Array.from(current.classList).slice(0, 2)
    if (classes.length > 0) {
      parts.unshift(`${tag}.${classes.map(c => CSS.escape(c)).join('.')}`)
    } else {
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current!.tagName)
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1
          parts.unshift(`${tag}:nth-of-type(${idx})`)
        } else {
          parts.unshift(tag)
        }
      } else {
        parts.unshift(tag)
      }
    }

    current = current.parentElement
    depth++
  }

  return parts.join(' > ')
}

function getStructuralAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  const keys = ['role', 'data-type', 'data-testid', 'aria-label', 'href', 'type']
  for (const key of keys) {
    const val = element.getAttribute(key)
    if (val) attrs[key] = val
  }
  return attrs
}

function buildDOMPath(element: Element): DOMPathSegment[] {
  const path: DOMPathSegment[] = []
  let current: Element | null = element

  while (current && current !== document.documentElement) {
    const el: Element = current
    const parentEl: Element | null = el.parentElement
    let index = 0
    let siblingCount = 1

    if (parentEl) {
      const sameTagSiblings = Array.from(parentEl.children).filter(
        (s: Element) => s.tagName === el.tagName,
      )
      siblingCount = sameTagSiblings.length
      index = sameTagSiblings.indexOf(el)
    }

    path.unshift({
      tagName: current.tagName.toLowerCase(),
      classList: Array.from(current.classList),
      id: current.id || undefined,
      index,
      siblingCount,
      attributes: getStructuralAttributes(current),
    })

    current = parentEl
  }

  return path
}

function findOriginalElement(
  originalSelector: string,
  options?: {
    originalTagName?: string
    originalText?: string
    parentSelector?: string
    elementIndex?: number
  },
): Element | null {
  // 1) 直接按原始 selector 定位
  const bySelector = safeQueryFirst(originalSelector)
  if (bySelector) return bySelector

  // 2) 尝试 parentSelector + elementIndex 定位
  const parent = options?.parentSelector ? safeQueryFirst(options.parentSelector) : null
  const tagName = options?.originalTagName?.toLowerCase()
  const elementIndex = options?.elementIndex

  if (parent && typeof elementIndex === 'number' && elementIndex >= 0) {
    const directChildren = Array.from(parent.children)
    if (elementIndex < directChildren.length) {
      const byChildIndex = directChildren[elementIndex]
      if (!tagName || byChildIndex.tagName.toLowerCase() === tagName) return byChildIndex
    }

    if (tagName) {
      const sameTagChildren = directChildren.filter(
        c => c.tagName.toLowerCase() === tagName
      )
      if (elementIndex < sameTagChildren.length) return sameTagChildren[elementIndex]
    }
  }

  // 3) 尝试按 tag + 文本定位（优先父容器内）
  const text = normalizeText(options?.originalText)
  if (tagName && text) {
    if (parent) {
      const inParent = Array.from(parent.querySelectorAll(tagName))
      const exactInParent = inParent.find(el => normalizeText(el.textContent) === text)
      if (exactInParent) return exactInParent
    }

    const allByTag = Array.from(document.querySelectorAll(tagName))
    const exact = allByTag.find(el => normalizeText(el.textContent) === text)
    if (exact) return exact
    const partial = allByTag.find(el => normalizeText(el.textContent).includes(text))
    if (partial) return partial
  }

  return null
}

function safeQueryFirst(selector?: string): Element | null {
  if (!selector) return null
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

function normalizeText(text?: string | null): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}
