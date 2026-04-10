import { useState } from 'react'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { formatSelector } from '@/sidepanel/utils/smartWait'
import type { ElementInfo } from '@/sidepanel/utils/smartWait'
import { v4 as uuidv4 } from 'uuid'
import type { RecordedAction } from '@/types/action'
import { MSG } from '@/types/message'
import { sendToBackground } from '@/utils/messaging'
import { useI18n } from '@/sidepanel/hooks/useI18n'

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  a:      { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  button: { bg: 'bg-green-100',  text: 'text-green-700'  },
  input:  { bg: 'bg-orange-100', text: 'text-orange-700' },
  select: { bg: 'bg-purple-100', text: 'text-purple-700' },
}
function tagColor(tagName: string) {
  return TAG_COLORS[tagName] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
}

interface DisplayElement {
  selector: string
  tagName: string
  text: string
  id?: string
  href?: string
  ariaLabel?: string
}

function toDisplayElements(
  newElements: ElementInfo[],
  newSelectors: string[]
): DisplayElement[] {
  if (newElements.length > 0) return newElements

  return newSelectors.map(s => {
    const formatted = formatSelector(s)
    const tagMatch = formatted.match(/^([a-z0-9]+)/i)
    const textMatch = formatted.match(/:has-text\("(.+?)"\)/)
    return {
      selector: formatted,
      tagName: tagMatch?.[1] ?? 'element',
      text: textMatch?.[1] ?? formatted,
    }
  })
}

function ElementCard({
  element,
  isSelected,
  onClick,
}: {
  element: DisplayElement
  isSelected: boolean
  onClick: () => void
}) {
  const { bg, text: textCls } = tagColor(element.tagName)
  const secondary = element.id
    ? `#${element.id}`
    : element.ariaLabel
      ? `aria: ${element.ariaLabel}`
      : element.href
        ? `href: ${element.href}`
        : undefined

  return (
    <div
      onClick={onClick}
      className={`flex flex-col gap-0.5 p-2 rounded-md border cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${bg} ${textCls}`}>
          &lt;{element.tagName}&gt;
        </span>
        {element.text && (
          <span className="text-xs text-gray-800 truncate flex-1">
            {element.text}
          </span>
        )}
      </div>

      {secondary && (
        <div className="text-[10px] text-gray-400 truncate pl-0.5">
          {secondary}
        </div>
      )}

      <div className="text-[10px] text-gray-300 truncate pl-0.5 font-mono" title={element.selector}>
        {element.selector}
      </div>
    </div>
  )
}

export default function WaitConfiguration() {
  const { t } = useI18n()
  const diff = useRecorderStore(s => s.pendingWaitDiff)
  const resetSmartWait = useRecorderStore(s => s.resetSmartWait)
  const addAction = useRecorderStore(s => s.addAction)
  const setStatus = useRecorderStore(s => s.setStatus)

  const displayElements = diff
    ? toDisplayElements(diff.newElements ?? [], diff.newSelectors)
    : []

  const hasNewElements = displayElements.length > 0

  const [selectedType, setSelectedType] = useState<'url' | 'selector' | 'timeout'>(() => {
    if (diff?.urlChanged) return 'url'
    if (hasNewElements) return 'selector'
    return 'timeout'
  })

  const [selectedSelector, setSelectedSelector] = useState<string>(() => {
    if (diff?.newElements && diff.newElements.length > 0) return diff.newElements[0].selector
    if (diff?.newSelectors && diff.newSelectors.length > 0) return formatSelector(diff.newSelectors[0])
    return ''
  })

  const [comment, setComment] = useState('')

  if (!diff) return null

  const handleConfirm = async () => {
    let action: RecordedAction

    const common = {
      id: uuidv4(),
      timestamp: Date.now(),
      comment: comment || undefined,
    }

    if (selectedType === 'url') {
      action = {
        ...common,
        type: 'wait_for_url',
        selector: '',
        url: diff.newUrl,
        comment: comment || `Wait for navigation to ${diff.newUrl}`,
        waitTimeout: Math.max(diff.duration + 5000, 30000),
      }
    } else if (selectedType === 'selector') {
      const finalSelector = selectedSelector.includes(':text=')
        ? formatSelector(selectedSelector)
        : selectedSelector
      action = {
        ...common,
        type: 'wait_for_selector',
        selector: finalSelector,
        comment: comment || `Wait for element ${finalSelector} to appear`,
        waitState: 'visible',
        waitTimeout: Math.max(diff.duration + 5000, 30000),
      }
    } else {
      action = {
        ...common,
        type: 'wait_for_timeout',
        selector: '',
        comment: comment || `Wait for ${Math.ceil(diff.duration / 1000)} seconds`,
        waitTimeout: diff.duration,
      }
    }

    addAction(action)
    resetSmartWait()

    try {
      await sendToBackground(MSG.RESUME_RECORDING)
      setStatus('recording')
    } catch (e) {
      console.error('Failed to resume recording:', e)
    }
  }

  const handleCancel = () => {
    resetSmartWait()
  }

  return (
    <div className="absolute inset-0 bg-white z-50 flex flex-col p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>⚙️</span> {t('wait.title')}
        </h2>
        <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4">
        {diff.urlChanged && (
          <label className={`block p-3 border rounded-lg cursor-pointer transition-all ${selectedType === 'url' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="waitType"
                checked={selectedType === 'url'}
                onChange={() => setSelectedType('url')}
                className="mt-1"
              />
              <div className="flex-1 overflow-hidden">
                <div className="font-medium text-sm text-gray-900">{t('wait.urlChange')}</div>
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[10px] text-gray-400">{t('wait.oldUrl')}</span>
                  <span className="text-xs text-gray-500 truncate" title={diff.oldUrl}>{diff.oldUrl}</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">{t('wait.newUrl')}</span>
                  <span className="text-xs text-blue-600 truncate font-medium" title={diff.newUrl}>{diff.newUrl}</span>
                </div>
              </div>
            </div>
          </label>
        )}

        {hasNewElements && (
          <div
            className={`block p-3 border rounded-lg transition-all ${selectedType === 'selector' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200'}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="waitType"
                checked={selectedType === 'selector'}
                onChange={() => setSelectedType('selector')}
                className="mt-1 shrink-0 cursor-pointer"
              />
              <div className="flex-1 overflow-hidden min-w-0">
                <div
                  className="font-medium text-sm text-gray-900 cursor-pointer"
                  onClick={() => setSelectedType('selector')}
                >
                  {t('wait.newElements')}
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    {t('wait.candidates', { n: displayElements.length })}
                  </span>
                </div>

                {selectedType === 'selector' && (
                  <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {displayElements.map((el, i) => (
                      <ElementCard
                        key={el.selector + i}
                        element={el}
                        isSelected={selectedSelector === el.selector}
                        onClick={() => {
                          setSelectedSelector(el.selector)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <label className={`block p-3 border rounded-lg cursor-pointer transition-all ${selectedType === 'timeout' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-300'}`}>
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="waitType"
              checked={selectedType === 'timeout'}
              onChange={() => setSelectedType('timeout')}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-sm text-gray-900">{t('wait.fixedDuration')}</div>
              <div className="text-xs text-gray-500 mt-1">
                {t('wait.waitSeconds', { n: Math.ceil(diff.duration / 1000) })}
              </div>
            </div>
          </div>
        </label>

        <div className="pt-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('wait.commentLabel')}</label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('wait.commentPlaceholder')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        >
          {t('wait.cancel')}
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          {t('wait.confirm')}
        </button>
      </div>
    </div>
  )
}
