// Content Script 重放执行器 — 在目标页面上执行单个操作

import type { RecordedAction } from '@/types/action'
import { CS_MSG } from '@/types/message'

interface ExecuteActionResult {
  success: boolean
  error?: string
  data?: Record<string, unknown>
}

const ELEMENT_WAIT_TIMEOUT = 10_000
const ELEMENT_WAIT_INTERVAL = 200
/** hover 等待元素的超时（略短）：若因点击导致元素已消失，快速跳过该步避免长时间阻塞） */
const HOVER_WAIT_TIMEOUT = 3_000
const UPLOAD_WAIT_TIMEOUT = 30_000

/**
 * 提取元素的直接文本节点内容（不含子元素文本），归一化空白。
 * 用于 :has-text 精确匹配，避免把"含有该文本的祖先"误认为目标元素。
 */
function getDirectText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 查找元素（支持 :has-text 伪类）
 *
 * 两阶段匹配策略：
 *   Phase 1 — 直接文本精确匹配：
 *     仅比较元素自身的直接文本节点（不含子元素）。
 *     "我" 这样的导航链接通常把文字直接放在 <a> 内，
 *     而帖子标题、作者名等把文字嵌在 <span> 里，Phase 1 不会误命中后者。
 *   Phase 2 — 全文本 includes（原有行为）：
 *     兜底兼容旧录制（文本截断到 20 字）或文本全在子元素里的情况。
 */
function findElement(selector: string): Element | null {
  const all = findAllElements(selector)
  return all[0] ?? null
}

/** 与 {@link findElement} 相同匹配规则，返回全部命中（文档顺序），供 `selectorMatchIndex` 选取 */
function findAllElements(selector: string): Element[] {
  const hasTextMatch = selector.match(/^([a-z0-9]+):has-text\("(.+)"\)$/i)
  if (hasTextMatch) {
    const [, tagName, text] = hasTextMatch
    const elements = document.getElementsByTagName(tagName)
    const out: Element[] = []
    const seen = new Set<Element>()

    for (const el of elements) {
      if (getDirectText(el) === text) {
        out.push(el)
        seen.add(el)
      }
    }
    for (const el of elements) {
      if (!seen.has(el) && el.textContent?.includes(text)) {
        out.push(el)
        seen.add(el)
      }
    }
    return out
  }

  try {
    return selector ? Array.from(document.querySelectorAll(selector)) : []
  } catch {
    return []
  }
}

/**
 * 按录制时的 `selectorMatchIndex` 在「原始选择器 → 宽松选择器 → 最末段」链路上解析元素。
 */
function pickElementWithIndex(selector: string, selectorMatchIndex: number): Element | null {
  if (selectorMatchIndex < 0) return null

  const tryList = (list: Element[]): Element | null =>
    list.length > selectorMatchIndex ? list[selectorMatchIndex]! : null

  let hit = tryList(findAllElements(selector))
  if (hit) return hit

  const relaxed = relaxSelector(selector)
  if (relaxed !== selector) {
    hit = tryList(findAllElements(relaxed))
    if (hit) return hit
  }

  const lastPart = relaxed.split(/\s*>\s*|\s+/).pop() ?? ''
  if (lastPart && lastPart !== selector && lastPart !== relaxed) {
    hit = tryList(findAllElements(lastPart))
    if (hit) return hit
  }

  return null
}

/**
 * 归一化文本：折叠各类空白字符（含不换行空格 \u00A0、零宽字符 \u200B 等），
 * 使跨浏览器/平台的文本比较更可靠。
 */
