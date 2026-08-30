import { useState, useEffect } from 'react'
import { useToolsetStore } from '@/sidepanel/stores/toolsetStore'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { sendToBackground } from '@/utils/messaging'
import { MSG } from '@/types/message'
import type { ToolSet } from '@/types/toolset'
import type { OperationTreeInfo } from '@/types/operationTree'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import { buildToolSetSnapshot } from '@/sidepanel/utils/toolsetSnapshot'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function ToolSetSelector() {
  const { t } = useI18n()
  const toolSets = useToolsetStore(s => s.toolSets)
  const currentToolSetId = useToolsetStore(s => s.currentToolSetId)
  const setToolSets = useToolsetStore(s => s.setToolSets)
  const setCurrentToolSetId = useToolsetStore(s => s.setCurrentToolSetId)
  const [showMenu, setShowMenu] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const recorderNodes = useRecorderStore(s => s.nodes)
  const targetUrl = useRecorderStore(s => s.targetUrl)
  const setRecorderNodes = useRecorderStore(s => s.setNodes)
  const setRecorderTargetUrl = useRecorderStore(s => s.setTargetUrl)

  const currentToolSet = toolSets.find(ts => ts.id === currentToolSetId) ?? null
  const hasNodes = recorderNodes.length > 0

  useEffect(() => {
    sendToBackground<ToolSet[]>(MSG.TOOLSET_LIST)
      .then(list => setToolSets(list ?? []))
      .catch(() => {})
  }, [setToolSets])

  useEffect(() => {
    setSaveState('idle')
    setSaveError(null)
  }, [currentToolSetId, recorderNodes, targetUrl])

  const handleCreate = async () => {
    const name = prompt(t('toolset.promptName'))
    if (!name) return
    try {
      const newSet = await sendToBackground<ToolSet>(MSG.TOOLSET_CREATE, { name })
      setToolSets([...toolSets, newSet])
      setCurrentToolSetId(newSet.id)
    } catch (err) {
      console.error('新建工具集失败:', err)
    }
    setShowMenu(false)
  }

  const handleRegisterCurrentTree = async () => {
    const name = prompt(t('toolset.promptName'))
    if (!name) return

    const rootNodes = recorderNodes.filter(n => n.parentId === null)
    const operationTrees: OperationTreeInfo[] = rootNodes.map(n => ({
      id: crypto.randomUUID(),
      rootNodeId: n.id,
      label: n.action.url ?? n.action.type,
    }))

    try {
      const newSet = await sendToBackground<ToolSet>(MSG.TOOLSET_CREATE, {
        name,
        nodes: recorderNodes,
        operationTrees,
        targetUrl: targetUrl ?? undefined,
      })
      setToolSets([...toolSets, newSet])
      setCurrentToolSetId(newSet.id)
    } catch (err) {
      console.error('登记工具集失败:', err)
    }
    setShowMenu(false)
  }

  const handleSwitch = async (id: string) => {
    try {
      const toolSet = await sendToBackground<ToolSet>(MSG.TOOLSET_LOAD, { id })
      if (toolSet) {
        setCurrentToolSetId(id)
        setRecorderNodes(toolSet.operationNodes ?? [])
        setRecorderTargetUrl(toolSet.targetUrl ?? null)
      }
    } catch (err) {
      console.error('切换工具集失败:', err)
    }
    setShowMenu(false)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('toolset.confirmDelete'))) return
    try {
      await sendToBackground(MSG.TOOLSET_DELETE, { id })
      setToolSets(toolSets.filter(ts => ts.id !== id))
      if (currentToolSetId === id) setCurrentToolSetId(null)
    } catch (err) {
      console.error('删除工具集失败:', err)
    }
  }

  const handleRename = async () => {
    if (!currentToolSet) return
    const newName = prompt(t('toolset.promptRename'), currentToolSet.name)
    if (!newName || newName === currentToolSet.name) return
    const updated: ToolSet = { ...currentToolSet, name: newName, updatedAt: Date.now() }
    try {
      await sendToBackground(MSG.TOOLSET_SAVE, updated)
      setToolSets(toolSets.map(ts => ts.id === updated.id ? updated : ts))
    } catch (err) {
      console.error('重命名工具集失败:', err)
    }
  }

  const handleSave = async () => {
    if (!currentToolSet) return
    const snapshot = buildToolSetSnapshot(currentToolSet, recorderNodes, targetUrl)
    setSaveState('saving')
    setSaveError(null)
    try {
      await sendToBackground(MSG.TOOLSET_SAVE, snapshot)
      setToolSets(toolSets.map(toolSet => toolSet.id === snapshot.id ? snapshot : toolSet))
      setSaveState('saved')
    } catch (err) {
      console.error('保存轨迹失败:', err)
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaveState('error')
    }
  }

  const currentName = currentToolSet?.name || t('toolset.none')

  return (
    <div className="relative border-b border-gray-200 bg-white">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600 min-w-0"
        >
          <span>📦</span>
          <span className="font-medium truncate max-w-[110px]">{currentName}</span>
          <span className="text-[10px] flex-shrink-0">▼</span>
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          {!currentToolSetId && hasNodes && (
            <button
              onClick={handleRegisterCurrentTree}
              title={t('toolset.registerTitle')}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-green-700 rounded hover:bg-green-50 transition-colors"
            >
              <span>📋</span>
              <span>{t('toolset.register')}</span>
            </button>
          )}
          {currentToolSetId && (
            <button
              onClick={handleRename}
              title={t('toolset.renameTitle')}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-gray-500 rounded hover:bg-gray-100 transition-colors"
            >
              <span>✏️</span>
              <span>{t('toolset.rename')}</span>
            </button>
          )}

          {currentToolSet && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === 'saving'}
              title={t('toolset.saveTitle')}
              aria-describedby="toolset-save-status"
              className="flex min-h-8 items-center rounded px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-wait disabled:text-gray-400"
            >
              {saveState === 'saving' ? t('toolset.saving') : t('toolset.save')}
            </button>
          )}
        </div>
      </div>

      <div
        id="toolset-save-status"
        role="status"
        aria-live="polite"
        className={`min-h-4 px-3 text-xs ${saveState === 'error' ? 'text-red-600' : 'text-green-700'}`}
      >
        {saveState === 'saving'
          ? t('toolset.saving')
          : saveState === 'saved'
            ? t('toolset.saved')
            : saveState === 'error'
              ? t('toolset.saveError', { msg: saveError ?? '' })
              : ''}
      </div>

      {showMenu && (
        <div className="absolute top-full left-2 z-50 mt-1 w-48 bg-white border border-gray-200 rounded shadow-lg">
          {toolSets.map(ts => (
            <div
              key={ts.id}
              onClick={() => handleSwitch(ts.id)}
              className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50 ${
                ts.id === currentToolSetId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
              }`}
            >
              <span className="truncate">{ts.name}</span>
              <button
                onClick={(e) => handleDelete(ts.id, e)}
                className="text-gray-400 hover:text-red-500 ml-1 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div
            onClick={handleCreate}
            className="px-3 py-1.5 text-xs text-blue-600 cursor-pointer hover:bg-blue-50 border-t border-gray-100"
          >
            {t('toolset.newEmpty')}
          </div>
        </div>
      )}
    </div>
  )
}
