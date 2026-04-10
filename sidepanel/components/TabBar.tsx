import { useI18n } from '@/sidepanel/hooks/useI18n'

export type TabKey = 'record' | 'branches' | 'settings'

interface TabBarProps {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

const tabs: { key: TabKey; labelKey: 'tabBar.record' | 'tabBar.branches' | 'tabBar.settings'; icon: string }[] = [
  { key: 'record', labelKey: 'tabBar.record', icon: '⏺' },
  { key: 'branches', labelKey: 'tabBar.branches', icon: '🔀' },
  { key: 'settings', labelKey: 'tabBar.settings', icon: '⚙' },
]

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()
  return (
    <div className="flex items-center bg-white border-b border-gray-200 px-2 h-10 shrink-0">
      <span className="font-bold text-sm text-blue-600 mr-3">YOSO</span>
      <div className="flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.icon} {t(tab.labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