function normalizeText(text: string): string {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 判断两段文本是否"语义匹配"：
 * - 精确相等
 * - 一方是另一方的前缀（应对录制时 slice(0,100) 的截断）
 * 注意：只有 refText 非空时才做前缀比较，避免空字符串的假阳性。
 */
function textMatches(elText: string, recorded: string): boolean {
  if (!elText || !recorded) return false
  if (elText === recorded) return true
  // 元素文本更长（如含角标数字）：recorded 是前缀
  if (elText.startsWith(recorded)) return true
  // 录制文本更长（理论上不会，因为我们 slice 的是录制值）：elText 是前缀
  if (elText.length > 0 && recorded.startsWith(elText)) return true
  return false
}

/**
 * 构建宽松选择器：剥离所有位置伪类（:nth-child / :nth-of-type），
 * 与方案1循环检测 signature.ts normalizeSelector 的思路一致——
 * 位置索引是不稳定的，剥除后相同结构路径才是同类元素的真正标识。
 */
function relaxSelector(selector: string): string {
  return selector
    .replace(/:nth-child\(\d+\)/g, '')
    .replace(/:nth-of-type\(\d+\)/g, '')
    .trim()
}

function querySafe(selector: string): Element[] {
  try {
    return selector ? Array.from(document.querySelectorAll(selector)) : []
  } catch {
    return []
  }
}

/** 判断元素是否可见（非 display:none、visibility:hidden，且尺寸非零） */
function isElementVisible(el: Element): boolean {
  if (!el.isConnected) return false
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el as HTMLElement)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

/** 在多个匹配中优先返回可见元素（用于模态框等存在重复 DOM 结构的场景） */
function findElementPreferVisible(selector: string, selectorMatchIndex?: number): Element | null {
  const gather = (): Element[] => {
    const raw = querySafe(selector)
    if (raw.length > 0) return raw
    const relaxed = relaxSelector(selector)
    const full = querySafe(relaxed)
    if (full.length > 0) return full
    const lastPart = relaxed.split(/\s*>\s*|\s+/).pop() ?? ''
    return querySafe(lastPart)
  }

  const all = gather()
  if (all.length === 0) return null

  if (
    typeof selectorMatchIndex === 'number'
    && selectorMatchIndex >= 0
    && selectorMatchIndex < all.length
  ) {
    const at = all[selectorMatchIndex]!
    if (isElementVisible(at)) return at
  }

  const visible = all.find(isElementVisible)
  return visible ?? all[0]
}

/**
 * 获取宽松选择器下的所有候选元素：
 * 先用完整宽松路径，无结果再退到最末段（去掉祖先路径限制）。
 */
function getCandidates(selector: string): Element[] {
  const relaxed = relaxSelector(selector)
  const full = querySafe(relaxed)
  if (full.length > 0) return full

  const lastPart = relaxed.split(/\s*>\s*|\s+/).pop() ?? ''
  return querySafe(lastPart)
}

function findByParentAndIndex(action: RecordedAction): Element | null {
  if (!action.parentSelector || typeof action.elementIndex !== 'number' || action.elementIndex < 0) return null
  const parent = querySafe(action.parentSelector)[0]
  if (!parent) return null

  const sameTagSiblings = Array.from(parent.children).filter(
    child => child.tagName.toLowerCase() === (action.tagName || '').toLowerCase(),
  )
  const byTagIndex = sameTagSiblings[action.elementIndex] ?? null
  if (byTagIndex) return byTagIndex

  return parent.children[action.elementIndex] ?? null
}

function hasIdentitySignal(action: RecordedAction): boolean {
  const attrs = action.attributes ?? {}
  const attrNames = ['href', 'aria-label', 'placeholder', 'type', 'name', 'role']
  if (normalizeText(action.innerText ?? '')) return true
  if ((action.tagName ?? '').trim()) return true
  return attrNames.some(name => Boolean(attrs[name]))
}

function matchesActionSignature(element: Element, action: RecordedAction): boolean {
  const recordedTag = (action.tagName ?? '').toLowerCase()
  if (recordedTag && element.tagName.toLowerCase() !== recordedTag) {
    return false
  }

  const attrs = action.attributes ?? {}
  const attrNames = ['placeholder', 'type', 'name', 'role']
  for (const name of attrNames) {
    const recorded = attrs[name]
    if (!recorded) continue
    const actual = element.getAttribute(name)
    if (!actual) return false
    if (normalizeText(actual) !== normalizeText(recorded)) return false
  }

  const recordedHref = attrs['href']
  if (recordedHref) {
    const elHref = element.getAttribute('href')
    if (!elHref) return false
    if (!(elHref === recordedHref || elHref.endsWith(recordedHref) || recordedHref.endsWith(elHref))) {
      return false
    }
  }

  const recordedAria = attrs['aria-label']
  if (recordedAria && element.getAttribute('aria-label') !== recordedAria) {
    return false
  }

  const recordedText = normalizeText(action.innerText ?? '')
  if (recordedText) {
    const elText = normalizeText(element.textContent ?? '')
    if (!textMatches(elText, recordedText)) return false
  }

  return true
}

/**
 * 在候选集中按多种信号寻找最匹配的元素，优先级：
 *   1. href 属性（最稳定，导航链接的 href 不随 UI 变化而变）
 *   2. aria-label 属性（语义化标识）
 *   3. 文本内容（归一化后精确或前缀匹配）
 */
function findBestMatch(candidates: Element[], action: RecordedAction): Element | null {
  if (candidates.length === 0) return null

  // 信号 1：href（适用于 <a> 导航链接，如小红书侧边栏）
  const recordedHref = action.attributes?.['href']
  if (recordedHref) {
    const byHref = candidates.find(el => {
      const elHref = el.getAttribute('href')
      if (!elHref) return false
      // 绝对路径 vs 相对路径互相包含时也视为匹配
      return elHref === recordedHref || elHref.endsWith(recordedHref) || recordedHref.endsWith(elHref)
    })
    if (byHref) return byHref
  }

  // 信号 2：aria-label
  const recordedAria = action.attributes?.['aria-label']
  if (recordedAria) {
    const byAria = candidates.find(el => el.getAttribute('aria-label') === recordedAria)
    if (byAria) return byAria
  }

  // 信号 3：文本内容
  const recordedText = normalizeText(action.innerText ?? '')
  if (recordedText) {
    const byText = candidates.find(el => textMatches(normalizeText(el.textContent ?? ''), recordedText))
    if (byText) return byText
  }

  return null
}

/**
 * 解析最终的点击目标元素。
 *
 * 先用 CSS 选择器找到候选，再用 href / aria-label / innerText 验证；
 * 信号不匹配时（如因位置索引失效定位到了错误元素），
 * 自动剥离位置伪类后在宽松候选集中重新匹配，避免点击错误元素。
 */
function countSignatureMatchesInCandidates(action: RecordedAction): number {
  return getCandidates(action.selector).filter(c => matchesActionSignature(c, action)).length
}

/** 同名文案多匹配且未录制 selectorMatchIndex 时，不能把 querySelector 的第一个命中当作已验证目标 */
function isAmbiguousTextOnlyMatch(action: RecordedAction): boolean {
  if (typeof action.selectorMatchIndex === 'number' && action.selectorMatchIndex >= 0) return false
  return countSignatureMatchesInCandidates(action) > 1
}

function resolveTarget(el: Element, action: RecordedAction): Element {
  const hasSignal = hasIdentitySignal(action)
  const byStructure = findByParentAndIndex(action)
  if (byStructure) {
    if (!hasSignal || matchesActionSignature(byStructure, action)) {
      return byStructure
    }
  }

  if (matchesActionSignature(el, action) && !isAmbiguousTextOnlyMatch(action)) return el

  if (!hasSignal) return el

  const candidates = getCandidates(action.selector)
  const best = findBestMatch(candidates, action)
  return best ?? el
}

/**
 * 等待元素出现在 DOM 中
 */
function waitForElement(
  selector: string,
  timeout = ELEMENT_WAIT_TIMEOUT,
  selectorMatchIndex?: number,
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const tryOnce = (): Element | null => {
      if (typeof selectorMatchIndex === 'number' && selectorMatchIndex >= 0) {
        return pickElementWithIndex(selector, selectorMatchIndex)
      }
      return findElement(selector)
    }

    const existing = tryOnce()
    if (existing) {
      resolve(existing)
      return
    }

    const startTime = Date.now()
    const timer = setInterval(() => {
      const el = tryOnce()
      if (el) {
        clearInterval(timer)
        resolve(el)
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer)
        reject(new Error(`元素未找到: ${selector} (超时 ${timeout}ms)`))
      }
    }, ELEMENT_WAIT_INTERVAL)
  })
}

