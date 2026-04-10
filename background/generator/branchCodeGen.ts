import type { RecordedAction } from '@/types/action'
import type { LoopTargetPattern, OperationNode } from '@/types/operationTree'
import { LOOP_BODY_END_SELF } from '@/types/operationTree'
import type { Branch, BranchParam, ToolRegistration } from '@/types/branch'

export interface ToolBehaviorSummary {
  usageScenario: string
  sideEffects: string[]
}

const GENERIC_PARAM_DESCRIPTIONS = new Set(['Input value', 'Numeric value'])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveRegisteredParamName(
  param: BranchParam,
  reg?: { paramDescriptions?: Record<string, string> } | null,
): string {
  const raw = reg?.paramDescriptions?.[param.nodeId] || param.name
  return sanitizeParamName(raw)
}

export function resolveParamBusinessDescription(param: BranchParam): string {
  const desc = (param.description || '').trim()
  if (desc && !GENERIC_PARAM_DESCRIPTIONS.has(desc)) return desc
  if (param.type === 'enum') return 'Business option used to choose one workflow branch'
  if (param.source === 'loop_target') return 'Maximum number of list items to process in this run'
  if (param.type === 'number') return 'Business numeric input used by this workflow step'
  return 'Business input value used by this workflow step'
}

export function isSchemaParamRequired(param: BranchParam): boolean {
  if (param.defaultValue !== undefined && param.defaultValue !== null) return false
  return !!param.required
}

export function summarizeToolBehavior(branch: Branch): ToolBehaviorSummary {
  const actionTypes = new Set(branch.path.map(n => n.action.type))
  const hasExtraction = branch.returns.length > 0
  const hasUpload = actionTypes.has('upload')
  const hasMutation = actionTypes.has('click')
    || actionTypes.has('dblclick')
    || actionTypes.has('fill')
    || actionTypes.has('select')
    || actionTypes.has('check')
    || actionTypes.has('keydown')
    || hasUpload

  const usageScenario = hasExtraction
    ? 'Use when you need to execute the recorded web workflow and collect structured output.'
    : 'Use when you need to execute the recorded web workflow exactly as demonstrated.'

  const sideEffects = ['Launches a real Chromium browser session.']
  if (hasMutation) {
    sideEffects.push('Performs live interactions on the target website and may trigger submit/post/state-changing actions.')
  }
  if (hasUpload) {
    sideEffects.push('May upload local files to the target website.')
  }
  if (branch.returns.some(r => r.extractMode === 'screenshot')) {
    sideEffects.push('May save screenshot files to the local working directory.')
  }
  return { usageScenario, sideEffects }
}

function sanitizeLiteralText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function generateBranchCode(branch: Branch): string {
  const reg = branch.registration
  const fnName = reg?.toolName || `tool_${branch.id.slice(0, 8)}`
  const hasArgs = branch.params.length > 0
  const hasReturns = branch.returns.length > 0
  const argsTypeName = toPascalCase(fnName) + 'Args'

  const parts: string[] = []

  if (hasArgs) {
    parts.push(generateArgsInterface(argsTypeName, branch.params, reg))
  }

  parts.push(generateFunction(fnName, argsTypeName, branch, hasArgs, hasReturns))

  return parts.join('\n\n')
}

