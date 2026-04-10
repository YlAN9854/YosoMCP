// 选择器模式推断算法
// 根据用户选中的多个同类元素，推断出一个通用的 CSS 选择器模式

import type { LoopTargetPattern } from '@/types/operationTree'
import type { SelectorPatternResult, DOMPathSegment } from '@/types/selectorPicker'
/**
 * 从原始元素和用户手动选中的元素推断选择器模式。
 * 所有参数都是实际 DOM Element，因此本模块必须在 Content Script 中运行。
 */
export function inferSelectorPattern(
  originalElement: Element,
  pickedElements: Element[],
): SelectorPatternResult {
  const allElements = [originalElement, ...pickedElements]

  if (allElements.length < 2) {
    return { success: false, error: '至少需要 2 个元素来推断模式' }
  }

  try {
    // Step 1: 找最低公共祖先
    const lca = findLCA(allElements)
    if (!lca || lca === document.documentElement) {
      return { success: false, error: '无法找到有意义的公共祖先' }
    }

    // Step 2: 计算每个元素到 LCA 的路径，定位分叉层级
    const paths = allElements.map(el => getPathFromAncestor(lca, el))
    const divergeLevel = findDivergenceLevel(paths)

    if (divergeLevel < 0) {
      return { success: false, error: '无法定位元素分叉层级' }
    }

    // Step 3: 提取分叉层级节点的共同特征
    const divergeNodes = paths.map(p => p[divergeLevel])
    const features = extractCommonFeatures(divergeNodes)

    if (!features) {
      return { success: false, error: '分叉层级节点无共同特征' }
    }

    // Step 4: 组装选择器
    const containerSelector = buildStableSelector(lca)
    const itemSelector = buildItemSelector(features)

    // Step 5: 验证 — 先尝试直接子代，再尝试后代
    let fullSelector = `${containerSelector} > ${itemSelector}`
    let matchCount = safeQueryCount(fullSelector)

    if (matchCount < allElements.length) {
      fullSelector = `${containerSelector} ${itemSelector}`
      matchCount = safeQueryCount(fullSelector)
    }

    if (matchCount < allElements.length) {
      // 放松约束：减少类名
      const relaxedItemSelector = buildItemSelector(features, true)
      fullSelector = `${containerSelector} ${relaxedItemSelector}`
      matchCount = safeQueryCount(fullSelector)
    }

    if (matchCount < 2) {
      return { success: false, error: `选择器 "${fullSelector}" 匹配数量不足 (${matchCount})` }
    }

    // 验证所有选中元素都被匹配（精确匹配或作为 matched 元素的后代）
    const matched = safeQueryAll(fullSelector)
    const notCovered: string[] = []
    allElements.forEach((el, i) => {
      const exactMatch = matched.includes(el)
      // 用户可能点击了列表项内部的子元素（如 <a>），此时元素是 matched 项的后代
      const descendantMatch = !exactMatch && matched.some(m => m.contains(el))
      if (!exactMatch && !descendantMatch) {
        notCovered.push(`元素[${i}] ${describeEl(el)}`)
      }
    })
    if (notCovered.length > 0) {
      return { success: false, error: '推断的选择器未能覆盖所有选中元素' }
    }

    // Step 6: 计算 clickTargetWithinItem（原始元素可能是 item 的子元素）
    const itemOfOriginal = divergeNodes[0]
    const clickTargetWithinItem = originalElement !== itemOfOriginal
      ? getRelativeSelector(itemOfOriginal, originalElement)
      : undefined

    // 采集前几个元素的文本摘要
    const sampleTexts = matched.slice(0, 5).map(
      el => el.textContent?.trim().slice(0, 40) || ''
    ).filter(Boolean)

    const pattern: LoopTargetPattern = {
      containerSelector,
      itemSelector,
      fullSelector,
      matchCount,
      clickTargetWithinItem,
      sampleTexts,
    }

    return { success: true, pattern }
  } catch (err) {
    return { success: false, error: `推断失败: ${(err as Error).message}` }
  }
}

/**
 * 找到一组元素的最低公共祖先 (Lowest Common Ancestor)
 */
function findLCA(elements: Element[]): Element | null {
  if (elements.length === 0) return null
  if (elements.length === 1) return elements[0].parentElement

  const getAncestors = (el: Element): Element[] => {
    const ancestors: Element[] = []
    let current: Element | null = el
    while (current) {
      ancestors.unshift(current)
      current = current.parentElement
    }
    return ancestors
  }

  const ancestorChains = elements.map(getAncestors)
  const minLen = Math.min(...ancestorChains.map(c => c.length))

  let lca: Element | null = null
  for (let i = 0; i < minLen; i++) {
    const candidate = ancestorChains[0][i]
    if (ancestorChains.every(chain => chain[i] === candidate)) {
      lca = candidate
    } else {
      break
    }
  }

  return lca
}

/**
 * 获取从 ancestor 到 target 的 DOM 路径（不含 ancestor 本身）
 */
function getPathFromAncestor(ancestor: Element, target: Element): Element[] {
  const path: Element[] = []
  let current: Element | null = target
  while (current && current !== ancestor) {
    path.unshift(current)
    current = current.parentElement
  }
  return path
}

/**
 * 在多条路径中找到第一个分叉层级的索引。
 * 分叉层级 = 路径中第一个不同元素出现的深度。
 */
function findDivergenceLevel(paths: Element[][]): number {
  if (paths.length < 2) return 0

  const minLen = Math.min(...paths.map(p => p.length))
  for (let level = 0; level < minLen; level++) {
    const ref = paths[0][level]
    if (!paths.every(p => p[level] === ref)) {
      return level
    }
  }

  // 路径完全相同（理论上不应发生）
  return -1
}

