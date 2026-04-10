import { generateSelector } from './selectorGenerator'

export interface UploadPickedResult {
  selector: string
  innerText?: string
  tagName?: string
  attributes?: Record<string, string>
  acceptHint?: string
  multiple?: boolean
}

let pickerHost: HTMLElement | null = null
let hoverHighlight: HTMLElement | null = null
let onPickedCallback: ((result: UploadPickedResult) => void) | null = null
let onCancelledCallback: (() => void) | null = null
const PICKER_BLOCK_FLAG = '__YOSO_BLOCK_RECORDING_INTERACTIONS__'

let handleMouseMove: ((e: MouseEvent) => void) | null = null
let handleClick: ((e: MouseEvent) => void) | null = null
let handleKeyDown: ((e: KeyboardEvent) => void) | null = null

export function startUploadPicker(
  onPicked: (result: UploadPickedResult) => void,
  onCancelled?: () => void,
): void {
  if (pickerHost) {
    stopUploadPicker()
  }

  onPickedCallback = onPicked
  onCancelledCallback = onCancelled || null
  ;(window as any)[PICKER_BLOCK_FLAG] = true

  pickerHost = document.createElement('div')
  pickerHost.id = 'yoso-upload-picker'
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
      <span class="toolbar-text">YOSO 文件上传：请点击页面上的文件上传控件（input[type=file]）</span>
      <span class="hint">ESC 取消</span>
    </div>
  `
  document.body.appendChild(pickerHost)

  hoverHighlight = document.createElement('div')
  Object.assign(hoverHighlight.style, {
    position: 'absolute',
    border: '2px dashed #14b8a6',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
    background: 'rgba(20, 184, 166, 0.08)',
  })
  document.body.appendChild(hoverHighlight)

  handleMouseMove = (e: MouseEvent) => {
    const target = getPickableFileInput(e)
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
    const target = getPickableFileInput(e)
    if (!target) return

    const attrs: Record<string, string> = {}
    for (const k of ['id', 'name', 'class', 'accept', 'aria-label', 'data-testid']) {
      const val = target.getAttribute(k)
      if (val) attrs[k] = val
    }

    onPickedCallback?.({
      selector: generateSelector(target),
      innerText: target.getAttribute('aria-label') || undefined,
      tagName: target.tagName.toLowerCase(),
      attributes: attrs,
      acceptHint: target.accept || undefined,
      multiple: target.multiple || undefined,
    })
    // 不阻断默认点击行为：让页面继续触发原生文件选择窗口。
    // 在当前用户手势内仅关闭 picker，后续由页面自身处理上传流程。
    stopUploadPicker()
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancelledCallback?.()
      stopUploadPicker()
    }
  }

  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)
  document.addEventListener('keydown', handleKeyDown, true)
}

export function stopUploadPicker(): void {
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

function getPickableFileInput(e: MouseEvent): HTMLInputElement | null {
  const target = e.target as Element | null
  if (!target) return null
  if (pickerHost && (target === pickerHost || pickerHost.contains(target))) return null
  if (target.closest?.('#yoso-upload-picker')) return null

  const direct = target instanceof HTMLInputElement && target.type === 'file' ? target : null
  if (direct) return direct

  const fromClosest = target.closest?.('input[type="file"]')
  if (fromClosest instanceof HTMLInputElement) return fromClosest

  // 支持“按钮/图标触发隐藏 file input”：
  // 1) label[for] 关联 input[type=file]
  const labelEl = target.closest?.('label[for]')
  if (labelEl instanceof HTMLLabelElement) {
    const forId = labelEl.getAttribute('for')
    if (forId) {
      const escaped = (window.CSS && typeof window.CSS.escape === 'function')
        ? window.CSS.escape(forId)
        : forId.replace(/"/g, '\\"')
      const byFor = document.querySelector(`input[type="file"]#${escaped}`)
      if (byFor instanceof HTMLInputElement) return byFor
    }
  }

  // 2) 向上容器内查找 file input
  const container = target.closest?.('button, [role="button"], [class*="upload"], [class*="Upload"]')
  if (container instanceof Element) {
    const nested = container.querySelector('input[type="file"]')
    if (nested instanceof HTMLInputElement) return nested
  }

  return null
}
