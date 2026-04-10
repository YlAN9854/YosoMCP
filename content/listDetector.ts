// 列表元素位置检测 — 用于循环分析

import { generateSelector } from './selectorGenerator'

export function detectListPosition(element: Element): {
  elementIndex: number
  parentSelector: string
} | null {
  const parent = element.parentElement
  if (!parent) return null

  const siblings = Array.from(parent.children)
  const sameTagSiblings = siblings.filter(s => s.tagName === element.tagName)

  // ≥2 即可：筛选行常见「不限 + 若干项」，需 parentSelector+elementIndex 辅助区分同名选项
  if (sameTagSiblings.length >= 2) {
    return {
      elementIndex: sameTagSiblings.indexOf(element),
      parentSelector: generateSelector(parent),
    }
  }

  return null
}
