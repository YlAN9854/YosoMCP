// Settings 存储 — chrome.storage.sync

import type { AppSettings } from '@/types/message'
import { DEFAULT_SETTINGS } from '@/types/message'

function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object' || !('llm' in raw)) return DEFAULT_SETTINGS
  const r = raw as Partial<AppSettings>
  return {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, ...r.llm },
    llmSaveToToolset: r.llmSaveToToolset ?? DEFAULT_SETTINGS.llmSaveToToolset,
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const result = await chrome.storage.sync.get('settings')
  return normalizeSettings(result.settings)
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await loadSettings()
  const next: AppSettings = {
    ...current,
    ...settings,
    llm: settings.llm ? { ...current.llm, ...settings.llm } : current.llm,
  }
  await chrome.storage.sync.set({ settings: next })
}
