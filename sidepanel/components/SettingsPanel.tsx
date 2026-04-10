import { useState } from 'react'
import { useSettingsStore } from '@/sidepanel/stores/settingsStore'
import { useLocaleStore } from '@/sidepanel/stores/localeStore'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import { sendToBackground } from '@/utils/messaging'
import { MSG, type AppSettings, type LLMSettings, DEFAULT_SETTINGS } from '@/types/message'

export default function SettingsPanel() {
  const { t } = useI18n()
  const locale = useLocaleStore(s => s.locale)
  const setUiLocale = useLocaleStore(s => s.setLocale)
  const settings = useSettingsStore(s => s.settings)
  const settingsHydrated = useSettingsStore(s => s.settingsHydrated)
  const setSettings = useSettingsStore(s => s.setSettings)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const updateLLM = (updates: Partial<LLMSettings>) => {
    setSettings({ ...settings, llm: { ...settings.llm, ...updates } })
  }

  const updateAppSettings = (updates: Partial<AppSettings>) => {
    setSettings({ ...settings, ...updates })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await sendToBackground(MSG.SAVE_SETTINGS, settings)
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTestLLM = async () => {
    setTesting(true)
    setTestStatus('idle')
    setTestMessage(null)
    try {
      if (!settings.llm.apiKey || !settings.llm.model) {
        throw new Error(t('settings.errApiKeyModel'))
      }
      if (settings.llm.provider === 'openai-compatible' && !settings.llm.baseURL) {
        throw new Error(t('settings.errBaseUrl'))
      }
      await sendToBackground<{ sample: string }>(MSG.TEST_LLM_SETTINGS, {
        llmSettings: settings.llm,
      })
      setTestStatus('success')
      setTestMessage(t('settings.testOk'))
    } catch (err) {
      console.error('LLM config test failed:', err)
      setTestStatus('error')
      setTestMessage((err as Error).message || t('settings.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const handleExportConfig = () => {
    const json = JSON.stringify(settings, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yoso-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportConfig = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          const content = ev.target?.result as string
          const parsed = JSON.parse(content) as Partial<AppSettings> & { recorder?: unknown }
          if (parsed && parsed.llm && typeof parsed.llm === 'object') {
            const next: AppSettings = {
              ...DEFAULT_SETTINGS,
              llm: { ...DEFAULT_SETTINGS.llm, ...parsed.llm },
              llmSaveToToolset: parsed.llmSaveToToolset ?? DEFAULT_SETTINGS.llmSaveToToolset,
            }
            setSettings(next)
            await sendToBackground(MSG.SAVE_SETTINGS, next)
            alert(t('settings.importOk'))
          } else {
            throw new Error(t('settings.importInvalid'))
          }
        } catch (err) {
          alert(
            t('settings.importFailed', {
              msg: err instanceof Error ? err.message : t('settings.importInvalid'),
            })
          )
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  if (!settingsHydrated) {
    return <div className="p-4 text-xs text-gray-400">{t('settings.loading')}</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <section>
          <h3 className="text-xs font-medium text-gray-700 mb-2">{t('settings.uiLanguage')}</h3>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="uiLocale"
                checked={locale === 'zh'}
                onChange={() => setUiLocale('zh')}
                className="rounded-full"
              />
              {t('settings.langZh')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="uiLocale"
                checked={locale === 'en'}
                onChange={() => setUiLocale('en')}
                className="rounded-full"
              />
              {t('settings.langEn')}
            </label>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-medium text-gray-700 mb-2">{t('settings.llmSection')}</h3>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">{t('settings.provider')}</label>
              <select
                value={settings.llm.provider}
                onChange={e => updateLLM({ provider: e.target.value as LLMSettings['provider'] })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai-compatible">OpenAI Compatible</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">API Key</label>
              <input
                type="password"
                value={settings.llm.apiKey}
                onChange={e => updateLLM({ apiKey: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">{t('settings.model')}</label>
              <input
                type="text"
                value={settings.llm.model}
                onChange={e => updateLLM({ model: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                placeholder="gpt-4o"
              />
            </div>
            {settings.llm.provider === 'openai-compatible' && (
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Base URL</label>
                <input
                  type="text"
                  value={settings.llm.baseURL || ''}
                  onChange={e => updateLLM({ baseURL: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                  placeholder="https://api.example.com"
                />
              </div>
            )}
            <div className="pt-1 border-t border-gray-100 mt-1">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={handleTestLLM}
                  disabled={testing}
                  className="px-2 py-1 text-[10px] bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                >
                  {testing ? t('settings.testing') : t('settings.testConfig')}
                </button>
                {testStatus !== 'idle' && testMessage && (
                  <span
                    className={`text-[10px] ${
                      testStatus === 'success' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {testMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-medium text-gray-700 mb-2">{t('settings.toolsetExportSection')}</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.llmSaveToToolset ?? false}
                onChange={e => updateAppSettings({ llmSaveToToolset: e.target.checked })}
                className="rounded"
              />
              {t('settings.llmToToolset')}
            </label>
          </div>
        </section>
      </div>

      <div className="px-3 py-2 border-t border-gray-200 shrink-0 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleExportConfig}
            className="flex-1 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            {t('settings.export')}
          </button>
          <button
            onClick={handleImportConfig}
            className="flex-1 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            {t('settings.import')}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}
