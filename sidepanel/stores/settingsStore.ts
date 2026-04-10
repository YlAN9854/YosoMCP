import { create } from 'zustand'
import type { AppSettings } from '@/types/message'
import { DEFAULT_SETTINGS } from '@/types/message'

interface SettingsState {
  settings: AppSettings
  /** 是否已从 chrome.storage 完成首次加载（由 App 挂载时拉取） */
  settingsHydrated: boolean
  setSettings: (s: AppSettings) => void
  updateSettings: (updates: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsHydrated: false,
  setSettings: (s) => set({ settings: s, settingsHydrated: true }),
  updateSettings: (updates) => set({ settings: { ...get().settings, ...updates } }),
}))
