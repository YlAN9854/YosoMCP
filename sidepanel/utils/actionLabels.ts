import type { OperationNode } from '@/types/operationTree'
import type { NodeRole } from '@/types/operationTree'
import type { MessageKey } from '@/sidepanel/locales/translate'

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string

export const ROLE_STYLES: Record<
  NodeRole,
  { color: string; bg: string }
> = {
  normal: { color: 'text-gray-500', bg: 'bg-gray-100' },
  branch_point: { color: 'text-orange-600', bg: 'bg-orange-100' },
  enum_param: { color: 'text-green-600', bg: 'bg-green-100' },
  dynamic_param: { color: 'text-blue-600', bg: 'bg-blue-100' },
  loop_target: { color: 'text-purple-600', bg: 'bg-purple-100' },
}

export function getRoleLabel(role: NodeRole, t: TFunction): string {
  return t(`tree.role.${role}` as MessageKey)
}

export function getActionLabel(node: OperationNode, t: TFunction): string {
  const action = node.action
  switch (action.type) {
    case 'navigate':
      try {
        const host = action.url ? new URL(action.url).hostname : t('tree.page')
        return t('tree.openPage', { host })
      } catch {
        return t('tree.openPage', {
          host: action.url?.slice(0, 20) || t('tree.page'),
        })
      }
    case 'click':
      return t('tree.click', {
        text: action.innerText?.slice(0, 15) || action.selector.slice(0, 20),
      })
    case 'dblclick':
      return t('tree.dblclick', {
        text: action.innerText?.slice(0, 15) || action.selector.slice(0, 20),
      })
    case 'fill':
      return t('tree.fill', { text: action.value?.slice(0, 15) || '' })
    case 'select':
      return t('tree.select', { text: action.value?.slice(0, 15) || '' })
    case 'check':
      return action.checked
        ? t('tree.checkOn', { sel: action.selector.slice(0, 20) })
        : t('tree.checkOff', { sel: action.selector.slice(0, 20) })
    case 'upload':
      return t('tree.upload', { sel: action.selector.slice(0, 18) })
    case 'keydown':
      return t('tree.key', { key: action.key ?? '' })
    case 'scroll':
      return t('tree.scroll')
    case 'hover':
      return t('tree.hover', {
        text: action.innerText?.slice(0, 15) || action.selector.slice(0, 20),
      })
    case 'wait_for_url':
      return (
        action.comment ||
        t('tree.waitUrl', {
          url: (action.url || action.waitPattern || '').slice(0, 24),
        })
      )
    case 'wait_for_selector':
      return action.comment || t('tree.waitSel', { sel: (action.selector || '').slice(0, 22) })
    case 'wait_for_timeout':
    case 'wait_for_navigation':
      return action.comment || t('tree.waitGeneric')
    case 'extract_selected_content':
      return action.extractMode === 'screenshot'
        ? t('tree.extractShot', { sel: action.selector.slice(0, 18) })
        : t('tree.extractText', { sel: action.selector.slice(0, 18) })
    default:
      return `${action.type} ${(action.selector || '').slice(0, 20)}`
  }
}
