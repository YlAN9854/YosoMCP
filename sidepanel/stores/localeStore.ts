import { create } from 'zustand'

export type UiLocale = 'zh' | 'en'

const STORAGE_KEY = 'uiLocale'

interface LocaleState {
  locale: UiLocale
  localeHydrated: boolean
  setLocale: (locale: UiLocale) => void
  hydrateLocale: (locale: UiLocale | undefined) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'zh',
  localeHydrated: false,
  setLocale: (locale) => {
    set({ locale })
    void chrome.storage.local.set({ [STORAGE_KEY]: locale })
  },
  hydrateLocale: (loaded) => {
    const locale = loaded === 'en' ? 'en' : 'zh'
    set({ locale, localeHydrated: true })
  },
}))

export async function loadStoredLocale(): Promise<UiLocale | undefined> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const v = result[STORAGE_KEY]
  return v === 'en' ? 'en' : v === 'zh' ? 'zh' : undefined
}
