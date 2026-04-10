import type { Branch } from '@/types/branch'
import type { LLMSettings } from '@/types/message'
import { assembleServer } from './branchCodeGen'
import { buildValidationSummary, type McpValidationSummary } from './executableExportValidation'
import { generateReadme } from './readmeGen'

export type { McpValidationSummary }

export interface McpExportFile {
  filename: string
  content: string
  kind: 'server' | 'document'
}

export interface McpOutput {
  mode: 'mcp-ready' | 'blocked'
  serverCode: string
  readme: string
  exports: McpExportFile[]
  validation: McpValidationSummary
}

export async function generateMcpServer(
  branches: Branch[],
  toolSetName: string,
  llmSettings?: LLMSettings,
): Promise<McpOutput> {
  const validation = buildValidationSummary(branches)
  const hasBlockers = validation.blockedReasons.length > 0
  if (hasBlockers) {
    return {
      mode: 'blocked',
      serverCode: '',
      readme: '',
      exports: [],
      validation,
    }
  }

  const serverCode = assembleServer(branches, toolSetName)
  const readme = await generateReadme(branches, toolSetName, 'mcp-server.ts', llmSettings)
  const exports: McpExportFile[] = [
    { filename: 'mcp-server.ts', content: serverCode, kind: 'server' },
    { filename: 'README.md', content: readme, kind: 'document' },
  ]

  return {
    mode: 'mcp-ready',
    serverCode,
    readme,
    exports,
    validation,
  }
}
