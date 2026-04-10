// 选择器生成器 — 为 DOM 元素生成稳定的 CSS 选择器

/**
 * 转义 CSS 属性值选择器中的特殊字符（引号内使用，不转义空格）
 */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function generateSelector(element: Element): string {
  // 1. 尝试 data-testid
  const testId = element.getAttribute('data-testid')
  if (testId) return `[data-testid="${escapeAttrValue(testId)}"]`

  // 2. 尝试 id（排除动态 ID）
  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`
  }

  // 3. 尝试 aria-label
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${escapeAttrValue(ariaLabel)}"]`

  // 4. 基于 class 的唯一选择器
  const classSelector = buildClassSelector(element)
  if (classSelector) return classSelector

  // 5. 层级选择器（兜底）
  return buildHierarchicalSelector(element)
}

function isDynamicId(id: string): boolean {
  return /[-_]\d{4,}|^el-|^rc-|^[a-f0-9]{8,}$/i.test(id)
}

function buildClassSelector(element: Element): string | null {
  if (!element.classList.length) return null

  const tag = element.tagName.toLowerCase()
  const classes = Array.from(element.classList)
    .filter(c => !isDynamicClass(c) && !isTransientStateClass(c))
    .slice(0, 3)

  if (!classes.length) return null

  const selector = `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`

  // 验证唯一性
  try {
    const matches = document.querySelectorAll(selector)
    if (matches.length === 1) return selector
  } catch {
    // 选择器无效
  }

  return null
}

function isDynamicClass(cls: string): boolean {
  return /^[a-z]{1,3}-[a-f0-9]{6,}|__[a-z0-9]{5,}|^css-/i.test(cls)
}

// 瞬态状态 class：仅在交互时存在（聚焦、悬停、激活等），不应出现在选择器中，
// 否则回放时因元素不处于该状态而导致选择器失效
function isTransientStateClass(cls: string): boolean {
  return /[-_](focused|active|hover|selected|open|expanded|pressed|checked|visited|disabled|dragging|loading|animating)$/i.test(cls)
    || /^(focused|active|hover|is-focused|is-active|is-selected|is-open|is-expanded)$/i.test(cls)
    || /^(Mui-focused|Mui-active|Mui-selected|Mui-error|Mui-disabled)$/.test(cls)
}

function buildHierarchicalSelector(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  let depth = 0

  while (current && depth < 3) {
    const part = getElementPart(current)
    parts.unshift(part)
    current = current.parentElement
    depth++
  }

  return parts.join(' > ')
}

function getElementPart(element: Element): string {
  const tag = element.tagName.toLowerCase()

  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`
  }

  const classes = Array.from(element.classList)
    .filter(c => !isDynamicClass(c) && !isTransientStateClass(c))
    .slice(0, 2)

  if (classes.length) {
    return `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`
  }

  // nth-of-type 兜底（:nth-child 按全部子节点计数，此处应按同标签计数）
  const parent = element.parentElement
  if (parent) {
    const siblings = Array.from(parent.children).filter(s => s.tagName === element.tagName)
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1
      return `${tag}:nth-of-type(${index})`
    }
  }

  return tag
}

/**
 * 若当前选择器匹配多个元素，返回 `target` 在 `querySelectorAll` 文档顺序中的下标；否则返回 `undefined`（单匹配无需记录）。
 * 仅适用于标准 CSS，与 {@link generateSelector} 输出一致。
 */
export function computeSelectorMatchIndex(selector: string, target: Element): number | undefined {
  try {
    const matches = document.querySelectorAll(selector)
    if (matches.length <= 1) return undefined
    const idx = Array.from(matches).indexOf(target)
    return idx >= 0 ? idx : undefined
  } catch {
    return undefined
  }
}
