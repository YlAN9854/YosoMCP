import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useReplayStore } from '@/sidepanel/stores/replayStore'
import type { OperationNode } from '@/types/operationTree'
import { useI18n } from '@/sidepanel/hooks/useI18n'

interface NodeContextMenuProps {
  node: OperationNode
  position: { x: number; y: number }
  onClose: () => void
  onNodeUpdate?: () => void
}

export default function NodeContextMenu({
  node,
  position,
  onClose,
  onNodeUpdate,
}: NodeContextMenuProps) {
  const { t } = useI18n()
  const nodes = useRecorderStore(s => s.nodes)
  const childCount = nodes.filter(n => n.parentId === node.id).length
  const canDeleteSingle = childCount <= 1

  const handleDeleteSingle = () => {
    if (!canDeleteSingle) return
    useRecorderStore.getState().deleteNode(node.id)
    onNodeUpdate?.()
    onClose()
  }

  const handleDeleteWithDescendants = () => {
    useRecorderStore.getState().deleteNodeAndDescendants(node.id)
    onNodeUpdate?.()
    onClose()
  }

  const handleReplayPath = async () => {
    const allNodes = useRecorderStore.getState().nodes
    await useReplayStore.getState().startReplay(node.id, allNodes)
    onClose()
  }

  const items = [
    {
      label: t('nodeMenu.replayPath'),
      icon: '▶️',
      action: handleReplayPath,
    },
    { divider: true as const },
    {
      label: t('nodeMenu.deleteNode'),
      icon: '🗑️',
      action: handleDeleteSingle,
      danger: true,
      disabled: !canDeleteSingle,
    },
    {
      label: t('nodeMenu.deleteSubtree'),
      icon: '🗑️',
      action: handleDeleteWithDescendants,
      danger: true,
    },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[160px]"
        style={{ left: position.x, top: position.y }}
      >
        {items.map((item, i) =>
          'divider' in item ? (
            <div key={i} className="border-t border-gray-100 my-1" />
          ) : (
            <button
              key={i}
              onClick={item.disabled ? undefined : item.action}
              disabled={item.disabled}
              title={item.disabled ? t('nodeMenu.deleteSingleDisabled') : undefined}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                item.disabled
                  ? 'text-gray-400 cursor-not-allowed'
                  : item.danger
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        )}
      </div>
    </>
  )
}