export function assembleServer(branches: Branch[], toolSetName: string): string {
  const parts: string[] = []
  const safeName = toolSetName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso-tools'
  const needsSession = branchesHaveWaitNodes(branches)

  parts.push(generateImports(needsSession))
  parts.push(generateBrowserManagement(needsSession, safeName))

  for (const branch of branches) {
    if (branch.generatedCode) {
      parts.push(branch.generatedCode)
    }
  }

  parts.push(generateMCPServer(branches, toolSetName))

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Imports & browser boilerplate
// ---------------------------------------------------------------------------

export function generateImports(needsSession = false, includeMcpImports = true): string {
  const sessionImports = needsSession
    ? `\nimport * as fs from "node:fs";\nimport * as os from "node:os";\nimport * as path from "node:path";`
    : ''
  const mcpImports = includeMcpImports
    ? `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
`
    : ''
  return `${mcpImports}import { chromium, type Browser, type BrowserContext, type Page, type FrameLocator, type Locator } from "playwright";${sessionImports}`
}

export function generateBrowserManagement(needsSession = false, serverName = 'yoso'): string {
  // Build escapeForRegex separately — template-literal escaping is too fragile
  // for nested regex with backslashes. We want the generated .ts to contain:
  //   return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeForRegexFn = [
    'function escapeForRegex(text: string): string {',
    '  return text.replace(/[.*+?^${}()|[\\]\\\\]/g, ' + "'\\\\$&'" + ');',
    '}',
  ].join('\n')

  const safeName = serverName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso'

  const sessionConst = needsSession
    ? `\nconst SESSION_BROKER_FILE = '${safeName}-session.json';\nconst SESSION_BROKER_ROOT = path.join(os.homedir(), '.yoso', 'session-broker');\nconst SESSION_BROKER_VERSION = 'v1';\nconst SESSION_BROKER_ORIGIN_ENV = 'YOSO_SESSION_ORIGIN';\n`
    : ''

  const ensureBrowserBody = needsSession
    ? `async function ensureBrowser(originHint?: string): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: HEADLESS });
    const preferredOrigin = resolveSessionOrigin(originHint || process.env[SESSION_BROKER_ORIGIN_ENV] || '');
    const storageState = await loadSessionState(preferredOrigin);
    context = await browser.newContext(storageState ? { storageState } : {});
    page = await context.newPage();
    if (storageState && preferredOrigin) {
      console.error('[YOSO] Loaded broker session for ' + preferredOrigin);
    }
  }
  return page!;
}`
    : `async function ensureBrowser(): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: HEADLESS });
    context = await browser.newContext();
    page = await context.newPage();
  }
  return page!;
}`

  const sessionHelpers = needsSession
    ? `

async function saveSessionState(): Promise<void> {
  if (!context) return;
  const origin = resolveSessionOrigin(page?.url() || process.env[SESSION_BROKER_ORIGIN_ENV] || '');
  if (!origin) {
    console.error('[YOSO] Session broker skipped: origin is empty or unsupported.');
    return;
  }
  const sessionStatePath = getSessionStatePath(origin);
  const state = await context.storageState();
  await fs.promises.mkdir(path.dirname(sessionStatePath), { recursive: true });
  await fs.promises.writeFile(sessionStatePath, JSON.stringify(state, null, 2), 'utf8');
  console.error('[YOSO] Session state saved to broker for ' + origin);
}

async function waitWithSessionRecovery(
  waitFn: (timeout: number) => Promise<void>,
): Promise<void> {
  try {
    await waitFn(5_000);
  } catch (err) {
    const brokerPath = path.join(SESSION_BROKER_ROOT, SESSION_BROKER_VERSION, SESSION_BROKER_FILE);
    console.error('[YOSO] Wait failed within the initial timeout. Default is headless (HEADLESS=true); interactive recovery in a browser window is not available.');
    console.error('[YOSO] If you rely on a logged-in session, use the YOSO extension to export Playwright storage state and replace the broker file at: ' + brokerPath);
    console.error('[YOSO] For local debugging, set HEADLESS=false in this script and retry.');
    throw err;
  }
  await saveSessionState();
}

function resolveSessionOrigin(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function getSessionStatePath(_origin: string): string {
  return path.join(SESSION_BROKER_ROOT, SESSION_BROKER_VERSION, SESSION_BROKER_FILE);
}

async function loadSessionState(
  origin: string | null,
): Promise<{ cookies: unknown[]; origins: unknown[] } | undefined> {
  if (!origin) return undefined;
  const sessionStatePath = getSessionStatePath(origin);
  if (!fs.existsSync(sessionStatePath)) return undefined;
  try {
    const raw = await fs.promises.readFile(sessionStatePath, 'utf8');
    const parsed = JSON.parse(raw) as { cookies?: unknown[]; origins?: unknown[] };
    if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) return undefined;
    return { cookies: parsed.cookies, origins: parsed.origins };
  } catch {
    return undefined;
  }
}`
    : ''

  return `let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
const NAV_TIMEOUT = 30_000;
const NAV_SETTLE_DELAY = 500;
const ACTION_DELAY = 1500;
const NEW_PAGE_WAIT_TIMEOUT = 800;
const HEADLESS = true;
${sessionConst}
${ensureBrowserBody}

async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    context = null;
    page = null;
  }
}${sessionHelpers}

async function waitForNewPage(currentPage: Page): Promise<Page | null> {
  const popupPromise = currentPage.waitForEvent('popup', { timeout: NEW_PAGE_WAIT_TIMEOUT }).catch(() => null);
  const contextPagePromise = context
    ? context.waitForEvent('page', { timeout: NEW_PAGE_WAIT_TIMEOUT }).catch(() => null)
    : Promise.resolve<Page | null>(null);
  return await Promise.race([
    popupPromise,
    contextPagePromise,
    currentPage.waitForTimeout(NEW_PAGE_WAIT_TIMEOUT).then(() => null),
  ]);
}

` + escapeForRegexFn + `

function relaxSelector(selector: string): string {
  return selector
    .replace(/:nth-child\\(\\d+\\)/g, '')
    .replace(/:nth-of-type\\(\\d+\\)/g, '')
    .trim();
}

function shouldUseTextConstraint(text: string, selector: string): boolean {
  if (!text) return false;
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized === selector.trim()) return false;
  if (normalized.length < 2) return false;
  if (normalized.includes('>') || normalized.includes(':nth-')) return false;
  if (normalized.startsWith('.') || normalized.startsWith('#')) return false;
  if (/^[a-z0-9_-]+(\\.[a-z0-9_-]+)+$/i.test(normalized)) return false;
  return true;
}

async function performClickOnLocator(loc: Locator, clickType: 'click' | 'dblclick'): Promise<void> {
  await loc.scrollIntoViewIfNeeded();
  try {
    if (clickType === 'dblclick') await loc.dblclick({ timeout: 15_000 });
    else await loc.click({ timeout: 15_000 });
  } catch {
    if (clickType === 'dblclick') await loc.dblclick({ force: true });
    else await loc.click({ force: true });
  }
}

/**
 * 在 locator 的多个匹配中优先可点击的可见节点（与 resolveFillLocator 一致）。
 * 解决同一占位文案对应隐藏模板 + 可见编辑器时，.first() 点到不可见节点导致超时。
 */
async function pickVisibleClickLocator(base: Locator, selectorMatchIndex?: number): Promise<Locator> {
  const tryOnce = async (): Promise<Locator | null> => {
    const count = await base.count();
    if (
      typeof selectorMatchIndex === 'number'
      && selectorMatchIndex >= 0
      && selectorMatchIndex < count
    ) {
      const at = base.nth(selectorMatchIndex);
      try {
        if (await at.isVisible()) return at;
      } catch {
        /* detached */
      }
    }
    for (let i = 0; i < count; i++) {
      const candidate = base.nth(i);
      try {
        if (await candidate.isVisible()) return candidate;
      } catch {
        continue;
      }
    }
    return null;
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const hit = await tryOnce();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (typeof selectorMatchIndex === 'number' && selectorMatchIndex >= 0) {
    return base.nth(selectorMatchIndex);
  }
  return base.first();
}

async function clickBySelectorAndText(
  currentPage: Page | FrameLocator | Locator,
  selector: string,
  innerText?: string,
  clickType: 'click' | 'dblclick' = 'click',
  selectorMatchIndex?: number,
): Promise<void> {
  const text = innerText?.trim();
  const tryClick = async (targetSelector: string) => {
    const root = currentPage.locator(targetSelector);
    const loc = await pickVisibleClickLocator(root, selectorMatchIndex);
    await performClickOnLocator(loc, clickType);
  };

  if (!text || !shouldUseTextConstraint(text, selector)) {
    await tryClick(selector);
    return;
  }

  const exactRe = new RegExp('^\\\\s*' + escapeForRegex(text) + '\\\\s*$');

  // 1. Exact text match on original (positional) selector
  const exact = currentPage.locator(selector).filter({ hasText: exactRe });
  if (await exact.count()) {
    const loc = await pickVisibleClickLocator(exact, selectorMatchIndex);
    await performClickOnLocator(loc, clickType);
    return;
  }

  // 2. Contains match on original selector
  const contains = currentPage.locator(selector).filter({ hasText: text });
  if (await contains.count()) {
    const loc = await pickVisibleClickLocator(contains, selectorMatchIndex);
    await performClickOnLocator(loc, clickType);
    return;
  }

  // 3. Positional pseudo-classes may be stale — retry with relaxed selector
  const relaxed = relaxSelector(selector);
  if (relaxed !== selector) {
    const relaxedExact = currentPage.locator(relaxed).filter({ hasText: exactRe });
    if (await relaxedExact.count()) {
      const loc = await pickVisibleClickLocator(relaxedExact, selectorMatchIndex);
      await performClickOnLocator(loc, clickType);
      return;
    }
    const relaxedContains = currentPage.locator(relaxed).filter({ hasText: text });
    if (await relaxedContains.count()) {
      const loc = await pickVisibleClickLocator(relaxedContains, selectorMatchIndex);
      await performClickOnLocator(loc, clickType);
      return;
    }
  }

  // 4. Final fallback: click by original selector (no text constraint)
  await tryClick(selector);
}

type FillSemantics = {
  richText?: boolean;
  cursorAtEnd?: boolean;
  incremental?: boolean;
  preserveUndoStack?: boolean;
};

function resolveSelectAllShortcut(): string {
  return process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
}

/**
 * 与 content/replayer.ts findElementPreferVisible 对齐：
 * 有 selectorMatchIndex 且对应节点可见时优先；否则在全部匹配中选第一个可见；都无则退回 .first()。
 * 解决同一 selector 多节点（如隐藏占位 + 可见输入）时 fill 误选隐藏节点导致超时。
 */
async function resolveFillLocator(
  currentPage: Page | FrameLocator | Locator,
  selector: string,
  selectorMatchIndex?: number,
): Promise<Locator> {
  const root = currentPage.locator(selector);
  const tryPick = async (): Promise<Locator | null> => {
    const count = await root.count();
    if (
      typeof selectorMatchIndex === 'number'
      && selectorMatchIndex >= 0
      && selectorMatchIndex < count
    ) {
      const at = root.nth(selectorMatchIndex);
      try {
        if (await at.isVisible()) return at;
      } catch {
        /* detached */
      }
    }
    for (let i = 0; i < count; i++) {
      const candidate = root.nth(i);
      try {
        if (await candidate.isVisible()) return candidate;
      } catch {
        continue;
      }
    }
    return null;
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const hit = await tryPick();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return root.first();
}

/**
 * 富文本（TipTap/ProseMirror 等）：使用 Playwright 真实键盘输入。
 * 页内 execCommand/合成事件对部分编辑器不可靠；与普通 input/textarea 的 fill 分离。
 */
async function fillBySemantics(
  currentPage: Page | FrameLocator | Locator,
  selector: string,
  value: string,
  semantics?: FillSemantics,
  selectorMatchIndex?: number,
): Promise<void> {
  const raw = await resolveFillLocator(currentPage, selector, selectorMatchIndex);
  const text = value ?? '';
  if (!semantics?.richText) {
    await raw.fill(text);
    return;
  }
  await raw.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await raw.click({ timeout: 15_000 });
  } catch {
    await raw.click({ force: true });
  }
  const shouldType = !!(semantics.incremental || semantics.preserveUndoStack || semantics.cursorAtEnd);
  if (!semantics.incremental) {
    if (semantics.preserveUndoStack) {
      await raw.press(resolveSelectAllShortcut()).catch(() => undefined);
      await raw.press('Backspace').catch(() => undefined);
    } else {
      await raw.fill('');
    }
  }
  if (text.length > 0) {
    if (shouldType) {
      await raw.pressSequentially(text, { delay: 25 });
    } else {
      await raw.fill(text);
    }
  }
  if (semantics.cursorAtEnd) {
    await raw.evaluate((el: Element) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if ('setSelectionRange' in input && typeof input.value === 'string') {
        const end = input.value.length;
        input.setSelectionRange(end, end);
        return;
      }
      if ((el as HTMLElement).isContentEditable) {
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }).catch(() => undefined);
  }
}

async function runActionAndCaptureNewPage(
  currentPage: Page,
  actionType: string,
  action: () => Promise<void>,
): Promise<Page> {
  const shouldWatchNewPage = actionType === 'click' || actionType === 'dblclick' || actionType === 'keydown';
  if (!shouldWatchNewPage) {
    await action();
    return currentPage;
  }
  const pagesBefore = context ? context.pages().length : 0;
  const newPagePromise = waitForNewPage(currentPage);
  await action();
  const detected = await newPagePromise;
  if (detected) {
    await detected.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => undefined);
    return detected;
  }
  if (context && context.pages().length > pagesBefore) {
    const latest = context.pages()[context.pages().length - 1];
    await latest.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => undefined);
    return latest;
  }
  return currentPage;
}

async function settleAfterPossibleNavigation(currentPage: Page, actionType: string): Promise<Page> {
  let activePage = currentPage;
  if (actionType === 'navigate' || actionType === 'click' || actionType === 'dblclick' || actionType === 'keydown') {
    await activePage.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => undefined);
    await activePage.waitForTimeout(NAV_SETTLE_DELAY);
    await activePage.bringToFront().catch(() => undefined);
  }
  return activePage;
}

async function stabilizeStep(currentPage: Page, actionType: string): Promise<Page> {
  const activePage = await settleAfterPossibleNavigation(currentPage, actionType);
  await activePage.waitForTimeout(ACTION_DELAY);
  return activePage;
}`
}

