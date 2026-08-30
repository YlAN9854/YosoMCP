import { useState, useEffect } from 'react'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { sendToBackground } from '@/utils/messaging'
import { MSG, CS_MSG } from '@/types/message'
import { calculateWaitDiff } from '@/sidepanel/utils/smartWait'
import { useI18n } from '@/sidepanel/hooks/useI18n'

export default function RecordingControls() {
  const { t } = useI18n()
  const status = useRecorderStore(s => s.status)
  const setStatus = useRecorderStore(s => s.setStatus)
  const nodeCount = useRecorderStore(s => s.nodes.length)

  const smartWaitStatus = useRecorderStore(s => s.smartWaitStatus)
  const smartWaitStartTime = useRecorderStore(s => s.smartWaitStartTime)
  const initialSnapshot = useRecorderStore(s => s.initialSnapshot)
  const nodes = useRecorderStore(s => s.nodes)
  const activeRecordingParentId = useRecorderStore(s => s.activeRecordingParentId)
  const startSmartWait = useRecorderStore(s => s.startSmartWait)
  const finishSmartWaitAndPick = useRecorderStore(s => s.finishSmartWaitAndPick)
  const cancelWaitElementPicker = useRecorderStore(s => s.cancelWaitElementPicker)
  const startContentExtractPicker = useRecorderStore(s => s.startContentExtractPicker)
  const cancelContentExtractPicker = useRecorderStore(s => s.cancelContentExtractPicker)
  const contentExtractPickerActive = useRecorderStore(s => s.contentExtractPickerActive)
  const startUploadPicker = useRecorderStore(s => s.startUploadPicker)
  const cancelUploadPicker = useRecorderStore(s => s.cancelUploadPicker)
  const uploadPickerActive = useRecorderStore(s => s.uploadPickerActive)
  const startHoverPicker = useRecorderStore(s => s.startHoverPicker)
  const cancelHoverPicker = useRecorderStore(s => s.cancelHoverPicker)
  const hoverPickerActive = useRecorderStore(s => s.hoverPickerActive)

  const [elapsedTime, setElapsedTime] = useState(0)
  const [useStartUrl, setUseStartUrl] = useState(false)
  const [startUrl, setStartUrl] = useState('')
  const [startError, setStartError] = useState('')

  useEffect(() => {
    let timer: number
    if (smartWaitStatus === 'waiting' && smartWaitStartTime) {
      timer = window.setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - smartWaitStartTime) / 1000))
      }, 1000)
    } else {
      setElapsedTime(0)
    }
    return () => clearInterval(timer)
  }, [smartWaitStatus, smartWaitStartTime])

  const getActiveTabId = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.id
  }

  const handleStart = async () => {
    setStartError('')
    try {
      const payload: { showIndicator: boolean; startUrl?: string } = { showIndicator: true }
      if (useStartUrl && startUrl.trim()) payload.startUrl = startUrl.trim()
      await sendToBackground(MSG.START_RECORDING, payload)
      setStatus('recording')
    } catch (err) {
      console.error('Failed to start recording:', err)
      setStartError((err as Error).message)
    }
  }

  const handlePause = async () => {
    try {
      await sendToBackground(MSG.PAUSE_RECORDING)
      setStatus('paused')
    } catch (err) {
      console.error('Failed to pause recording:', err)
    }
  }

  const handleResume = async () => {
    try {
      await sendToBackground(MSG.RESUME_RECORDING)
      setStatus('recording')
    } catch (err) {
      console.error('Failed to resume recording:', err)
    }
  }

  const handleStop = async () => {
    try {
      await sendToBackground(MSG.STOP_RECORDING)
      setStatus('idle')
    } catch (err) {
      console.error('Failed to stop recording:', err)
    }
  }

  const handleStartWait = async () => {
    try {
      if (status === 'recording') {
        await handlePause()
      }

      const tabId = await getActiveTabId()
      if (!tabId) return

      const response: any = await chrome.tabs.sendMessage(tabId, { type: CS_MSG.GET_PAGE_SNAPSHOT })
      if (response.success) {
        startSmartWait(Date.now(), response.data)
      }
    } catch (err) {
      console.error('Failed to start smart wait:', err)
    }
  }

  const handleEndWait = async () => {
    try {
      if (!initialSnapshot || !smartWaitStartTime) return

      const tabId = await getActiveTabId()
      if (!tabId) return

      const response: any = await chrome.tabs.sendMessage(tabId, { type: CS_MSG.GET_PAGE_SNAPSHOT })
      if (response.success) {
        const diff = calculateWaitDiff(
          initialSnapshot,
          response.data,
          smartWaitStartTime,
          Date.now()
        )
        finishSmartWaitAndPick(diff)
      }
    } catch (err) {
      console.error('Failed to end smart wait:', err)
    }
  }

  const insertAnchorNodeId =
    activeRecordingParentId ?? (nodes.length > 0 ? nodes[nodes.length - 1].id : null)

  const handleInsertContentExtract = () => {
    if (!insertAnchorNodeId) return
    startContentExtractPicker(insertAnchorNodeId)
  }

  const handleInsertHover = () => {
    if (!insertAnchorNodeId) return
    startHoverPicker(insertAnchorNodeId)
  }

  const handleInsertUpload = () => {
    if (!insertAnchorNodeId) return
    startUploadPicker(insertAnchorNodeId)
  }

  if (hoverPickerActive) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-amber-700 font-medium">
            <span className="animate-pulse">👆</span>
            {t('recording.hoverPicking')}
          </div>
          <button
            onClick={() => cancelHoverPicker()}
            className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
          >
            {t('wait.cancel')}
          </button>
        </div>
        <div className="text-[10px] text-amber-400">
          {t('recording.hoverHint')}
        </div>
      </div>
    )
  }

  if (contentExtractPickerActive) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-purple-50 border-b border-purple-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-purple-700 font-medium">
            <span className="animate-pulse">📝</span>
            {t('recording.extractPicking')}
          </div>
          <button
            onClick={() => cancelContentExtractPicker()}
            className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
          >
            {t('wait.cancel')}
          </button>
        </div>
        <div className="text-[10px] text-purple-400">
          {t('recording.extractHint')}
        </div>
      </div>
    )
  }

  if (uploadPickerActive) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-teal-50 border-b border-teal-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-teal-700 font-medium">
            <span className="animate-pulse">📎</span>
            {t('recording.uploadPicking')}
          </div>
          <button
            onClick={() => cancelUploadPicker()}
            className="px-3 py-1 text-xs bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors"
          >
            {t('wait.cancel')}
          </button>
        </div>
        <div className="text-[10px] text-teal-500">
          {t('recording.uploadHint')}
        </div>
      </div>
    )
  }

  if (smartWaitStatus === 'waiting') {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-700 font-medium">
            <span className="animate-pulse">⏳</span>
            {t('recording.waiting', { n: elapsedTime })}
          </div>
          <button
            onClick={handleEndWait}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            {t('recording.finishWait')}
          </button>
        </div>
        <div className="text-[10px] text-blue-400">
          {t('recording.waitNotice')}
        </div>
      </div>
    )
  }

  if (smartWaitStatus === 'picking') {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-emerald-50 border-b border-emerald-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
            <span className="animate-pulse">👆</span>
            {t('recording.pickWaitTarget')}
          </div>
          <button
            onClick={() => cancelWaitElementPicker()}
            className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
          >
            {t('wait.cancel')}
          </button>
        </div>
        <div className="text-[10px] text-emerald-400">
          {t('recording.waitPickHint')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
      {status === 'idle' && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={useStartUrl}
                onChange={e => setUseStartUrl(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t('recording.startFromUrl')}
            </label>
            {useStartUrl && (
              <input
                type="url"
                value={startUrl}
                onChange={e => setStartUrl(e.target.value)}
                placeholder={t('recording.startUrlPlaceholder')}
                className="flex-1 min-w-[180px] px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
            <button
              onClick={handleStart}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-red-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
            >
              <span className="w-2 h-2 rounded-full bg-white" />
              {t('recording.start')}
            </button>
          </div>
          {startError && (
            <div className="text-xs text-red-600" role="alert">
              {startError}
            </div>
          )}
        </div>
      )}

      {status === 'recording' && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {t('recording.recording')}
          </div>
          <button
            onClick={handlePause}
            className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors"
          >
            {t('recording.pause')}
          </button>
          <button
            onClick={handleStartWait}
            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            title={t('recording.waitTitle')}
          >
            {t('recording.wait')}
          </button>
          <button
            onClick={handleInsertContentExtract}
            className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
            title={t('recording.extractTitle')}
          >
            {t('recording.extract')}
          </button>
          <button
            onClick={handleInsertHover}
            className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
            title={t('recording.hoverTitle')}
          >
            {t('recording.hover')}
          </button>
          <button
            onClick={handleInsertUpload}
            className="px-2 py-1 text-xs bg-teal-100 text-teal-700 rounded hover:bg-teal-200 transition-colors"
            title={t('recording.uploadTitle')}
          >
            {t('recording.upload')}
          </button>
          <button
            onClick={handleStop}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            {t('recording.stop')}
          </button>
        </>
      )}

      {status === 'paused' && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-yellow-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {t('recording.paused')}
          </div>
          <button
            onClick={handleResume}
            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
          >
            {t('recording.resume')}
          </button>
          <button
            onClick={handleStartWait}
            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            title={t('recording.waitTitle')}
          >
            {t('recording.wait')}
          </button>
          <button
            onClick={handleInsertContentExtract}
            className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
            title={t('recording.extractTitle')}
          >
            {t('recording.extract')}
          </button>
          <button
            onClick={handleInsertHover}
            className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
            title={t('recording.hoverTitle')}
          >
            {t('recording.hover')}
          </button>
          <button
            onClick={handleInsertUpload}
            className="px-2 py-1 text-xs bg-teal-100 text-teal-700 rounded hover:bg-teal-200 transition-colors"
            title={t('recording.uploadTitle')}
          >
            {t('recording.upload')}
          </button>
          <button
            onClick={handleStop}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            {t('recording.stop')}
          </button>
        </>
      )}

      <span className="ml-auto text-xs text-gray-400">{t('recording.opCount', { count: nodeCount })}</span>
    </div>
  )
}
