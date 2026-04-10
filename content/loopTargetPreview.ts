type LoopTargetPreviewArgs = {
  fullSelector: string
  clickTargetWithinItem?: string
  index: number
  highlightMs?: number
}

type LoopTargetPreviewScanArgs = {
  fullSelector: string
  clickTargetWithinItem?: string
  maxScan: number
}

export type LoopTargetPreviewSingleResult = {
  totalCount: number
  index: number
  itemMatched: boolean
  itemVisible: boolean
  clickTargetMatched: boolean
  clickTargetVisible: boolean
  hasClickTargetWithinItem: boolean
  reason?: string
}

export type LoopTargetPreviewRow = {
  index: number
  itemMatched: boolean
  itemVisible: boolean
  clickTargetMatched: boolean
  clickTargetVisible: boolean
  hasClickTargetWithinItem: boolean
  reason?: string
}

function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el as HTMLElement)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

function createHighlightMarker(el: Element, color: string, background: string, zIndex: string): HTMLDivElement | null {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const marker = document.createElement('div')
  Object.assign(marker.style, {
    position: 'absolute',
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: `2px solid ${color}`,
    background,
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex,
  })
  document.body.appendChild(marker)
  return marker
}

function highlightElements(item: Element | null, target: Element | null, highlightMs: number) {
  const markers: HTMLDivElement[] = []
  if (item) {
    const marker = createHighlightMarker(item, '#7c3aed', 'rgba(124, 58, 237, 0.12)', '2147483645')
    if (marker) markers.push(marker)
  }
  if (target) {
    const marker = createHighlightMarker(target, '#16a34a', 'rgba(22, 163, 74, 0.15)', '2147483646')
    if (marker) markers.push(marker)
  }
  if (markers.length === 0) return
  const duration = Math.max(300, highlightMs || 2000)
  window.setTimeout(() => {
    for (const marker of markers) marker.remove()
  }, duration)
}

function queryItems(fullSelector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(fullSelector))
  } catch {
    return []
  }
}

function evaluateAtIndex(
  items: Element[],
  index: number,
  clickTargetWithinItem?: string,
  highlightMs?: number,
): LoopTargetPreviewSingleResult {
  const targetIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
  const totalCount = items.length
  const item = items[targetIndex] || null
  const hasClickTargetWithinItem = !!clickTargetWithinItem
  const itemMatched = !!item
  const itemVisible = !!item && isElementVisible(item)

  let clickTarget: Element | null = null
  let clickTargetMatched = !hasClickTargetWithinItem
  let clickTargetVisible = !hasClickTargetWithinItem
  let reason: string | undefined

  if (!item) {
    reason = 'out_of_range'
  } else if (hasClickTargetWithinItem) {
    try {
      clickTarget = item.querySelector(clickTargetWithinItem!)
      clickTargetMatched = !!clickTarget
      clickTargetVisible = !!clickTarget && isElementVisible(clickTarget)
      if (!clickTarget) reason = 'target_not_found'
    } catch {
      clickTargetMatched = false
      clickTargetVisible = false
      reason = 'invalid_target_selector'
    }
  }

  highlightElements(item, clickTarget, highlightMs || 2000)

  return {
    totalCount,
    index: targetIndex,
    itemMatched,
    itemVisible,
    clickTargetMatched,
    clickTargetVisible,
    hasClickTargetWithinItem,
    reason,
  }
}

export function testLoopTargetPreviewAtIndex(args: LoopTargetPreviewArgs): LoopTargetPreviewSingleResult {
  const items = queryItems(args.fullSelector)
  return evaluateAtIndex(items, args.index, args.clickTargetWithinItem, args.highlightMs)
}

// ===== 单元素选择器测试高亮 =====

export type SelectorHighlightResult = {
  matched: boolean
  visible: boolean
  tagName?: string
  innerText?: string
}

export function testSelectorHighlight(
  selector: string,
  highlightMs = 2000,
): SelectorHighlightResult {
  let el: Element | null = null
  try {
    el = document.querySelector(selector)
  } catch {
    return { matched: false, visible: false }
  }
  if (!el) return { matched: false, visible: false }

  const visible = isElementVisible(el)
  if (visible) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' })
  }
  const marker = createHighlightMarker(el, '#3b82f6', 'rgba(59, 130, 246, 0.15)', '2147483645')
  if (marker) {
    window.setTimeout(() => marker.remove(), Math.max(300, highlightMs))
  }

  return {
    matched: true,
    visible,
    tagName: el.tagName.toLowerCase(),
    innerText: (el.textContent ?? '').trim().slice(0, 60) || undefined,
  }
}

export function scanLoopTargetPreview(args: LoopTargetPreviewScanArgs): {
  totalCount: number
  rows: LoopTargetPreviewRow[]
} {
  const items = queryItems(args.fullSelector)
  const maxScan = Math.max(0, Math.floor(args.maxScan || 0))
  const cap = Math.min(maxScan, items.length)
  const rows: LoopTargetPreviewRow[] = []
  for (let i = 0; i < cap; i++) {
    const row = evaluateAtIndex(items, i, args.clickTargetWithinItem, 0)
    rows.push({
      index: row.index,
      itemMatched: row.itemMatched,
      itemVisible: row.itemVisible,
      clickTargetMatched: row.clickTargetMatched,
      clickTargetVisible: row.clickTargetVisible,
      hasClickTargetWithinItem: row.hasClickTargetWithinItem,
      reason: row.reason,
    })
  }
  return {
    totalCount: items.length,
    rows,
  }
}
