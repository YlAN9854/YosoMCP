// LLM REST API 封装

import type { LLMSettings } from '@/types/message'

export async function callLLM(
  settings: LLMSettings,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const { provider, apiKey, model, baseURL } = settings

  if (!apiKey) throw new Error('API Key is not configured')

  let url: string
  let headers: Record<string, string>
  let body: object

  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    body = {
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }
  } else {
    // OpenAI / OpenAI-compatible
    // 若 baseURL 已以 /v1 结尾（如 https://api.siliconflow.cn/v1），只追加 /chat/completions，避免重复 /v1
    if (!baseURL) {
      url = 'https://api.openai.com/v1/chat/completions'
    } else {
      const normalized = baseURL.replace(/\/+$/, '')
      url = normalized.endsWith('/v1')
        ? `${normalized}/chat/completions`
        : `${normalized}/v1/chat/completions`
    }
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }
    body = {
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 秒超时

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if ((err as Error).name === 'AbortError') {
      throw new Error('请求超时（60 秒），请检查网络或 API 地址是否可访问')
    }
    throw err
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`LLM API error: ${response.status} ${response.statusText}${errText ? ` - ${errText.slice(0, 200)}` : ''}`)
  }

  const data = await response.json()

  if (provider === 'anthropic') {
    return data.content[0].text
  }

  const msg = data.choices?.[0]?.message
  if (!msg) throw new Error('LLM 返回格式异常：缺少 choices[0].message')

  const content = msg.content
  // OpenAI 格式为字符串；部分兼容 API（如硅基流动）可能返回 content 数组
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((c: { type?: string; text?: string }) => c.type === 'text' && c.text)
    if (textBlock?.text) return textBlock.text
    const first = content[0]
    if (first?.text) return first.text
    throw new Error('LLM 返回格式异常：content 数组无法解析为文本')
  }
  throw new Error('LLM 返回格式异常：content 既非字符串也非数组')
}
