import type { Response } from '@/types/message'

// Side Panel 调用 Background 的封装
export async function sendToBackground<T>(type: string, data?: unknown): Promise<T> {
  const response: Response<T> = await chrome.runtime.sendMessage({ type, data })
  if (!response.success) {
    throw new Error(response.error || 'Unknown error')
  }
  return response.data as T
}

// Background 向 Content Script 发送消息（可选指定 frameId，默认主框架 0）
export async function sendToContentScript<T>(
  tabId: number,
  type: string,
  data?: unknown,
  options?: { frameId?: number }
): Promise<T> {
  const response = await chrome.tabs.sendMessage(tabId, { type, data }, {
    frameId: options?.frameId ?? 0,
  })
  return response as T
}

// Background 向 Side Panel 广播事件
export function broadcastToSidePanel(type: string, data?: unknown) {
  chrome.runtime.sendMessage({ type, data }).catch(() => {
    // Side Panel 可能未打开，忽略错误
  })
}
