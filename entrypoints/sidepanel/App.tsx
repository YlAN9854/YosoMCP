import { useEffect, useState } from 'react'
import TabBar from '@/sidepanel/components/TabBar'
import type { TabKey } from '@/sidepanel/components/TabBar'
import RecordingTab from '@/sidepanel/components/RecordingTab'
import BranchPanel from '@/sidepanel/components/BranchPanel'
import SettingsPanel from '@/sidepanel/components/SettingsPanel'
import ToolSetSelector from '@/sidepanel/components/ToolSetSelector'
import { useSettingsStore } from '@/sidepanel/stores/settingsStore'
import { loadStoredLocale, useLocaleStore } from '@/sidepanel/stores/localeStore'
import { sendToBackground } from '@/utils/messaging'
import { MSG, type AppSettings, DEFAULT_SETTINGS } from '@/types/message'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('record')
  const setSettings = useSettingsStore(s => s.setSettings)
  const hydrateLocale = useLocaleStore(s => s.hydrateLocale)

  useEffect(() => {
    loadStoredLocale().then(hydrateLocale)
  }, [hydrateLocale])

  useEffect(() => {
    sendToBackground<AppSettings>(MSG.GET_SETTINGS)
      .then(setSettings)
      .catch(err => {
        console.error('Failed to load settings:', err)
        setSettings(DEFAULT_SETTINGS)
      })
  }, [setSettings])

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="shrink-0 border-b border-gray-200">
        <ToolSetSelector />
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'record' && <RecordingTab />}
        {activeTab === 'branches' && <BranchPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  )
}