/**
 * 等待 URL 匹配指定模式
 */
function waitForUrl(pattern: string, timeout = ELEMENT_WAIT_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    if (location.href.includes(pattern)) {
      resolve()
      return
    }

    const startTime = Date.now()
    const timer = setInterval(() => {
      if (location.href.includes(pattern)) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer)
        reject(new Error(`URL 未匹配: ${pattern} (超时 ${timeout}ms)`))
      }
    }, ELEMENT_WAIT_INTERVAL)
  })
}

/**
 * 执行点击操作
 *
 * 所有可取消的鼠标事件必须设置 cancelable: true，否则 SPA 框架（React Router / Vue Router）
 * 调用 e.preventDefault() 将无效，导致 <a> 标签的默认导航行为不被阻止，引发意外的整页跳转。
 */
function performClick(element: Element): void {
  element.scrollIntoView({ behavior: 'instant', block: 'center' })

  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  const focusTarget = element instanceof HTMLElement
    ? (
      (element.closest('[contenteditable]') as HTMLElement | null)
      ?? element
    )
    : null
  if (focusTarget) {
    focusTarget.focus({ preventScroll: true })
  }
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
}

/**
 * 执行双击操作
 */
function performDblClick(element: Element): void {
  element.scrollIntoView({ behavior: 'instant', block: 'center' })

  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
}

