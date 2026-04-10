import type { Branch } from '@/types/branch'

export interface McpValidationSummary {
  total: number
  codeReady: number
  missingRegistration: number
  missingCode: number
  blockedReasons: string[]
}

export function buildValidationSummary(branches: Branch[]): McpValidationSummary {
  const blockedReasons: string[] = []
  let codeReady = 0
  let missingRegistration = 0
  let missingCode = 0

  for (const branch of branches) {
    const name = branch.registration?.toolName || branch.id
    if (branch.replayStatus !== 'code-ready') {
      blockedReasons.push(`${name}: 分支不是 code-ready（${branch.failReason || '未提供原因'}）`)
      continue
    }
    codeReady += 1
    if (!branch.registration) {
      missingRegistration += 1
      blockedReasons.push(`${name}: 缺少工具注册信息，请先执行注册`)
    }
    if (!branch.generatedCode) {
      missingCode += 1
      blockedReasons.push(`${name}: 缺少生成代码，请先生成分支代码`)
    }
  }

  if (branches.length === 0) {
    blockedReasons.push('当前没有可导出的分支')
  }

  return {
    total: branches.length,
    codeReady,
    missingRegistration,
    missingCode,
    blockedReasons,
  }
}
