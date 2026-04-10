import { useCallback } from 'react'
import { useLocaleStore } from '@/sidepanel/stores/localeStore'
import { translate, type MessageKey } from '@/sidepanel/locales/translate'

export function useI18n() {
  const locale = useLocaleStore(s => s.locale)
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  )
  return { t, locale }
}