/**
 * 执行填充操作（兼容普通表单控件与 contenteditable 富文本编辑器）
 */
function performFill(element: Element, value: string, action?: RecordedAction): void {
  const resolveEditableTarget = (target: Element): HTMLElement | HTMLInputElement | HTMLTextAreaElement | null => {
    const resolvedTarget = action ? resolveTarget(target, action) : target
    const byStructure = action ? findByParentAndIndex(action) : null
    if (byStructure instanceof HTMLInputElement || byStructure instanceof HTMLTextAreaElement) return byStructure
    if (byStructure instanceof HTMLElement) {
      if (byStructure.isContentEditable) return byStructure
      const innerEditable = byStructure.querySelector('[contenteditable]')
      if (innerEditable instanceof HTMLElement) return innerEditable
      const nearEditable = byStructure.closest('[contenteditable]')
      if (nearEditable instanceof HTMLElement) return nearEditable
    }

    if (resolvedTarget instanceof HTMLInputElement || resolvedTarget instanceof HTMLTextAreaElement) return resolvedTarget
    if (resolvedTarget instanceof HTMLElement && resolvedTarget.isContentEditable) {
      if (resolvedTarget.contentEditable !== 'true') {
        const editingHost = resolvedTarget.closest('[contenteditable="true"]')
        if (editingHost instanceof HTMLElement) return editingHost
      }
      return resolvedTarget
    }

    const active = document.activeElement
    if (resolvedTarget instanceof HTMLElement) {
      if (
        active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
      ) {
        if (active === resolvedTarget || resolvedTarget.contains(active)) return active
      }
      if (active instanceof HTMLElement && active.isContentEditable) {
        if (active === resolvedTarget || resolvedTarget.contains(active)) return active
      }

      const selection = window.getSelection()
      const anchor = selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement ?? null
      const selectionEditable = anchor?.closest('[contenteditable]')
      if (
        selectionEditable instanceof HTMLElement
        && (selectionEditable === resolvedTarget || resolvedTarget.contains(selectionEditable))
      ) {
        return selectionEditable
      }
    }

    if (resolvedTarget instanceof HTMLElement) {
      const child = resolvedTarget.querySelector('[contenteditable]')
      if (child instanceof HTMLElement) return child
      const ancestor = resolvedTarget.closest('[contenteditable]')
      if (ancestor instanceof HTMLElement) return ancestor
    }

    if (!action) {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return active
      if (active instanceof HTMLElement && active.isContentEditable) return active

      const selection = window.getSelection()
      const anchor = selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement ?? null
      const selectionEditable = anchor?.closest('[contenteditable]')
      if (selectionEditable instanceof HTMLElement) return selectionEditable
    }

    const allEditable = Array.from(document.querySelectorAll('[contenteditable]'))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter(node => node.offsetParent !== null)
    if (allEditable.length === 1) return allEditable[0]
    if (resolvedTarget instanceof HTMLElement && allEditable.length > 1) {
      const t = resolvedTarget.getBoundingClientRect()
      const tx = t.left + t.width / 2
      const ty = t.top + t.height / 2
      let best: HTMLElement | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const node of allEditable) {
        const r = node.getBoundingClientRect()
        const dx = tx - (r.left + r.width / 2)
        const dy = ty - (r.top + r.height / 2)
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          best = node
        }
      }
      if (best) return best
    }

    return null
  }

  const placeCaretAtEnd = (el: HTMLElement) => {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const insertTextBySelection = (el: HTMLElement, text: string): boolean => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const textNode = document.createTextNode(text)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.setEndAfter(textNode)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  const dispatchTypingEvent = (el: HTMLElement, char: string) => {
    const isEnter = char === '\n'
    const key = isEnter ? 'Enter' : char
    const keyboardInit: KeyboardEventInit = {
      key,
      code: isEnter ? 'Enter' : key,
      keyCode: isEnter ? 13 : 0,
      which: isEnter ? 13 : 0,
      bubbles: true,
      cancelable: true,
    }
    el.dispatchEvent(new KeyboardEvent('keydown', keyboardInit))
    const beforeInputAccepted = el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: isEnter ? 'insertParagraph' : 'insertText',
        data: isEnter ? null : char,
      }),
    )

    let inserted = false
    if (beforeInputAccepted) {
      try {
        inserted = isEnter
          ? document.execCommand('insertLineBreak')
          : document.execCommand('insertText', false, char)
      } catch {
        inserted = false
      }
      if (!inserted) {
        inserted = insertTextBySelection(el, char)
      }
    } else {
      inserted = true
    }

    if (inserted) {
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.dispatchEvent(new KeyboardEvent('keyup', keyboardInit))
    return inserted
  }

  const editableTarget = resolveEditableTarget(element)
  if (editableTarget instanceof HTMLElement && editableTarget.isContentEditable) {
    let el = editableTarget
    const text = (value ?? '')
      .replace(/\u200B/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n$/, '')
    el.scrollIntoView({ behavior: 'instant', block: 'center' })
    el.focus()

    try {
      document.execCommand('selectAll')
      document.execCommand('delete')
    } catch {
    }

    if (!el.isConnected) {
      const reacquired = action?.selector ? findElement(action.selector) : null
      const host = reacquired?.closest?.('[contenteditable="true"]')
      el = (host instanceof HTMLElement ? host : reacquired instanceof HTMLElement ? reacquired : el)
      if (el.isConnected) {
        el.focus()
      }
    }

    if (el.isConnected && el.textContent) el.textContent = ''
    placeCaretAtEnd(el)

    if (text.length === 0) {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'deleteContentBackward', data: null }))
      return
    }

    let hasInput = false
    for (const char of text) {
      const ok = dispatchTypingEvent(el, char)
      hasInput = hasInput || ok
    }
    if (!hasInput) {
      el.textContent = text
      placeCaretAtEnd(el)
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: text }))
      const finalText = normalizeText(el.isConnected ? (el.textContent ?? '') : '')
      if (!textMatches(finalText, normalizeText(text))) {
        throw new Error('contenteditable 输入失败')
      }
    }
    return
  }

  if (editableTarget instanceof HTMLInputElement || editableTarget instanceof HTMLTextAreaElement) {
    const formEl = editableTarget

    // 先聚焦，确保 React 等框架的受控输入能正确接收后续的 value 更新
    formEl.scrollIntoView({ behavior: 'instant', block: 'center' })
    formEl.focus()

    // 使用原生 setter 绕过框架拦截
    const proto =
      formEl.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype

    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

    if (nativeSetter) {
      nativeSetter.call(formEl, value)
    } else {
      formEl.value = value
    }

    formEl.dispatchEvent(new Event('input', { bubbles: true }))
    formEl.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  const hasStructuredSignal = Boolean(action?.parentSelector && typeof action?.elementIndex === 'number')
  throw new Error(
    `目标元素不可输入: selector=${action?.selector || ''}; hasStructuredSignal=${hasStructuredSignal}; tag=${(element as HTMLElement)?.tagName || 'unknown'}`,
  )
}