// ---------------------------------------------------------------------------
// Args interface
// ---------------------------------------------------------------------------

function generateArgsInterface(
  name: string,
  params: BranchParam[],
  reg?: ToolRegistration
): string {
  const fields = params.map(p => {
    const paramName = resolveRegisteredParamName(p, reg)
    const optional = p.required && p.defaultValue === undefined ? '' : '?'
    let tsType: string
    if (p.type === 'enum' && p.enumOptions) {
      tsType = p.enumOptions.map(o => `'${escapeSingleQuote(o)}'`).join(' | ')
    } else if (p.type === 'number') {
      tsType = 'number'
    } else {
      tsType = 'string'
    }
    return `  ${paramName}${optional}: ${tsType};`
  })

  return `interface ${name} {\n${fields.join('\n')}\n}`
}

// ---------------------------------------------------------------------------
// Tool function body
// ---------------------------------------------------------------------------

function inferSessionOriginHint(branch: Branch): string | null {
  const startOrigin = extractOrigin(branch.startUrl)
  if (startOrigin) return startOrigin
  for (const node of branch.path) {
    if (node.action.type !== 'navigate' && node.action.type !== 'wait_for_url') continue
    const actionOrigin = extractOrigin(node.action.url)
    if (actionOrigin) return actionOrigin
  }
  return null
}

