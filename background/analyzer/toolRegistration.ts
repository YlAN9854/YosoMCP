import type { LLMSettings } from '@/types/message'
import type { Branch, ToolRegistration } from '@/types/branch'
import { callLLM } from './semantic/llmClient'
import { getBranchSummary } from './branchExtractor'

const REGISTRATION_SYSTEM_PROMPT = `You are an API tool naming expert.
Given a browser automation branch (a sequence of actions that forms one tool),
generate a concise function name, description, and parameter names.

Requirements:
1. Function name: snake_case, descriptive, English
2. Parameter names: camelCase, English
3. Description: one concise English sentence
4. Reply MUST be valid JSON only, no extra text.`

function buildRegistrationPrompt(branch: Branch, hint?: string): string {
  const summary = getBranchSummary(branch)

  const steps = branch.path.map(n => {
    const role = n.metadata.nodeRole
    const type = n.action.type
    const text = n.action.innerText?.slice(0, 30) || ''
    const sel = n.action.selector?.slice(0, 60) || ''
    const val = n.action.value?.slice(0, 30) || ''
    return `  - ${type}${role && role !== 'normal' ? ` [${role}]` : ''}: selector="${sel}"${text ? ` text="${text}"` : ''}${val ? ` value="${val}"` : ''}`
  }).join('\n')

  const params = branch.params.map(p => {
    const info = [`source=${p.source}`, `type=${p.type}`]
    if (p.enumOptions) info.push(`options=[${p.enumOptions.join(', ')}]`)
    if (p.defaultValue !== undefined) info.push(`default=${p.defaultValue}`)
    return `  - nodeId=${p.nodeId}: ${info.join(', ')}`
  }).join('\n')

  const returns = branch.returns.map(r =>
    `  - nodeId=${r.nodeId}: mode=${r.extractMode}, selector="${r.selector.slice(0, 60)}"`
  ).join('\n')

  let prompt = `Analyze this browser automation branch and generate naming:

Summary: ${summary}

Steps (${branch.path.length} total):
${steps}

${params ? `Parameters:\n${params}` : 'No parameters.'}

${returns ? `Returns:\n${returns}` : 'No return values.'}`

  if (hint) {
    prompt += `\n\nUser Hint: ${hint}\n(Use this hint to better understand the intent of the tool)`
  }

  prompt += `\n\nReply as JSON:
{
  "toolName": "snake_case_function_name",
  "toolDescription": "One sentence description",
  "paramDescriptions": {
    "<nodeId>": "camelCaseParamName"
  }
}`
  return prompt
}

/** 从 LLM 原始响应中提取 JSON 对象，支持 markdown 代码块 */
function extractJsonFromResponse(raw: string): string | null {
  const trimmed = raw.trim()
  // 1. 优先匹配 ```json ... ``` 或 ``` ... ```
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    const inner = codeBlock[1].trim()
    const objMatch = inner.match(/\{[\s\S]*\}/)
    if (objMatch) return objMatch[0]
  }
  // 2. 直接匹配 {...}
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  return objMatch ? objMatch[0] : null
}

export async function registerTool(
  branch: Branch,
  llmSettings?: LLMSettings,
  hint?: string
): Promise<ToolRegistration> {
  const fallback = (reason: string): ToolRegistration => ({
    toolName: generateFallbackName(branch),
    toolDescription: generateFallbackDescription(branch),
    paramDescriptions: {},
    fallbackReason: reason,
  })

  if (!llmSettings?.apiKey) {
    return fallback('未配置 LLM API Key')
  }

  try {
    const prompt = buildRegistrationPrompt(branch, hint)
    const raw = await callLLM(llmSettings, REGISTRATION_SYSTEM_PROMPT, prompt)
    const jsonStr = extractJsonFromResponse(raw)
    if (!jsonStr) {
      return fallback(`LLM 返回格式无法解析（未找到 JSON）`)
    }
    const parsed = JSON.parse(jsonStr) as { toolName?: string; toolDescription?: string; paramDescriptions?: Record<string, string> }
    return {
      toolName: parsed.toolName || generateFallbackName(branch),
      toolDescription: parsed.toolDescription || generateFallbackDescription(branch),
      paramDescriptions: parsed.paramDescriptions || {},
    }
  } catch (err) {
    const msg = (err as Error).message
    console.warn('LLM registration failed, using fallback:', msg)
    return fallback(msg)
  }
}

function generateFallbackName(branch: Branch): string {
  const keyNode = branch.path.find(n =>
    n.action.type === 'click' || n.action.type === 'fill' || n.action.type === 'navigate'
  )
  if (!keyNode) return `tool_${branch.id.slice(0, 8)}`

  const target = (keyNode.action.innerText || keyNode.action.selector || '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20)
    .toLowerCase()

  return `${keyNode.action.type}_${target || branch.id.slice(0, 8)}`
}

function generateFallbackDescription(branch: Branch): string {
  const types = [...new Set(branch.path.map(n => n.action.type))]
  const paramCount = branch.params.length
  const returnCount = branch.returns.length
  const parts = [`Automated: ${types.join(', ')} (${branch.path.length} steps)`]
  if (paramCount > 0) parts.push(`${paramCount} param(s)`)
  if (returnCount > 0) parts.push(`extracts ${returnCount} result(s)`)
  return parts.join(', ')
}