/**
 * 执行选择操作（<select> 元素）
 */
function performSelect(element: HTMLSelectElement, value: string): void {
  element.scrollIntoView({ behavior: 'instant', block: 'center' })
  element.focus()
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * 执行复选框/单选框切换
 */
function performCheck(element: HTMLInputElement): void {
  element.scrollIntoView({ behavior: 'instant', block: 'center' })
  element.click()
}

/**
 * 执行文件上传：触发原生文件选择，并等待用户完成选择后继续。
 * 注意：浏览器安全策略禁止脚本直接设置本地文件路径。
 */
async function performUpload(element: HTMLInputElement, filePath?: string): Promise<void> {
  if (element.type !== 'file') {
    throw new Error('上传目标不是 input[type=file]')
  }

  element.scrollIntoView({ behavior: 'instant', block: 'center' })
  element.focus()

  const hintedPath = (filePath || '').trim()
  if (!hintedPath) {
    throw new Error('上传步骤缺少 filePath 参数，请在生成代码时传入或在页面手动选择文件')
  }

  await new Promise<void>((resolve, reject) => {
    let finished = false
    const timeout = window.setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('等待文件选择超时，请在弹窗中完成文件选择'))
    }, UPLOAD_WAIT_TIMEOUT)

    const onChange = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      element.removeEventListener('change', onChange, true)
    }

    element.addEventListener('change', onChange, true)
    try {
      element.click()
    } catch (err) {
      cleanup()
      reject(new Error(`无法触发文件选择窗口: ${(err as Error).message}`))
    }
  })
}