function extractOrigin(rawUrl?: string): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 循环体步骤是否应以 `items.nth(i)` 为定位根。详情遮罩等不在列表项子树内的节点应使用 page/frame 根，
 * 与内容脚本回放的文档级 query 一致。
 */
function pickParentRefForScope(node: OperationNode): string | undefined {
  const action = node.action
  if (action.parentSelector?.trim()) return action.parentSelector.trim()
  const bc = action.branchCandidates
  if (bc?.length) {
    const hit = bc.find(c => c.parentSelector?.trim())
    if (hit?.parentSelector) return hit.parentSelector.trim()
  }
  const mc = node.metadata.candidates
  if (mc?.length) {
    const sel = mc.find(c => c.selected && c.parentSelector?.trim())?.parentSelector
      ?? mc.find(c => c.parentSelector?.trim())?.parentSelector
    if (sel?.trim()) return sel.trim()
  }
  return undefined
}

/** 过短的 item 选择器（仅标签名）易被弹层等同名节点误匹配，不能单独用来判定「在列表项内」。 */
function isGenericItemSelector(itemSelector: string): boolean {
  const t = itemSelector.trim()
  if (!t || /[.#\[\]:]/.test(t)) return false
  const first = (t.split(/\s+/)[0] ?? '').toLowerCase()
  return /^(li|div|span|a|p)$/i.test(first)
}

function shouldScopeLoopBodyNodeToItem(node: OperationNode, pattern: LoopTargetPattern): boolean {
  const action = node.metadata.selectorOverride
    ? { ...node.action, selector: node.metadata.selectorOverride }
    : node.action

  const primary = action.type === 'extract_selected_content'
    ? (action.extractedSelector || action.selector || '')
    : (action.selector || '')
  const trimmedPrimary = primary.trim()
  if (trimmedPrimary.startsWith('#')) return false

  const parentRef = pickParentRefForScope(node)
  if (!parentRef) return true

  const c = pattern.containerSelector?.trim() ?? ''
  const it = pattern.itemSelector?.trim() ?? ''
  const genericItem = isGenericItemSelector(it)

  if (c && parentRef.includes(c)) return true
  if (!genericItem && it && parentRef.includes(it)) return true
  if (c && !parentRef.includes(c)) {
    if (genericItem) return false
    if (it && !parentRef.includes(it)) return false
    return false
  }

  return true
}

function generateFunction(
  fnName: string,
  argsTypeName: string,
  branch: Branch,
  hasArgs: boolean,
  hasReturns: boolean
): string {
  const reg = branch.registration
  const argsParam = hasArgs ? `args: ${argsTypeName}` : ''
  const lines: string[] = []
  const sessionOriginHint = inferSessionOriginHint(branch)

  lines.push(`async function ${fnName}(${argsParam}) {`)
  if (sessionOriginHint) {
    lines.push(`  let page = await ensureBrowser('${escapeSelector(sessionOriginHint)}');`)
  } else {
    lines.push('  let page = await ensureBrowser();')
  }

  const uploadSuppressed = buildUploadSuppressionSet(branch.path)

  const loopCtx = buildLoopContext(branch.path)
  const repeatSkipIds = buildRepeatGroupSkipIds(branch.path, loopCtx)
  const loopBodySet = new Set(loopCtx?.bodyNodeIds || [])
  const loopTargetId = loopCtx?.targetNodeId
  const loopTargetPattern = loopCtx
    ? branch.path.find(n => n.id === loopCtx.targetNodeId)?.metadata.loopTargetPattern
    : undefined
  let inLoop = false

  if (hasReturns) {
    lines.push('  const results: string[] = [];')
  }
  if (shouldInjectStartUrlNavigate(branch) && branch.startUrl) {
    lines.push(`  await page.goto('${escapeSelector(branch.startUrl)}');`)
    lines.push(`  page = await stabilizeStep(page, 'navigate');`)
  }

  for (let i = 0; i < branch.path.length; i++) {
    const node = branch.path[i]
    const role = node.metadata.nodeRole
    const action = node.action

    if (uploadSuppressed.has(node.id)) continue
    if (repeatSkipIds.has(node.id)) continue

    // Loop target → open for-loop
    if (loopCtx && node.id === loopTargetId) {
      lines.push('')
      const pattern = node.metadata.loopTargetPattern!
      const countParamName = resolveParamName(branch, node.id, 'count', reg)
      const loopDefaultLiteral = getParamDefaultLiteral(branch, node.id, 'loop_target')
      lines.push(`  const items = ${locatorExprAction(action, pattern.fullSelector)};`)
      if (hasArgs) {
        if (loopDefaultLiteral !== undefined) {
          lines.push(`  const loopCount = args.${countParamName} ?? ${loopDefaultLiteral};`)
        } else {
          lines.push(`  const loopCount = args.${countParamName} ?? await items.count();`)
        }
      } else {
        if (loopDefaultLiteral !== undefined) {
          lines.push(`  const loopCount = ${loopDefaultLiteral};`)
        } else {
          lines.push(`  const loopCount = await items.count();`)
        }
      }
      lines.push(`  for (let i = 0; i < loopCount; i++) {`)

      if (pattern.clickTargetWithinItem) {
        lines.push(`    try {`)
        lines.push(`      const target = items.nth(i).locator('${escapeSelector(pattern.clickTargetWithinItem)}');`)
        lines.push(`      const targetCount = await target.count();`)
        lines.push(`      if (targetCount === 0) {`)
        lines.push(`        console.warn('[YOSO] Skip loop item #' + (i + 1) + ': click target not found');`)
        lines.push(`        continue;`)
        lines.push(`      }`)
        lines.push(`      page = await runActionAndCaptureNewPage(page, 'click', async () => {`)
        lines.push(`        await target.first().click();`)
        lines.push(`      });`)
        lines.push(`    } catch (err) {`)
        lines.push(`      const errorMessage = err instanceof Error ? err.message : String(err);`)
        lines.push(`      console.warn('[YOSO] Skip loop item #' + (i + 1) + ': ' + errorMessage);`)
        lines.push(`      continue;`)
        lines.push(`    }`)
      } else {
        lines.push(`    try {`)
        lines.push(`      page = await runActionAndCaptureNewPage(page, 'click', async () => {`)
        lines.push(`        await items.nth(i).click();`)
        lines.push(`      });`)
        lines.push(`    } catch (err) {`)
        lines.push(`      const errorMessage = err instanceof Error ? err.message : String(err);`)
        lines.push(`      console.warn('[YOSO] Skip loop item #' + (i + 1) + ': ' + errorMessage);`)
        lines.push(`      continue;`)
        lines.push(`    }`)
      }
      lines.push(`    page = await stabilizeStep(page, 'click');`)

      inLoop = true
      continue
    }

    // Skip nodes inside the loop body — they're handled below the loop-target open
    if (loopBodySet.has(node.id)) {
      const indent = inLoop ? '    ' : '  '
      const scopeLoopItem = loopTargetPattern
        ? shouldScopeLoopBodyNodeToItem(node, loopTargetPattern)
        : true
      const code = nodeToCode(node, indent, branch, reg, scopeLoopItem)
      if (code) lines.push(code)
      if (code && shouldStabilizeAction(action.type)) {
        lines.push(`${indent}page = await stabilizeStep(page, '${action.type}');`)
      }

      // Close the loop if this is the last body node
      const isLastBody = loopCtx && node.id === loopCtx.endNodeId
      const nextNode = branch.path[i + 1]
      const nextIsBody = nextNode && loopBodySet.has(nextNode.id)
      if (inLoop && (isLastBody || !nextIsBody)) {
        lines.push('  }')
        inLoop = false
      }
      continue
    }

    // Regular node
    if (inLoop) {
      // Should not happen if loop context is correct, but handle gracefully
      lines.push('  }')
      inLoop = false
    }

    const code = nodeToCode(node, '  ', branch, reg)
    if (code) lines.push(code)
    if (code && shouldStabilizeAction(action.type)) {
      lines.push(`  page = await stabilizeStep(page, '${action.type}');`)
    }
  }

  if (inLoop) {
    lines.push('  }')
  }

  lines.push('')
  if (hasReturns) {
    lines.push('  return { content: results };')
  } else {
    lines.push('  return { success: true };')
  }
  lines.push('}')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Node → code line
// ---------------------------------------------------------------------------

const LOOP_ITEM_SCOPE_EXPR = 'items.nth(i)'

/** 与录制 {@link RecordedAction.selectorMatchIndex} 一致：0-based，导出为 Playwright {@link Locator.nth} */
function selectorMatchIndexExpr(action: RecordedAction): string {
  return typeof action.selectorMatchIndex === 'number' && action.selectorMatchIndex >= 0
    ? String(action.selectorMatchIndex)
    : 'undefined'
}

function scopedTargetExpr(action: RecordedAction, scopeLoopItem: boolean): string {
  return scopeLoopItem ? LOOP_ITEM_SCOPE_EXPR : targetExprAction(action)
}

function scopedLocatorExpr(action: RecordedAction, selector: string | undefined, scopeLoopItem: boolean): string {
  const sel = selector ?? action.selector ?? ''
  const esc = escapeSelector(sel)
  if (scopeLoopItem) return `${LOOP_ITEM_SCOPE_EXPR}.locator('${esc}')`
  return locatorExprAction(action, selector)
}

function nodeToCode(
  node: OperationNode,
  indent: string,
  branch: Branch,
  reg?: ToolRegistration,
  scopeLoopItem = false,
): string {
  const action = node.metadata.selectorOverride
    ? { ...node.action, selector: node.metadata.selectorOverride }
    : node.action
  const role = node.metadata.nodeRole
  const hasArgs = branch.params.length > 0

  switch (action.type) {
    case 'navigate':
      return `${indent}await page.goto('${escapeSelector(action.url || '')}');`

    case 'click':
    case 'dblclick': {
      if (role === 'enum_param') {
        return generateEnumClick(node, indent, branch, reg, scopeLoopItem)
      }
      const method = action.type === 'dblclick' ? 'dblclick' : 'click'
      const innerText = action.innerText ? `'${escapeSingleQuote(action.innerText)}'` : 'undefined'
      const matchIdx = selectorMatchIndexExpr(action)
      return `${indent}page = await runActionAndCaptureNewPage(page, '${action.type}', async () => {\n${indent}  await clickBySelectorAndText(${scopedTargetExpr(action, scopeLoopItem)}, '${escapeSelector(action.selector)}', ${innerText}, '${method}', ${matchIdx});\n${indent}});`
    }

    case 'fill': {
      if (action.inputType === 'file' || action.attributes?.['type'] === 'file') return ''
      const semantics = fillSemanticsExpr(action)
      if (role === 'dynamic_param' && hasArgs) {
        const paramName = resolveNodeParamName(
          branch,
          node.id,
          'dynamic_param',
          action.attributes?.['name'] || action.attributes?.['placeholder'] || 'inputValue',
          reg,
        )
        const defaultLiteral = getParamDefaultLiteral(branch, node.id, 'dynamic_param')
        const valueExpr = defaultLiteral !== undefined ? `args.${paramName} ?? ${defaultLiteral}` : `args.${paramName}`
        const fillIdx = selectorMatchIndexExpr(action)
        return `${indent}await fillBySemantics(${scopedTargetExpr(action, scopeLoopItem)}, '${escapeSelector(action.selector)}', ${valueExpr}, ${semantics}, ${fillIdx});`
      }
      const fillIdx = selectorMatchIndexExpr(action)
      return `${indent}await fillBySemantics(${scopedTargetExpr(action, scopeLoopItem)}, '${escapeSelector(action.selector)}', '${escapeSingleQuote(action.value || '')}', ${semantics}, ${fillIdx});`
    }

    case 'select': {
      if (role === 'dynamic_param' && hasArgs) {
        const paramName = resolveNodeParamName(
          branch,
          node.id,
          'dynamic_param',
          action.attributes?.['name'] || 'selectValue',
          reg,
        )
        const defaultLiteral = getParamDefaultLiteral(branch, node.id, 'dynamic_param')
        const valueExpr = defaultLiteral !== undefined ? `args.${paramName} ?? ${defaultLiteral}` : `args.${paramName}`
        return `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().selectOption(${valueExpr});`
      }
      return `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().selectOption('${escapeSingleQuote(action.value || '')}');`
    }

    case 'upload': {
      const explicitParam = action.filePathArgName || 'filePath'
      if (hasArgs) {
        const paramName = resolveNodeParamName(
          branch,
          node.id,
          'dynamic_param',
          explicitParam,
          reg,
        )
        const defaultLiteral = action.filePath || action.value
          ? `'${escapeSingleQuote(action.filePath || action.value || '')}'`
          : undefined
        const pathExpr = defaultLiteral ? `args.${paramName} ?? ${defaultLiteral}` : `args.${paramName}`
        return `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().setInputFiles(${pathExpr});`
      }
      return `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().setInputFiles('${escapeSingleQuote(action.filePath || action.value || '')}');`
    }

    case 'check':
      return action.checked
        ? `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().check();`
        : `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().uncheck();`

    case 'keydown':
      return `${indent}page = await runActionAndCaptureNewPage(page, 'keydown', async () => {\n${indent}  await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().press('${action.key || 'Enter'}');\n${indent}});`

    case 'scroll':
      return `${indent}await page.mouse.wheel(0, ${action.scrollPosition?.y ?? 300});`

    case 'hover':
      return `${indent}await ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().hover();`

    case 'wait_for_selector':
      return `${indent}await waitWithSessionRecovery(\n${indent}  (t) => ${scopedLocatorExpr(action, undefined, scopeLoopItem)}.first().waitFor({ state: '${action.waitState || 'visible'}', timeout: t }),\n${indent});`

    case 'wait_for_url':
      return `${indent}await waitWithSessionRecovery(\n${indent}  (t) => page.waitForURL('${escapeSelector(action.url || '**')}', { timeout: t }),\n${indent});`

    case 'wait_for_timeout':
      return `${indent}await page.waitForTimeout(${action.waitTimeout || 1000});`

    case 'wait_for_navigation':
      return `${indent}await waitWithSessionRecovery(\n${indent}  (t) => page.waitForLoadState('networkidle', { timeout: t }),\n${indent});`

    case 'extract_selected_content': {
      const sel = action.extractedSelector || action.selector
      const loc = scopedLocatorExpr(action, sel, scopeLoopItem)
      if (action.extractMode === 'screenshot') {
        return `${indent}await ${loc}.first().screenshot({ path: \`extract-\${Date.now()}.png\` });\n${indent}results.push('screenshot saved');`
      }
      return `${indent}const text_${sanitizeVarName(node.id)} = await ${loc}.first().innerText();\n${indent}results.push(text_${sanitizeVarName(node.id)});`
    }

    default:
      return action.comment ? `${indent}// ${action.comment}` : ''
  }
}

// ---------------------------------------------------------------------------
// Enum click — selector lookup table
// ---------------------------------------------------------------------------

function generateEnumClick(
  node: OperationNode,
  indent: string,
  branch: Branch,
  reg?: ToolRegistration,
  scopeLoopItem = false,
): string {
  const action = node.metadata.selectorOverride
    ? { ...node.action, selector: node.metadata.selectorOverride }
    : node.action
  const param = branch.params.find(p => p.nodeId === node.id && p.source === 'enum_param')
  if (!param || !param.enumSelectorMap) {
    const innerText = action.innerText ? `'${escapeSingleQuote(action.innerText)}'` : 'undefined'
    const matchIdx = selectorMatchIndexExpr(action)
    return `${indent}page = await runActionAndCaptureNewPage(page, '${action.type}', async () => {\n${indent}  await clickBySelectorAndText(${scopedTargetExpr(action, scopeLoopItem)}, '${escapeSelector(action.selector)}', ${innerText}, 'click', ${matchIdx});\n${indent}});`
  }

  const paramName = resolveParamName(branch, node.id, param.name, reg)
  const mapName = `selectorMap_${sanitizeVarName(node.id)}`
  const defaultLiteral = paramDefaultLiteral(param)
  const valueExpr = defaultLiteral !== undefined ? `args.${paramName} ?? ${defaultLiteral}` : `args.${paramName}`
  const entries = Object.entries(param.enumSelectorMap)
    .map(([label, sel]) => `${indent}  '${escapeSingleQuote(label)}': '${escapeSelector(sel)}',`)
    .join('\n')

  return [
    `${indent}const ${mapName}: Record<string, string> = {`,
    entries,
    `${indent}};`,
    `${indent}page = await runActionAndCaptureNewPage(page, '${action.type}', async () => {`,
    `${indent}  await clickBySelectorAndText(${scopedTargetExpr(action, scopeLoopItem)}, ${mapName}[${valueExpr}], ${valueExpr}, 'click', ${selectorMatchIndexExpr(action)});`,
    `${indent}});`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Loop context
// ---------------------------------------------------------------------------

interface LoopContext {
  targetNodeId: string
  endNodeId: string | undefined
  bodyNodeIds: string[]
}

function buildLoopContext(path: OperationNode[]): LoopContext | undefined {
  const target = path.find(
    n => n.metadata.nodeRole === 'loop_target' && !!n.metadata.loopTargetPattern
  )
  if (!target) return undefined

  const startIdx = path.findIndex(n => n.id === target.id)
  const endId = target.metadata.loopBodyEndNodeId
  const isSelfOnly = !endId || endId === LOOP_BODY_END_SELF

  if (isSelfOnly) {
    return { targetNodeId: target.id, endNodeId: undefined, bodyNodeIds: [] }
  }

  const bodyIds: string[] = []
  for (let i = startIdx + 1; i < path.length; i++) {
    bodyIds.push(path[i].id)
    if (path[i].id === endId) break
  }

  return { targetNodeId: target.id, endNodeId: endId, bodyNodeIds: bodyIds }
}

/** 同 repeatGroupId 下、已由 for 抽象的首轮之外的扁平录制节点，避免循环后再生成一遍。 */
function buildRepeatGroupSkipIds(path: OperationNode[], loopCtx: LoopContext | undefined): Set<string> {
  if (!loopCtx) return new Set()
  const target = path.find(n => n.id === loopCtx.targetNodeId)
  const gid = target?.metadata.repeatGroupId
  if (!gid) return new Set()
  const keep = new Set<string>([loopCtx.targetNodeId, ...loopCtx.bodyNodeIds])
  const skip = new Set<string>()
  for (const n of path) {
    if (n.metadata.repeatGroupId === gid && !keep.has(n.id)) skip.add(n.id)
  }
  return skip
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

function generateMCPServer(branches: Branch[], serverName: string): string {
  const safeName = serverName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso-tools'
  const needsSession = branchesHaveWaitNodes(branches)

  const toolDefs = branches
    .filter(b => b.generatedCode)
    .map(b => {
      const reg = b.registration
      const fnName = reg?.toolName || `tool_${b.id.slice(0, 8)}`
      const baseDesc = reg?.toolDescription || `Auto-generated tool from branch ${b.id.slice(0, 8)}`
      const argsTypeName = toPascalCase(fnName) + 'Args'
      const behavior = summarizeToolBehavior(b)
      const desc = `${baseDesc} Applicable scenario: ${behavior.usageScenario} Side effects: ${behavior.sideEffects.join(' ')}`

      const properties: Record<string, object> = {}
      const required: string[] = []

      for (const p of b.params) {
        const paramName = resolveRegisteredParamName(p, reg)
        const prop: Record<string, unknown> = { type: p.type === 'enum' ? 'string' : p.type }
        prop.description = resolveParamBusinessDescription(p)
        if (p.enumOptions) prop.enum = p.enumOptions
        if (p.defaultValue !== undefined) prop.default = p.defaultValue
        properties[paramName] = prop
        if (isSchemaParamRequired(p)) required.push(paramName)
      }

      return { fnName, desc, argsTypeName, properties, required, hasArgs: b.params.length > 0 }
    })

  const toolsList = toolDefs.map(t => `    {
      name: "${t.fnName}",
      description: "${t.desc.replace(/"/g, '\\"')}",
      inputSchema: {
        type: "object" as const,
        properties: ${JSON.stringify(t.properties, null, 8).replace(/\n/g, '\n        ')},
        required: ${JSON.stringify(t.required)},
      },
    }`).join(',\n')

  const handlers = toolDefs.map(t => `    case "${t.fnName}":
      result = await ${t.fnName}(${t.hasArgs ? `request.params.arguments as ${t.argsTypeName}` : ''});
      break;`).join('\n')

  return `const SERVER_DESCRIPTION = "${sanitizeLiteralText(serverName)} MCP server generated by YOSO for browser workflow automation.";
const SERVER_BOUNDARY = {
  does: [
    "Executes pre-recorded browser workflows with Playwright.",
    "Exposes each validated workflow as an MCP tool with typed input schema.",
  ],
  doesNot: [
    "Does not bypass platform authentication, captcha, or security policy.",
    "Does not guarantee stability if target website layout or business flow changes.",
  ],
};
const RUNTIME_POLICY = {
  sessionBroker: ${needsSession},
  timeout: {
    actionDelayMs: ACTION_DELAY,
    navigationTimeoutMs: NAV_TIMEOUT,
    waitRecoveryMs: 120000,
  },
  concurrency: "single-tool-call-only",
};

function classifyToolError(error: unknown): {
  code: string;
  retryable: boolean;
  recovery: "retry" | "relogin" | "rerecord";
  message: string;
  sessionBrokerHint?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) {
    const row = { code: "RETRYABLE_TIMEOUT", retryable: true, recovery: "retry", message };
    if (RUNTIME_POLICY.sessionBroker) {
      const brokerPath = path.join(SESSION_BROKER_ROOT, SESSION_BROKER_VERSION, SESSION_BROKER_FILE);
      return {
        ...row,
        sessionBrokerHint:
          "Session broker is enabled (default HEADLESS=true). If this timeout is due to missing or expired auth, or slow UI in headless mode, export Playwright storage state from the YOSO extension and replace the broker file at: " +
          brokerPath +
          " For interactive local debugging, set HEADLESS=false in this script.",
      };
    }
    return row;
  }
  if (lower.includes("not logged in") || lower.includes("login") || lower.includes("auth")) {
    const row = { code: "NON_RETRYABLE_AUTH_REQUIRED", retryable: false, recovery: "relogin", message };
    if (RUNTIME_POLICY.sessionBroker) {
      const brokerPath = path.join(SESSION_BROKER_ROOT, SESSION_BROKER_VERSION, SESSION_BROKER_FILE);
      return {
        ...row,
        sessionBrokerHint:
          "Export a fresh Playwright storage state from the YOSO extension and replace: " +
          brokerPath,
      };
    }
    return row;
  }
  if (lower.includes("strict mode violation") || lower.includes("selector") || lower.includes("locator")) {
    return { code: "NON_RETRYABLE_SELECTOR_STALE", retryable: false, recovery: "rerecord", message };
  }
  if (lower.includes("invalid") || lower.includes("argument") || lower.includes("enum")) {
    return { code: "NON_RETRYABLE_INVALID_ARGUMENT", retryable: false, recovery: "rerecord", message };
  }
  return { code: "NON_RETRYABLE_UNKNOWN", retryable: false, recovery: "rerecord", message };
}

function encodePayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const server = new Server(
  { name: "${safeName}", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
${toolsList}
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const callStartedAt = new Date().toISOString();
  try {
    let result: unknown;
    switch (request.params.name) {
  ${handlers}
      default:
        const unknownPayload = {
          ok: false,
          error: {
            code: "NON_RETRYABLE_UNKNOWN_TOOL",
            message: \`Unknown tool: \${request.params.name}\`,
            retryable: false,
            recovery: "rerecord",
          },
          meta: {
            server: "${safeName}",
            toolName: request.params.name,
            timestamp: callStartedAt,
            serverDescription: SERVER_DESCRIPTION,
          },
        };
        return {
          content: [{ type: "text", text: encodePayload(unknownPayload) }],
          isError: true,
        };
    }
    const successPayload = {
      ok: true,
      data: result ?? {},
      meta: {
        server: "${safeName}",
        toolName: request.params.name,
        timestamp: callStartedAt,
        serverDescription: SERVER_DESCRIPTION,
        boundary: SERVER_BOUNDARY,
        runtime: RUNTIME_POLICY,
      },
    };
    return {
      content: [{ type: "text", text: encodePayload(successPayload) }],
    };
  } catch (error) {
    const classified = classifyToolError(error);
    const failPayload = {
      ok: false,
      error: {
        code: classified.code,
        message: classified.message,
        retryable: classified.retryable,
        recovery: classified.recovery,
        ...(classified.sessionBrokerHint !== undefined
          ? { sessionBrokerHint: classified.sessionBrokerHint }
          : {}),
      },
      meta: {
        server: "${safeName}",
        toolName: request.params.name,
        timestamp: callStartedAt,
        serverDescription: SERVER_DESCRIPTION,
        boundary: SERVER_BOUNDARY,
        runtime: RUNTIME_POLICY,
      },
    };
    return {
      content: [{ type: "text", text: encodePayload(failPayload) }],
      isError: true,
    };
  } finally {
    await closeBrowser();
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

main().catch(console.error);`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveParamName(
  branch: Branch,
  nodeId: string,
  fallback: string,
  reg?: ToolRegistration
): string {
  if (reg?.paramDescriptions?.[nodeId]) {
    return sanitizeParamName(reg.paramDescriptions[nodeId])
  }
  return sanitizeParamName(fallback)
}

function resolveNodeParamName(
  branch: Branch,
  nodeId: string,
  source: BranchParam['source'],
  fallback: string,
  reg?: ToolRegistration
): string {
  const param = branch.params.find(p => p.nodeId === nodeId && p.source === source)
  return resolveParamName(branch, nodeId, param?.name || fallback, reg)
}

function getParamDefaultLiteral(
  branch: Branch,
  nodeId: string,
  source: BranchParam['source'],
): string | undefined {
  const param = branch.params.find(p => p.nodeId === nodeId && p.source === source)
  return paramDefaultLiteral(param)
}

function paramDefaultLiteral(param?: BranchParam): string | undefined {
  if (!param || param.defaultValue === undefined || param.defaultValue === null) return undefined
  if (param.type === 'number') {
    const num = typeof param.defaultValue === 'number' ? param.defaultValue : Number(param.defaultValue)
    return Number.isFinite(num) ? String(num) : undefined
  }
  if (typeof param.defaultValue !== 'string') return undefined
  return `'${escapeSingleQuote(param.defaultValue)}'`
}

function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function sanitizeParamName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z]/, 'p_')
}

function sanitizeVarName(id: string): string {
  return id.replace(/-/g, '_').slice(0, 8)
}

function escapeSelector(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function escapeSingleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function normalizeFrameSelectors(action: RecordedAction): string[] {
  if (Array.isArray(action.frameSelectors) && action.frameSelectors.length > 0) {
    return action.frameSelectors.filter(Boolean)
  }
  if (action.frameSelector) return [action.frameSelector]
  return []
}

function frameTargetExpr(action: RecordedAction): string {
  const selectors = normalizeFrameSelectors(action)
  if (selectors.length === 0) return 'page'
  return selectors.reduce(
    (expr, sel) => `${expr}.frameLocator('${escapeSingleQuote(sel)}')`,
    'page',
  )
}

function targetExprAction(action: RecordedAction): string {
  return frameTargetExpr(action)
}

function locatorExprAction(action: RecordedAction, selector?: string): string {
  const sel = selector ?? action.selector ?? ''
  const esc = escapeSelector(sel)
  return `${frameTargetExpr(action)}.locator('${esc}')`
}

function fillSemanticsExpr(action: RecordedAction): string {
  const semantics = action.fillSemantics
  if (!semantics) return 'undefined'
  const parts: string[] = []
  if (typeof semantics.richText === 'boolean') parts.push(`richText: ${semantics.richText}`)
  if (typeof semantics.cursorAtEnd === 'boolean') parts.push(`cursorAtEnd: ${semantics.cursorAtEnd}`)
  if (typeof semantics.incremental === 'boolean') parts.push(`incremental: ${semantics.incremental}`)
  if (typeof semantics.preserveUndoStack === 'boolean') parts.push(`preserveUndoStack: ${semantics.preserveUndoStack}`)
  if (parts.length === 0) return 'undefined'
  return `{ ${parts.join(', ')} }`
}

function shouldInjectStartUrlNavigate(branch: Branch): boolean {
  const start = branch.startUrl?.trim()
  if (!start) return false
  const first = branch.path[0]?.action
  if (!first) return true
  if (first.type !== 'navigate') return true
  return (first.url?.trim() || '') !== start
}

const SESSION_WAIT_TYPES = new Set(['wait_for_selector', 'wait_for_url', 'wait_for_navigation'])

export function branchesHaveWaitNodes(branches: Branch[]): boolean {
  return branches.some(b =>
    b.path.some(n => SESSION_WAIT_TYPES.has(n.action.type))
  )
}

/**
 * Before an `upload` action (setInputFiles), suppress click actions that would
 * open the native file dialog and block Playwright:
 *  - clicks on the same selector as the upload (input[type=file])
 *  - clicks on input[type=file] generally
 *  - the click immediately preceding a suppressed file-input click
 *    (typically a visual trigger button like "上传图片")
 */
function buildUploadSuppressionSet(path: OperationNode[]): Set<string> {
  const suppressed = new Set<string>()
  for (let i = 0; i < path.length; i++) {
    if (path[i].action.type !== 'upload') continue
    const uploadSelector = path[i].action.selector
    for (let j = i - 1; j >= 0; j--) {
      const prev = path[j].action
      if (prev.type !== 'click' && prev.type !== 'dblclick') break
      const isFileInput = prev.inputType === 'file' || prev.attributes?.['type'] === 'file'
      const isSameSelector = prev.selector === uploadSelector
      if (isFileInput || isSameSelector) {
        suppressed.add(path[j].id)
        continue
      }
      const nextSuppressed = suppressed.has(path[j + 1].id)
      const nextIsFileInput = path[j + 1].action.inputType === 'file'
        || path[j + 1].action.attributes?.['type'] === 'file'
        || path[j + 1].action.selector === uploadSelector
      if (nextSuppressed && nextIsFileInput) {
        suppressed.add(path[j].id)
        continue
      }
      break
    }
  }
  return suppressed
}

function shouldStabilizeAction(actionType: string): boolean {
  return actionType === 'navigate'
    || actionType === 'click'
    || actionType === 'dblclick'
    || actionType === 'fill'
    || actionType === 'select'
    || actionType === 'check'
    || actionType === 'keydown'
    || actionType === 'scroll'
    || actionType === 'hover'
    || actionType === 'upload'
    || actionType === 'wait_for_selector'
    || actionType === 'wait_for_url'
    || actionType === 'wait_for_timeout'
    || actionType === 'wait_for_navigation'
    || actionType === 'extract_selected_content'
}
