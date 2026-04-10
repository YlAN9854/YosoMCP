/**
 * 等待节点的快照差量分析工具
 *
 * ElementInfo 与 PageSnapshot 定义在此处（而非 recorderStore），
 * 避免 smartWait ↔ recorderStore 的循环依赖。
 */

/** 单个页面元素的信息，用于快照差量比较与 UI 展示 */
export interface ElementInfo {
  /** 用于回溯时执行的 CSS 选择器（优先级：#id > [aria-label] > [href] > :has-text） */
  selector: string
  /** 快照差量去重键（与选择器同源但格式更规范） */
  key: string
  tagName: string
  /** 可见文本：优先取直接文本节点，回退到完整 textContent，≤40 字符 */
  text: string
  id?: string
  /** 原始 href 属性值（仅 <a> 元素） */
  href?: string
  ariaLabel?: string
}

/** 页面快照 */
export interface PageSnapshot {
  url: string
  title: string
  /** 旧版兼容：纯字符串选择器列表 */
  selectors: string[]
  /** 新版：含完整元数据的元素列表 */
  elements?: ElementInfo[]
}

export interface WaitDiff {
  duration: number
  urlChanged: boolean
  oldUrl: string
  newUrl: string
  /** 旧版兼容：新出现的选择器字符串 */
  newSelectors: string[]
  /** 新版：新出现的元素完整信息（优先使用此字段） */
  newElements: ElementInfo[]
}

export function calculateWaitDiff(
  startSnapshot: PageSnapshot,
  endSnapshot: PageSnapshot,
  startTime: number,
  endTime: number
): WaitDiff {
  const duration = endTime - startTime
  const urlChanged = startSnapshot.url !== endSnapshot.url

  // ── 新版：基于 key 的“数量差分”元素级比较 ──
  // 不能只做 Set 差集：同一个 key 在开始快照已存在时，
  // 结束快照若新增同 key 元素（例如新增一个 profile 链接）会被误判为“无新增”。
  const countByKey = (keys: string[]) => {
    const map = new Map<string, number>()
    keys.forEach((k) => map.set(k, (map.get(k) ?? 0) + 1))
    return map
  }

  const startKeyCounts = countByKey(
    startSnapshot.elements
      ? startSnapshot.elements.map(e => e.key)
      : startSnapshot.selectors
  )

  const newElements: ElementInfo[] = []
  if (endSnapshot.elements) {
    for (const el of endSnapshot.elements) {
      const rest = startKeyCounts.get(el.key) ?? 0
      if (rest > 0) {
        startKeyCounts.set(el.key, rest - 1)
      } else {
        newElements.push(el)
      }
    }
  }

  // ── 旧版兼容：字符串选择器差量 ──
  const startSelectorSet = new Set(startSnapshot.selectors)
  const newSelectors = endSnapshot.selectors.filter(s => !startSelectorSet.has(s))

  return {
    duration,
    urlChanged,
    oldUrl: startSnapshot.url,
    newUrl: endSnapshot.url,
    newSelectors,
    newElements,
  }
}

export function formatSelector(rawSelector: string): string {
  // e.g. "button:text=Login" -> "button:has-text('Login')"
  if (rawSelector.includes(':text=')) {
    const [tag, textPart] = rawSelector.split(':text=')
    if (tag && textPart) {
      return `${tag}:has-text("${textPart}")`
    }
  }
  return rawSelector
}