interface CommonFeatures {
  tagName: string
  classNames: string[]
  attributes: Record<string, string>
}

/**
 * 从分叉层级的多个节点中提取共同特征
 */
function extractCommonFeatures(elements: Element[]): CommonFeatures | null {
  if (elements.length === 0) return null

  // 标签名必须全部相同
  const tags = new Set(elements.map(el => el.tagName.toLowerCase()))
  if (tags.size !== 1) return null

  const tagName = elements[0].tagName.toLowerCase()

  // 类名取交集，过滤动态类名
  const classLists = elements.map(el =>
    Array.from(el.classList).filter(c => !isDynamicClass(c))
  )
  const classNames = intersectArrays(classLists)

  // 结构性属性取交集
  const structuralAttrs = ['role', 'data-type', 'data-v-']
  const attributes: Record<string, string> = {}
  for (const attr of structuralAttrs) {
    const vals = elements.map(el => el.getAttribute(attr)).filter(Boolean) as string[]
    if (vals.length === elements.length) {
      const uniqueVals = new Set(vals)
      if (uniqueVals.size === 1) {
        attributes[attr] = vals[0]
      }
    }
  }

  return { tagName, classNames, attributes }
}

/**
 * 为 LCA 容器生成一个稳定的选择器
 */
function buildStableSelector(element: Element): string {
  // 优先使用 id
  if (element.id && !isDynamicId(element.id)) {
    return `#${CSS.escape(element.id)}`
  }

  // 尝试 data-testid
  const testId = element.getAttribute('data-testid')
  if (testId) return `[data-testid="${escapeAttrValue(testId)}"]`

  // 尝试 aria-label
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${escapeAttrValue(ariaLabel)}"]`

  // 使用 tag + 静态 class 组合
  const tag = element.tagName.toLowerCase()
  const classes = Array.from(element.classList)
    .filter(c => !isDynamicClass(c))
    .slice(0, 3)

  if (classes.length > 0) {
    const selector = `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`
    if (safeQueryCount(selector) === 1) return selector
  }

  // 兜底：层级选择器（最多上溯 3 层）
  return buildHierarchicalSelector(element, 3)
}

/**
 * 从共同特征构建 item 选择器
 */
function buildItemSelector(features: CommonFeatures, relaxed = false): string {
  const parts: string[] = [features.tagName]

  const classes = relaxed ? features.classNames.slice(0, 1) : features.classNames
  if (classes.length > 0) {
    parts.push(`.${classes.map(c => CSS.escape(c)).join('.')}`)
  }

  for (const [attr, val] of Object.entries(features.attributes)) {
    if (!relaxed) {
      parts.push(`[${attr}="${escapeAttrValue(val)}"]`)
    }
  }

  return parts.join('')
}

/**
 * 计算 target 相对于 ancestor 的选择器路径。
 * 用于确定 clickTargetWithinItem。
 */
function getRelativeSelector(ancestor: Element, target: Element): string | undefined {
  if (ancestor === target) return undefined

  const path: string[] = []
  let current: Element | null = target

  while (current && current !== ancestor) {
    const tag = current.tagName.toLowerCase()
    const classes = Array.from(current.classList)
      .filter(c => !isDynamicClass(c))
      .slice(0, 2)

    if (classes.length > 0) {
      path.unshift(`${tag}.${classes.map(c => CSS.escape(c)).join('.')}`)
    } else {
      const parent = current.parentElement
      if (parent) {
        const sameTagSiblings = Array.from(parent.children)
          .filter(s => s.tagName === current!.tagName)
        if (sameTagSiblings.length > 1) {
          const idx = sameTagSiblings.indexOf(current) + 1
          path.unshift(`${tag}:nth-of-type(${idx})`)
        } else {
          path.unshift(tag)
        }
      } else {
        path.unshift(tag)
      }
    }

    current = current.parentElement
  }

  return path.length > 0 ? path.join(' > ') : undefined
}

/**
 * 构建层级选择器（最多上溯 maxDepth 层）
 */
function buildHierarchicalSelector(element: Element, maxDepth: number): string {
  const parts: string[] = []
  let current: Element | null = element
  let depth = 0

  while (current && depth < maxDepth) {
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
    .filter(c => !isDynamicClass(c))
    .slice(0, 2)

  if (classes.length > 0) {
    return `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`
  }

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

// ===== 工具函数 =====

function isDynamicId(id: string): boolean {
  return /[-_]\d{4,}|^el-|^rc-|^[a-f0-9]{8,}$/i.test(id)
}

function isDynamicClass(cls: string): boolean {
  return /^[a-z]{1,3}-[a-f0-9]{6,}|__[a-z0-9]{5,}|^css-|^_/i.test(cls)
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function intersectArrays(arrays: string[][]): string[] {
  if (arrays.length === 0) return []
  return arrays[0].filter(item => arrays.every(arr => arr.includes(item)))
}

function safeQueryCount(selector: string): number {
  try {
    return document.querySelectorAll(selector).length
  } catch {
    return 0
  }
}

function safeQueryAll(selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    return []
  }
}

/** 简短描述一个 DOM 元素，用于调试日志 */
function describeEl(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = Array.from(el.classList).slice(0, 3).map(c => `.${c}`).join('')
  const text = el.textContent?.trim().slice(0, 20) || ''
  return `<${tag}${id}${cls}>${text ? ` "${text}"` : ''}`
}
