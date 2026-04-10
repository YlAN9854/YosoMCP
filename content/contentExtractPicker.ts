import type { ContentExtractPickedResult } from '@/types/contentExtract'

let pickerHost: HTMLElement | null = null
let hoverHighlight: HTMLElement | null = null
let selectedMarker: HTMLElement | null = null
let selectedElement: Element | null = null
let onPickedCallback: ((result: ContentExtractPickedResult) => void) | null = null
let onCancelledCallback: (() => void) | null = null
const PICKER_BLOCK_FLAG = '__YOSO_BLOCK_RECORDING_INTERACTIONS__'

let handleMouseMove: ((e: MouseEvent) => void) | null = null
let handleClick: ((e: MouseEvent) => void) | null = null
let handleKeyDown: ((e: KeyboardEvent) => void) | null = null

export function startContentExtractPicker(
  onPicked: (result: ContentExtractPickedResult) => void,
  onCancelled?: () => void,
): void {
  if (pickerHost) {
    stopContentExtractPicker()
  }

  onPickedCallback = onPicked
  onCancelledCallback = onCancelled || null
  ;(window as any)[PICKER_BLOCK_FLAG] = true

  pickerHost = document.createElement('div')
  pickerHost.id = 'yoso-content-extract-picker'
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
      .toolbar-text {
        flex: 1;
      }
      .actions {
        position: fixed;
        z-index: 2147483647;
        display: none;
        gap: 6px;
        background: rgba(17, 24, 39, 0.96);
        border: 1px solid #374151;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      }
      .btn {
        border: none;
        border-radius: 6px;
        color: #fff;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
      }
      .btn-text { background: #2563eb; }
      .btn-shot { background: #7c3aed; }
      .btn-cancel { background: #dc2626; }
      .hint {
        color: #9ca3af;
      }
    </style>
    <div class="toolbar">
      <span class="toolbar-text">YOSO 内容提取：先点击页面元素，再选择“提取文本”或“获取元素截图”</span>
      <span class="hint">ESC 取消</span>
    </div>
    <div id="actions" class="actions">
      <button class="btn btn-text" id="btn-text">提取文本</button>
      <button class="btn btn-shot" id="btn-shot">获取元素截图</button>
      <button class="btn btn-cancel" id="btn-cancel">取消</button>
    </div>
  `

  document.body.appendChild(pickerHost)

  hoverHighlight = document.createElement('div')
  Object.assign(hoverHighlight.style, {
    position: 'absolute',
    border: '2px dashed #22c55e',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
  })
  document.body.appendChild(hoverHighlight)

  const actions = shadow.getElementById('actions') as HTMLElement
  const btnText = shadow.getElementById('btn-text') as HTMLButtonElement
  const btnShot = shadow.getElementById('btn-shot') as HTMLButtonElement
  const btnCancel = shadow.getElementById('btn-cancel') as HTMLButtonElement

  btnText.addEventListener('click', () => {
    if (!selectedElement) return
    onPickedCallback?.({
      selector: buildCssSelector(selectedElement),
      extractMode: 'text',
      extractedText: selectedElement.textContent?.trim() || '',
    })
    stopContentExtractPicker()
  })

  btnShot.addEventListener('click', () => {
    if (!selectedElement) return
    const selector = buildCssSelector(selectedElement)
    const rect = selectedElement.getBoundingClientRect()
    const callback = onPickedCallback
    stopContentExtractPicker()

    captureElementScreenshot(rect).then(dataUrl => {
      callback?.({
        selector,
        extractMode: 'screenshot',
        extractedScreenshot: dataUrl ?? undefined,
      })
    })
  })

  btnCancel.addEventListener('click', () => {
    onCancelledCallback?.()
    stopContentExtractPicker()
  })

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

    selectedElement = target
    selectedMarker?.remove()
    selectedMarker = createSelectedMarker(target)
    document.body.appendChild(selectedMarker)

    const rect = target.getBoundingClientRect()
    const panelTop = Math.max(8, rect.top + window.scrollY - 46)
    const panelLeft = Math.max(8, rect.left + window.scrollX)
    Object.assign(actions.style, {
      display: 'flex',
      top: `${panelTop}px`,
      left: `${panelLeft}px`,
    })
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancelledCallback?.()
      stopContentExtractPicker()
    }
  }

  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('click', handleClick, true)
  document.addEventListener('keydown', handleKeyDown, true)
}

export function stopContentExtractPicker(): void {
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
  selectedElement = null
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
  if (target.closest?.('#yoso-content-extract-picker')) return null
  if (target.classList?.contains('yoso-content-extract-marker')) return null
  if (target.closest?.('.yoso-content-extract-marker')) return null
  return target
}

function createSelectedMarker(target: Element): HTMLElement {
  const rect = target.getBoundingClientRect()
  const marker = document.createElement('div')
  marker.className = 'yoso-content-extract-marker'
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

function buildCssSelector(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  let depth = 0

  while (current && current !== document.body && depth < 6) {
    const tag = current.tagName.toLowerCase()
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`)
      break
    }

    const classNames = Array.from(current.classList).slice(0, 2)
    if (classNames.length > 0) {
      parts.unshift(`${tag}.${classNames.map(c => CSS.escape(c)).join('.')}`)
    } else {
      const parent = current.parentElement
      if (!parent) {
        parts.unshift(tag)
      } else {
        const sameTags = Array.from(parent.children).filter(el => el.tagName === current!.tagName)
        if (sameTags.length > 1) {
          const idx = sameTags.indexOf(current) + 1
          parts.unshift(`${tag}:nth-of-type(${idx})`)
        } else {
          parts.unshift(tag)
        }
      }
    }

    current = current.parentElement
    depth++
  }

  return parts.join(' > ')
}

/**
 * 向 Background 请求捕获当前可见标签页截图，并裁剪到指定元素的 DOMRect 范围。
 * 返回裁剪后的 base64 data URL，失败时返回 null。
 */
async function captureElementScreenshot(rect: DOMRect): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CS_CAPTURE_VISIBLE_TAB' }) as {
      success: boolean
      data?: { dataUrl: string }
    }
    if (!response?.success || !response.data?.dataUrl) return null

    const img = await loadImage(response.data.dataUrl)
    const dpr = window.devicePixelRatio || 1

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(
      img,
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr),
      0,
      0,
      canvas.width,
      canvas.height,
    )

    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
