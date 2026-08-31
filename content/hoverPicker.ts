// Hover 拾取器：用户手动选择需要悬停的元素，记录一条 hover action
//
// 适用场景：鼠标悬停后才会展开的面板/菜单/弹出层。
// 流程：用户点击侧边栏「悬停」按钮 → 进入拾取模式 → 点击页面元素 → 记录 hover → 恢复录制。

import { generateSelector } from './selectorGenerator'

export interface HoverPickedResult {
  selector: string
  innerText?: string
  tagName?: string
  attributes?: Record<string, string>
}

let pickerHost: HTMLElement | null = null
let hoverHighlight: HTMLElement | null = null
let onPickedCallback: ((result: HoverPickedResult) => void) | null = null
let onCancelledCallback: (() => void) | null = null
const PICKER_BLOCK_FLAG = '__YOSO_BLOCK_RECORDING_INTERACTIONS__'

let handleMouseMove: ((e: MouseEvent) => void) | null = null
let handleClick: ((e: MouseEvent) => void) | null = null
let handleKeyDown: ((e: KeyboardEvent) => void) | null = null

export function startHoverPicker(
  onPicked: (result: HoverPickedResult) => void,
  onCancelled?: () => void,
): void {
  if (pickerHost) {
    stopHoverPicker()
  }

  onPickedCallback = onPicked
  onCancelledCallback = onCancelled || null
  ;(window as any)[PICKER_BLOCK_FLAG] = true

  pickerHost = document.createElement('div')
  pickerHost.id = 'yoso-hover-picker'
  const shadow = pickerHost.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      .toolbar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        background: #111827;
        color: #e5e7eb;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        padding: 10px 14px;
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .toolbar-text { flex: 1; }
      .hint { color: #9ca3af; }
    </style>
    <div class="toolbar">
      <span class="toolbar-text">YOSO Flow 悬停拾取：点击需要悬停才能<span style="white-space: nowrap">展开面板</span>的元素</span>
      <span class="hint">ESC 取消</span>
    </div>
  `

  document.body.appendChild(pickerHost)

  hoverHighlight = document.createElement('div')
  Object.assign(hoverHighlight.style, {
    position: 'absolute',
    border: '2px dashed #f59e0b',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
  })
  document.body.appendChild(hoverHighlight)

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
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    const selector = generateSelector(target)
    const tagName = target.tagName.toLowerCase()
    const innerText = target.textContent?.trim().slice(0, 100)

    const attrs: Record<string, string> = {}
    for (const k of ['href', 'type', 'role', 'data-testid', 'aria-label', 'name', 'placeholder']) {
      const val = target.getAttribute(k)
      if (val) attrs[k] = val
    }

    onPickedCallback?.({ selector, innerText, tagName, attributes: attrs })
    stopHoverPicker()
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancelledCallback?.()
      stopHoverPicker()
    }
  }

  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)
  document.addEventListener('keydown', handleKeyDown, true)
}

export function stopHoverPicker(): void {
  if (handleMouseMove) document.removeEventListener('mousemove', handleMouseMove, true)
  if (handleClick) document.removeEventListener('click', handleClick, true)
  if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown, true)
  handleMouseMove = null
  handleClick = null
  handleKeyDown = null

  hoverHighlight?.remove()
  hoverHighlight = null
  pickerHost?.remove()
  pickerHost = null

  onPickedCallback = null
  onCancelledCallback = null
  ;(window as any)[PICKER_BLOCK_FLAG] = false
}

function getPickableTarget(e: MouseEvent): Element | null {
  const target = e.target as Element | null
  if (!target) return null
  if (pickerHost && (target === pickerHost || pickerHost.contains(target))) return null
  if (target.closest?.('#yoso-hover-picker')) return null
  return target
}
