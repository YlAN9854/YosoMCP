// Wait Element Picker：结束等待后点选目标；与「内容提取」类似，点选后再选「等待说明」才完成。

import { generateSelector } from './selectorGenerator'

export type WaitCommentChoice = 'login' | 'content' | 'none'

export interface WaitElementPickedResult {
  selector: string
  innerText?: string
  tagName?: string
  attributes?: Record<string, string>
  choiceType: 'element' | 'url' | 'timeout'
  waitComment: WaitCommentChoice
}

export interface WaitPickerOptions {
  urlChanged?: boolean
  newUrl?: string
  duration?: number
  diffHints?: Array<{ tagName: string; text: string }>
}

type PendingWaitPick = Omit<WaitElementPickedResult, 'waitComment'>

let pickerHost: HTMLElement | null = null
let pickerShadow: ShadowRoot | null = null
let hoverHighlight: HTMLElement | null = null
let diffMarkers: HTMLElement[] = []
let selectedMarker: HTMLElement | null = null
let pendingBase: PendingWaitPick | null = null
let onPickedCallback: ((result: WaitElementPickedResult) => void) | null = null
let onCancelledCallback: (() => void) | null = null
const PICKER_BLOCK_FLAG = '__YOSO_BLOCK_RECORDING_INTERACTIONS__'

let handleMouseMove: ((e: MouseEvent) => void) | null = null
let handleClick: ((e: MouseEvent) => void) | null = null
let handleKeyDown: ((e: KeyboardEvent) => void) | null = null

function createSelectedMarker(target: Element): HTMLElement {
  const rect = target.getBoundingClientRect()
  const marker = document.createElement('div')
  marker.className = 'yoso-wait-selected-marker'
  Object.assign(marker.style, {
    position: 'absolute',
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: '2px solid #3b82f6',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
  })
  return marker
}

function clearPendingPickState(): void {
  pendingBase = null
  selectedMarker?.remove()
  selectedMarker = null
  const actions = pickerShadow?.getElementById('wait-comment-actions') as HTMLElement | null
  if (actions) actions.style.display = 'none'
}

function positionWaitCommentPanel(anchorRect: DOMRect | null): void {
  const actions = pickerShadow?.getElementById('wait-comment-actions') as HTMLElement | null
  if (!actions) return
  actions.style.display = 'flex'
  if (anchorRect) {
    const panelTop = Math.max(8, anchorRect.top + window.scrollY - 52)
    const panelLeft = Math.max(8, anchorRect.left + window.scrollX)
    actions.style.position = 'fixed'
    actions.style.top = `${panelTop}px`
    actions.style.left = `${panelLeft}px`
    actions.style.bottom = ''
    actions.style.right = ''
    actions.style.transform = ''
  } else {
    actions.style.position = 'fixed'
    actions.style.bottom = '52px'
    actions.style.left = '50%'
    actions.style.top = ''
    actions.style.right = ''
    actions.style.transform = 'translateX(-50%)'
  }
}

function finalizeWaitPick(wc: WaitCommentChoice): void {
  if (!pendingBase || !onPickedCallback) return
  onPickedCallback({ ...pendingBase, waitComment: wc })
  stopWaitElementPicker()
}

