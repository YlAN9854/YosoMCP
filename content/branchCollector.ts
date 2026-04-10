// 分支候选元素采集
//
// 改进：与方案1循环检测（signature.ts normalizeSelector）保持一致的同级识别逻辑。
// 方案1通过将 :nth-child(N) 归一化来判断两次点击是否指向"同类列表项"；
// 本模块同样从被点击元素向上遍历 DOM，找到真正的"列表项"层级后再采集同级候选，
// 而不是仅看直接父元素——避免用户点击卡片内子元素时采集到错误的候选集。

import type { BranchCandidate } from '@/types/action'
import { generateSelector } from './selectorGenerator'

/** 向上遍历 DOM 的最大层数 */
const MAX_WALK_DEPTH = 5
/** 触发列表项层级识别的最小同类兄弟数量（含自身） */
const MIN_LIST_SIZE = 2
/** 最多返回的候选节点数 */
const MAX_CANDIDATES = 10

/**
 * 采集与被点击元素同级的候选节点。
 *
 * 从 clickedElement 开始向上遍历，在每一层检查父元素是否包含
 * 足够数量（≥ MIN_LIST_SIZE）的同 tagName 兄弟。找到该"列表项层级"后：
 * - 采集至多 MAX_CANDIDATES 个兄弟节点
 * - 若 clickedElement 是列表项的内部子元素，记录从列表项到点击目标的
 *   相对路径，用于提取更有代表性的文本和属性
 */
export function collectBranchCandidates(clickedElement: Element): BranchCandidate[] {
  let current: Element = clickedElement

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const parent = current.parentElement
    if (!parent || parent === document.body || parent === document.documentElement) break

    const allChildren = Array.from(parent.children)
    const sameSiblings = allChildren.filter(
      el => el.tagName === current.tagName && el !== current,
    )

    // 找到足够多同类兄弟 → 确认为列表项层级
    if (sameSiblings.length >= MIN_LIST_SIZE - 1) {
      const candidates = sameSiblings.slice(0, MAX_CANDIDATES)
      const parentSelector = generateSelector(parent)

      // 若已上溯，记录从列表项到原始点击目标的相对路径
      const relSelector =
        current !== clickedElement
          ? buildRelativeSelector(current, clickedElement)
          : undefined

      return candidates.map(el => {
        // 优先获取等效子元素（与原始点击目标在结构上对应的元素）的文本和属性
        const representativeEl = relSelector ? tryQueryDescendant(el, relSelector) ?? el : el

        return {
          selector: generateSelector(el),
          tagName: el.tagName.toLowerCase(),
          innerText: representativeEl.textContent?.trim().slice(0, 50),
          attributes: getKeyAttributes(representativeEl),
          elementIndex: allChildren.indexOf(el),
          parentSelector,
        }
      })
    }

    current = current.parentElement!
  }

  // 未找到合适层级（点击的是唯一元素或孤立元素）→ 返回空
  return []
}

/**
 * 构建从 ancestor 到 descendant 的相对 CSS 路径。
 * 每层优先用静态类名，否则用 nth-of-type 定位。
 * 与 selectorPatternInfer.ts 中的 getRelativeSelector 逻辑一致。
 */
function buildRelativeSelector(ancestor: Element, descendant: Element): string | undefined {
  const parts: string[] = []
  let node: Element | null = descendant

  while (node && node !== ancestor) {
    const tag = node.tagName.toLowerCase()
    const classes = Array.from(node.classList)
      .filter(c => !isDynamicClass(c))
      .slice(0, 2)

    if (classes.length > 0) {
      parts.unshift(`${tag}.${classes.map(c => CSS.escape(c)).join('.')}`)
    } else {
      const par = node.parentElement
      if (par) {
        const sameTagSiblings = Array.from(par.children).filter(s => s.tagName === node!.tagName)
        if (sameTagSiblings.length > 1) {
          parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`)
        } else {
          parts.unshift(tag)
        }
      } else {
        parts.unshift(tag)
      }
    }

    node = node.parentElement
  }

  return parts.length > 0 ? parts.join(' > ') : undefined
}

/** 在候选列表项内按相对路径查找等效子元素 */
function tryQueryDescendant(listItemEl: Element, relSelector: string): Element | null {
  try {
    return listItemEl.querySelector(relSelector)
  } catch {
    return null
  }
}

/** 过滤动态类名（CSS-in-JS hash、模块化后缀等） */
function isDynamicClass(cls: string): boolean {
  return /^[a-z]{1,3}-[a-f0-9]{6,}|__[a-z0-9]{5,}|^css-|^_/i.test(cls)
}

function getKeyAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const key of ['href', 'type', 'role', 'data-testid', 'aria-label', 'name']) {
    const val = el.getAttribute(key)
    if (val) attrs[key] = val
  }
  return attrs
}
