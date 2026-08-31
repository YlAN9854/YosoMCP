import { useEffect } from 'react'
import RecordingTab from '@/sidepanel/components/RecordingTab'
import ToolSetSelector from '@/sidepanel/components/ToolSetSelector'
import { loadStoredLocale, useLocaleStore } from '@/sidepanel/stores/localeStore'

export default function App() {
  const hydrateLocale = useLocaleStore(s => s.hydrateLocale)

  useEffect(() => {
    loadStoredLocale().then(hydrateLocale)
  }, [hydrateLocale])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900">
      <ToolSetSelector />
      <main className="min-h-0 flex-1 overflow-hidden" aria-label="YOSO Flow Recorder">
        <RecordingTab />
      </main>
    </div>
  )
}
