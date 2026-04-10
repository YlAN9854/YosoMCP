import type { Branch } from '@/types/branch'
import type { SessionExportStrategy, SkillSessionExportResult } from '@/types/message'

interface ExportSkillSessionParams {
  branches: Branch[]
  toolSetName: string
  strategy?: SessionExportStrategy
}

type PlaywrightSameSite = 'Strict' | 'Lax' | 'None'

interface PlaywrightStorageStateCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: PlaywrightSameSite
}

interface PlaywrightStorageState {
  cookies: PlaywrightStorageStateCookie[]
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
}

function normalizeOrigin(rawUrl?: string): string | null {
  if (!rawUrl) return null
  const sanitized = rawUrl.trim().replace(/^`|`$/g, '')
  try {
    const parsed = new URL(sanitized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname) return null
    return parsed.origin.toLowerCase()
  } catch {
    return null
  }
}

function collectSessionOrigins(branches: Branch[]): string[] {
  const origins = new Set<string>()
  for (const branch of branches) {
    const startOrigin = normalizeOrigin(branch.startUrl)
    if (startOrigin) origins.add(startOrigin)
    for (const node of branch.path) {
      if (node.action.type !== 'navigate' && node.action.type !== 'wait_for_url') continue
      const actionOrigin = normalizeOrigin(node.action.url)
      if (actionOrigin) origins.add(actionOrigin)
    }
  }
  return Array.from(origins)
}

function collectDomainCandidates(origins: string[]): string[] {
  const domains = new Set<string>()
  for (const origin of origins) {
    try {
      const host = new URL(origin).hostname.toLowerCase()
      const parts = host.split('.').filter(Boolean)
      if (parts.length < 2) continue
      for (let i = 0; i <= parts.length - 2; i++) {
        const candidate = parts.slice(i).join('.')
        if (candidate) domains.add(candidate)
      }
    } catch {
      continue
    }
  }
  return Array.from(domains)
}

function mapSameSite(value?: string): PlaywrightSameSite {
  if (value === 'strict') return 'Strict'
  if (value === 'lax') return 'Lax'
  return 'None'
}

function toPlaywrightCookie(cookie: chrome.cookies.Cookie): PlaywrightStorageStateCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expirationDate ?? -1,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: mapSameSite(cookie.sameSite),
  }
}

function safeName(text: string): string {
  return text.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso-skill'
}

async function collectLocalStorageByOrigin(
  origins: string[],
): Promise<Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>> {
  const targets = new Set(origins)
  const states = new Map<string, Array<{ name: string; value: string }>>()
  for (const origin of origins) states.set(origin, [])
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue
    const tabOrigin = normalizeOrigin(tab.url)
    if (!tabOrigin || !targets.has(tabOrigin)) continue
    if ((states.get(tabOrigin)?.length ?? 0) > 0) continue
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const pairs: Array<{ name: string; value: string }> = []
          for (let i = 0; i < window.localStorage.length; i++) {
            const name = window.localStorage.key(i)
            if (!name) continue
            const value = window.localStorage.getItem(name)
            if (value === null) continue
            pairs.push({ name, value })
          }
          return pairs
        },
      })
      const payload = result?.result
      if (Array.isArray(payload)) {
        const filtered = payload.filter(
          item =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as { name?: unknown }).name === 'string' &&
            typeof (item as { value?: unknown }).value === 'string',
        ) as Array<{ name: string; value: string }>
        states.set(tabOrigin, filtered)
      }
    } catch {
      continue
    }
  }
  return origins.map(origin => ({
    origin,
    localStorage: states.get(origin) ?? [],
  }))
}

export async function exportSkillSession(params: ExportSkillSessionParams): Promise<SkillSessionExportResult> {
  const strategy: SessionExportStrategy = params.strategy ?? 'main-and-login-chain'
  const candidates = params.branches.filter(branch => branch.replayStatus === 'code-ready')
  if (candidates.length === 0) {
    throw new Error('当前没有 code-ready 分支，无法导出会话')
  }
  const origins = collectSessionOrigins(candidates)
  if (origins.length === 0) {
    throw new Error('未从分支中解析到可导出的站点 origin')
  }
  const domainCandidates = collectDomainCandidates(origins)

  const cookieMap = new Map<string, chrome.cookies.Cookie>()
  for (const origin of origins) {
    const list = await chrome.cookies.getAll({ url: origin })
    for (const cookie of list) {
      const key = `${cookie.name}|${cookie.domain}|${cookie.path}`
      cookieMap.set(key, cookie)
    }
  }
  for (const domain of domainCandidates) {
    const variants = [domain, `.${domain}`]
    for (const variant of variants) {
      const list = await chrome.cookies.getAll({ domain: variant })
      for (const cookie of list) {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`
        cookieMap.set(key, cookie)
      }
    }
  }
  const originStates = await collectLocalStorageByOrigin(origins)

  const storageState: PlaywrightStorageState = {
    cookies: Array.from(cookieMap.values()).map(toPlaywrightCookie),
    origins: originStates,
  }

  return {
    filename: `${safeName(params.toolSetName)}-session.json`,
    content: JSON.stringify(storageState, null, 2),
    summary: {
      strategy,
      domains: origins,
      cookieCount: storageState.cookies.length,
    },
  }
}
