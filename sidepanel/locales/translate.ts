import type { UiLocale } from '@/sidepanel/stores/localeStore'
import { en } from '@/sidepanel/locales/en'
import { zh } from '@/sidepanel/locales/zh'

export type MessageKey = keyof typeof zh

export function translate(
  locale: UiLocale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const table = locale === 'en' ? en : zh
  let s = table[key]
  if (vars && s) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}