/**
 * 执行按键操作
 *
 * 兼容策略：
 *   1. 先聚焦元素，确保事件在正确的激活上下文中触发
 *   2. 按顺序派发 keydown → keypress → keyup，覆盖 onKeyDown / onKeyPress 两类监听器
 *   3. 对 Enter 键补全 keyCode:13 / which:13 / code:'Enter'，兼容检查 e.keyCode 的旧代码
 *   4. 对 Enter 键额外尝试 requestSubmit()，兼容传统 <form> 提交
 */
function performKeydown(element: Element, key: string): void {
  const el = element as HTMLElement
  el.scrollIntoView({ behavior: 'instant', block: 'center' })
  el.focus()

  const isEnter = key === 'Enter'
  const eventInit: KeyboardEventInit = {
    key,
    code: isEnter ? 'Enter' : key,
    // keyCode/which 已废弃但仍被大量遗留代码检查（e.keyCode === 13）
    keyCode: isEnter ? 13 : 0,
    which: isEnter ? 13 : 0,
    bubbles: true,
    cancelable: true,
  }

  element.dispatchEvent(new KeyboardEvent('keydown', eventInit))
  // keypress 在 Enter 键时由浏览器原生派发，部分框架（React onKeyPress）依赖此事件
  if (isEnter) {
    element.dispatchEvent(new KeyboardEvent('keypress', eventInit))
  }
  element.dispatchEvent(new KeyboardEvent('keyup', eventInit))

  // 兜底：尝试触发最近的表单提交（适用于传统 <form> 场景）
  if (isEnter) {
    if (element instanceof HTMLFormElement) {
      element.requestSubmit()
    } else {
      const form = element.closest('form')
      if (form) form.requestSubmit()
    }
  }
}

/**
 * 执行滚动操作
 */
function performScroll(action: RecordedAction): void {
  if (action.scrollPosition) {
    window.scrollTo(action.scrollPosition.x, action.scrollPosition.y)
  }
}

/**
 * 执行悬停操作
 */
function performHover(element: Element): void {
  element.scrollIntoView({ behavior: 'instant', block: 'center' })

  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }))
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))
}

function extractTextContent(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || ''
  }
  return element.textContent?.trim() || ''
}

async function captureVisibleTabDataUrl(): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    type: CS_MSG.CAPTURE_VISIBLE_TAB,
  })
  if (!response?.success || !response?.data?.dataUrl) {
    throw new Error(response?.error || '截图失败')
  }
  return response.data.dataUrl as string
}

async function cropDataUrlByRect(
  sourceDataUrl: string,
  rect: DOMRect
): Promise<string> {
  const dpr = window.devicePixelRatio || 1
  const x = Math.max(0, Math.floor(rect.left * dpr))
  const y = Math.max(0, Math.floor(rect.top * dpr))
  const w = Math.max(1, Math.floor(rect.width * dpr))
  const h = Math.max(1, Math.floor(rect.height * dpr))

  const image = new Image()
  image.src = sourceDataUrl
  await image.decode()

  const maxW = Math.max(1, image.width - x)
  const maxH = Math.max(1, image.height - y)
  const drawW = Math.min(w, maxW)
  const drawH = Math.min(h, maxH)

  const canvas = document.createElement('canvas')
  canvas.width = drawW
  canvas.height = drawH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建截图画布')
  ctx.drawImage(image, x, y, drawW, drawH, 0, 0, drawW, drawH)
  return canvas.toDataURL('image/png')
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.click()
}

