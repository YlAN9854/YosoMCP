import type { ReplayStepResult } from '@/types/operationTree'
import { useReplayStore } from '@/sidepanel/stores/replayStore'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useI18n } from '@/sidepanel/hooks/useI18n'

function StepIcon({ result }: { result?: ReplayStepResult }) {
  if (!result) return <span className="text-gray-300">○</span>
  if (result.success) return <span className="text-green-500">✅</span>
  return <span className="text-red-500">❌</span>
}

export default function ReplayOverlay() {
  const { t } = useI18n()
  const { status, currentStep, totalSteps, stepResults, abortReplay, reset } =
    useReplayStore()
  const resetTreeRecording = useRecorderStore(state => state.resetTreeRecording)

  if (status === 'idle') return null

  const isRunning = status === 'replaying'
  const isCompleted = status === 'completed'
  const isFailed = status === 'failed'
  const isAborted = status === 'aborted'

  const progressPercent =
    totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0

  const failedStep = stepResults.find(r => !r.success)
  const totalDuration = stepResults.reduce((sum, r) => sum + r.duration, 0)

  const handleAbort = async () => {
    await abortReplay()
    resetTreeRecording()
  }

  return (
    <div className="absolute inset-0 z-50 bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-2"
        >
          {isRunning && (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-medium text-gray-800">{t('replay.running')}</span>
            </>
          )}
          {isCompleted && (
            <>
              <span className="text-sm">✅</span>
              <span className="text-sm font-medium text-green-700">{t('replay.completed')}</span>
            </>
          )}
          {isFailed && (
            <>
              <span className="text-sm">❌</span>
              <span className="text-sm font-medium text-red-700">
                {t('replay.failedStep', { step: (failedStep?.stepIndex ?? 0) + 1 })}
              </span>
            </>
          )}
          {isAborted && (
            <>
              <span className="text-sm">⏹️</span>
              <span className="text-sm font-medium text-gray-600">{t('replay.aborted')}</span>
            </>
          )}
        </div>
      </div>

      <div className="px-4 py-2">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>
            {t('replay.stepsProgress', { current: currentStep, total: totalSteps })}
          </span>
          {!isRunning && (
            <span>{t('replay.elapsed', { s: (totalDuration / 1000).toFixed(1) })}</span>
          )}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${
              isFailed ? 'bg-red-500' : isCompleted ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-1">
          {stepResults.map((result, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-xs py-1 ${
                result.success ? 'text-gray-600' : 'text-red-600'
              }`}
            >
              <StepIcon result={result} />
              <span className="flex-1 min-w-0 truncate">
                {t('replay.stepN', { n: result.stepIndex + 1 })}
              </span>
              <span className="text-gray-400 shrink-0">
                {result.duration}ms
              </span>
            </div>
          ))}

          {isRunning && currentStep < totalSteps && (
            <div className="flex items-center gap-2 text-xs py-1 text-blue-600">
              <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span>{t('replay.stepRunning', { n: currentStep + 1 })}</span>
            </div>
          )}

          {isRunning &&
            Array.from(
              { length: Math.max(0, totalSteps - currentStep - 1) },
              (_, i) => (
                <div
                  key={`pending-${i}`}
                  className="flex items-center gap-2 text-xs py-1 text-gray-300"
                >
                  <StepIcon />
                  <span>{t('replay.stepN', { n: currentStep + i + 2 })}</span>
                </div>
              )
            )}
        </div>

        {isFailed && failedStep && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <div className="font-medium mb-1">{t('replay.errorDetail')}</div>
            <div className="text-red-600">{failedStep.error}</div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200">
        {isRunning ? (
          <button
            onClick={handleAbort}
            className="min-h-11 w-full rounded bg-gray-100 px-2 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
          >
            {t('replay.abort')}
          </button>
        ) : (
          <button
            onClick={reset}
            className="min-h-11 w-full rounded bg-gray-100 px-2 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
          >
            {t('replay.close')}
          </button>
        )}
      </div>
    </div>
  )
}
