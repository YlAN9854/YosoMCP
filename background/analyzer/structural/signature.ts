// 操作签名生成

import type { OperationNode } from '@/types/operationTree'
import type { OperationSignature } from '@/types/analysis'

export function generateSignature(node: OperationNode): OperationSignature {
  const action = node.action
  const actionType = action.type.toUpperCase()

  if (action.type === 'navigate') {
    return {
      nodeId: node.id,
      signature: `GOTO:${action.url || ''}`,
      normalizedSelector: action.url || '',
      actionType: 'GOTO',
      value: action.url,
    }
  }

  const normalized = normalizeSelector(action.selector)
  return {
    nodeId: node.id,
    signature: `${actionType}:${normalized}`,
    normalizedSelector: normalized,
    actionType,
    value: extractValue(action),
  }
}

export function generateSignatures(nodes: OperationNode[]): OperationSignature[] {
  return nodes.map(generateSignature)
}

// 选择器归一化
export function normalizeSelector(selector: string): string {
  let s = selector

  // 1. 移除动态 ID: #el-id-123 → #dynamic-id
  s = s.replace(/#([a-zA-Z]*[-_]?\d{4,})/g, '#dynamic-id')
  s = s.replace(/#[a-f0-9]{8,}/gi, '#dynamic-id')

  // 2. 移除 nth-child 数字: :nth-child(3) → :nth-child(N)
  s = s.replace(/:nth-child\(\d+\)/g, ':nth-child(N)')

  // 3. 移除 data 属性值: [data-id="abc123"] → [data-id="*"]
  s = s.replace(/\[data-[a-z-]+="[^"]*"\]/g, (match) => {
    const attrName = match.match(/\[(data-[a-z-]+)=/)?.[1]
    return attrName ? `[${attrName}="*"]` : match
  })

  // 4. 简化过长选择器（保留最后 3 层）
  const parts = s.split(/\s*>\s*|\s+/)
  if (parts.length > 3) {
    return parts.slice(-3).join(' > ')
  }

  return s
}

function extractValue(action: OperationNode['action']): string | undefined {
  if (action.value) return action.value
  if (action.key) return action.key
  if (action.url) return action.url
  return undefined
}