export function startWaitElementPicker(
  options: WaitPickerOptions,
  onPicked: (result: WaitElementPickedResult) => void,
  onCancelled?: () => void,
): void {
  if (pickerHost) stopWaitElementPicker()

  onPickedCallback = onPicked
  onCancelledCallback = onCancelled || null
  pendingBase = null
  ;(window as any)[PICKER_BLOCK_FLAG] = true

  pickerHost = document.createElement('div')
  pickerHost.id = 'yoso-wait-picker'
  const shadow = pickerHost.attachShadow({ mode: 'closed' })
  pickerShadow = shadow

  const urlBtn = options.urlChanged
    ? `<button type="button" class="btn btn-url" data-action="url">🔗 URL变化 (${truncate(options.newUrl || '', 30)})</button>`
    : ''
  const timeoutSec = options.duration ? Math.ceil(options.duration / 1000) : 5

  shadow.innerHTML = `
    <style>
      .toolbar {
        position: fixed; left: 0; right: 0; bottom: 0;
        z-index: 2147483647;
        background: #111827; color: #e5e7eb;
        font-family: system-ui, sans-serif; font-size: 13px;
        padding: 10px 14px;
        display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      }
      .toolbar-text { flex: 1; min-width: 180px; }
      .hint { color: #9ca3af; font-size: 11px; }
      .btn {
        padding: 5px 12px; border-radius: 5px; border: none;
        font-size: 12px; cursor: pointer; white-space: nowrap;
      }
      .btn-url { background: #3b82f6; color: white; }
      .btn-url:hover { background: #2563eb; }
      .btn-timeout { background: #6b7280; color: white; }
      .btn-timeout:hover { background: #4b5563; }
      .btn-cancel { background: #374151; color: #d1d5db; }
      .btn-cancel:hover { background: #4b5563; }
      .wait-comment-actions {
        display: none;
        position: fixed;
        z-index: 2147483647;
        flex-direction: column;
        gap: 8px;
        background: rgba(17, 24, 39, 0.96);
        border: 1px solid #374151;
        border-radius: 8px;
        padding: 10px 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        max-width: min(96vw, 420px);
      }
      .wc-row {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      }
      .wc-title { font-size: 12px; color: #e5e7eb; font-weight: 600; }
      .wc-hint { font-size: 11px; color: #9ca3af; }
      .btn-wc-login { background: #2563eb; color: #fff; }
      .btn-wc-login:hover { background: #1d4ed8; }
      .btn-wc-content { background: #7c3aed; color: #fff; }
      .btn-wc-content:hover { background: #6d28d9; }
      .btn-wc-none { background: #4b5563; color: #fff; }
      .btn-wc-none:hover { background: #374151; }
      .btn-wc-back { background: transparent; color: #9ca3af; border: 1px solid #4b5563; }
      .btn-wc-back:hover { color: #e5e7eb; border-color: #6b7280; }
    </style>
    <div class="toolbar">
      <span class="toolbar-text">
        ⏳ YOSO Flow 等待拾取：<strong style="white-space: nowrap">先点选等待条件</strong>（元素 / URL / <span style="white-space: nowrap">固定等待</span>），
        <span class="hint">再选择「等待说明」</span>
      </span>
      ${urlBtn}
      <button type="button" class="btn btn-timeout" data-action="timeout">⏱ 固定等待 ${timeoutSec}s</button>
      <button type="button" class="btn btn-cancel" data-action="cancel">取消</button>
    </div>
    <div id="wait-comment-actions" class="wait-comment-actions">
      <div class="wc-title">等待说明</div>
      <div class="wc-hint">与「内容提取」相同：完成上一步后请选择其一</div>
      <div class="wc-row">
        <button type="button" class="btn btn-wc-login" data-wc="login">等待登录</button>
        <button type="button" class="btn btn-wc-content" data-wc="content">等待内容加载</button>
        <button type="button" class="btn btn-wc-none" data-wc="none">无</button>
        <button type="button" class="btn btn-wc-back" data-wc="back">返回重选</button>
      </div>
    </div>
  `

  shadow.querySelector('[data-action="url"]')?.addEventListener('click', () => {
    clearPendingPickState()
    pendingBase = { choiceType: 'url', selector: '', tagName: '' }
    positionWaitCommentPanel(null)
  })
  shadow.querySelector('[data-action="timeout"]')?.addEventListener('click', () => {
    clearPendingPickState()
    pendingBase = { choiceType: 'timeout', selector: '', tagName: '' }
    positionWaitCommentPanel(null)
  })
  shadow.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    onCancelledCallback?.()
    stopWaitElementPicker()
  })

  shadow.querySelectorAll('[data-wc]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const v = (e.currentTarget as HTMLElement).getAttribute('data-wc')
      if (v === 'back') {
        clearPendingPickState()
        return
      }
      if (v === 'login' || v === 'content' || v === 'none') finalizeWaitPick(v)
    })
  })

  document.body.appendChild(pickerHost)

  highlightDiffElements(options.diffHints || [])

  hoverHighlight = document.createElement('div')
  Object.assign(hoverHighlight.style, {
    position: 'absolute',
    border: '2px dashed #3b82f6',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
    background: 'rgba(59, 130, 246, 0.08)',
  })
  document.body.appendChild(hoverHighlight)

  handleMouseMove = (e: MouseEvent) => {
    if (pendingBase) {
      if (hoverHighlight) hoverHighlight.style.display = 'none'
      return
    }
    if (pickerHost && e.composedPath().includes(pickerHost)) return
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
    if (pickerHost && e.composedPath().includes(pickerHost)) return
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

    pendingBase = { choiceType: 'element', selector, innerText, tagName, attributes: attrs }
    selectedMarker?.remove()
    selectedMarker = createSelectedMarker(target)
    document.body.appendChild(selectedMarker)
    positionWaitCommentPanel(target.getBoundingClientRect())
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancelledCallback?.()
      stopWaitElementPicker()
    }
  }

  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)
  document.addEventListener('keydown', handleKeyDown, true)
}

function highlightDiffElements(diffHints: Array<{ tagName: string; text: string }>) {
  if (diffHints.length === 0) return

  const hintLookup = new Map<string, boolean>()
  for (const h of diffHints) {
    const key = `${h.tagName}::${h.text.toLowerCase().trim().slice(0, 20)}`
    hintLookup.set(key, true)
  }

  const candidates = document.querySelectorAll('button, a[href], [role="button"], [id]')
  for (const el of candidates) {
    const tagName = el.tagName.toLowerCase()
    const text = ((el as HTMLElement).innerText ?? '').trim().slice(0, 20).toLowerCase()
    const key = `${tagName}::${text}`

    if (!hintLookup.has(key)) continue

    const marker = document.createElement('div')
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    Object.assign(marker.style, {
      position: 'absolute',
      border: '2px solid #22c55e',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '2147483645',
      background: 'rgba(34, 197, 94, 0.1)',
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(marker)
    diffMarkers.push(marker)
  }
}

export function stopWaitElementPicker(): void {
  if (handleMouseMove) document.removeEventListener('mousemove', handleMouseMove, true)
  if (handleClick) document.removeEventListener('click', handleClick, true)
  if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown, true)
  handleMouseMove = null
  handleClick = null
  handleKeyDown = null

  hoverHighlight?.remove()
  hoverHighlight = null
  selectedMarker?.remove()
  selectedMarker = null
  pendingBase = null
  pickerHost?.remove()
  pickerHost = null
  pickerShadow = null

  for (const marker of diffMarkers) marker.remove()
  diffMarkers = []

  onPickedCallback = null
  onCancelledCallback = null
  ;(window as any)[PICKER_BLOCK_FLAG] = false
}

function getPickableTarget(e: MouseEvent): Element | null {
  const target = e.target as Element | null
  if (!target) return null
  if (pickerHost && e.composedPath().includes(pickerHost)) return null
  if (pickerHost && (target === pickerHost || pickerHost.contains(target))) return null
  if (target.closest?.('#yoso-wait-picker')) return null
  if (target.classList?.contains('yoso-wait-selected-marker')) return null
  if (target.closest?.('.yoso-wait-selected-marker')) return null
  return target
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}