/**
 * 主入口：执行单个 RecordedAction
 */
export async function executeAction(action: RecordedAction): Promise<ExecuteActionResult> {
  try {
    switch (action.type) {
      case 'navigate': {
        if (action.url && action.url !== location.href) {
          location.href = action.url
          // 导航会销毁 CS，Background 会在页面加载完成后重新注入
        }
        return { success: true }
      }

      case 'click': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        performClick(resolveTarget(el, action))
        return { success: true }
      }

      case 'dblclick': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        performDblClick(resolveTarget(el, action))
        return { success: true }
      }

      case 'fill': {
        await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        // 优先使用可见元素（模态框等场景下可能存在多个匹配，需操作当前可见的）
        const el = findElementPreferVisible(action.selector, action.selectorMatchIndex)
          ?? findElement(action.selector)
        if (!el) throw new Error(`元素未找到: ${action.selector}`)
        performFill(el, action.value || '', action)
        return { success: true }
      }

      case 'select': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        performSelect(el as HTMLSelectElement, action.value || '')
        return { success: true }
      }

      case 'check': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        performCheck(el as HTMLInputElement)
        return { success: true }
      }

      case 'upload': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
          return { success: false, error: `上传目标无效: ${action.selector} 不是 input[type=file]` }
        }
        await performUpload(el, action.filePath || action.value)
        return { success: true }
      }

      case 'keydown': {
        const el = await waitForElement(action.selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        performKeydown(el, action.key || '')
        return { success: true }
      }

      case 'scroll': {
        performScroll(action)
        return { success: true }
      }

      case 'hover': {
        try {
          const el = await waitForElement(
            action.selector,
            HOVER_WAIT_TIMEOUT,
            action.selectorMatchIndex,
          )
          performHover(resolveTarget(el, action))
          return { success: true }
        } catch (err) {
          // 元素已不存在（如点击导致页面结构大改、该元素被移除）：跳过悬停步骤，继续回溯，避免整条链失败
          return {
            success: true,
            data: { skipped: true, reason: 'element_not_found', message: (err as Error)?.message },
          }
        }
      }

      case 'wait_for_selector': {
        const timeout = action.waitTimeout || ELEMENT_WAIT_TIMEOUT
        await waitForElement(action.selector, timeout, action.selectorMatchIndex)
        return { success: true }
      }

      case 'wait_for_url': {
        const timeout = action.waitTimeout || ELEMENT_WAIT_TIMEOUT
        await waitForUrl(action.waitPattern || action.url || '', timeout)
        return { success: true }
      }

      case 'wait_for_timeout': {
        const ms = action.waitTimeout || 1000
        await new Promise(resolve => setTimeout(resolve, ms))
        return { success: true }
      }

      case 'wait_for_navigation': {
        // 导航等待由 Background 处理，CS 侧标记成功
        return { success: true }
      }

      case 'extract_selected_content': {
        const selector = action.extractedSelector || action.selector
        if (!selector) {
          return { success: false, error: '缺少提取目标选择器' }
        }

        const el = await waitForElement(selector, ELEMENT_WAIT_TIMEOUT, action.selectorMatchIndex)
        if (action.extractMode === 'screenshot') {
          el.scrollIntoView({ behavior: 'instant', block: 'center' })
          await new Promise(resolve => setTimeout(resolve, 120))
          const capture = await captureVisibleTabDataUrl()
          const rect = el.getBoundingClientRect()
          const cropped = await cropDataUrlByRect(capture, rect)
          const fileName = `yoso-extract-${Date.now()}.png`
          downloadDataUrl(cropped, fileName)
          return { success: true, data: { screenshotFileName: fileName } }
        }

        const text = extractTextContent(el)
        return { success: true, data: { extractedText: text } }
      }

      default:
        return { success: false, error: `不支持的操作类型: ${action.type}` }
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
