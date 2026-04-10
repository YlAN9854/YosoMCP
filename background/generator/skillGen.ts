import type { Branch } from '@/types/branch'
import type { LLMSettings } from '@/types/message'
import { callLLM } from '../analyzer/semantic/llmClient'
import {
  branchesHaveWaitNodes,
  generateBrowserManagement,
  generateImports,
  resolveParamBusinessDescription,
  resolveRegisteredParamName,
} from './branchCodeGen'
import { buildValidationSummary, type McpValidationSummary } from './executableExportValidation'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SkillOutput {
  mode: 'skill-ready' | 'blocked'
  doc: string
  script: string
  exports: SkillExportFile[]
  runtimeMetadata: SkillRuntimeMetadata | null
  validation: McpValidationSummary
}

export interface SkillExportFile {
  filename: string
  content: string
  kind: 'document' | 'script' | 'entry' | 'metadata'
}

export interface SkillExportReference {
  id: string
  filename: string
  kind: SkillExportFile['kind']
  description: string
}

export interface SkillRuntimeMetadata {
  schemaVersion: number
  generatedAt: string
  toolSetName: string
  skillName: string
  entrypoint: string
  scriptFileName: string
  needsSession: boolean
  replaySummary: {
    branchCount: number
  }
  exports: SkillExportReference[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateSkill(
  branches: Branch[],
  toolSetName: string,
  llmSettings?: LLMSettings,
  hint?: string,
): Promise<SkillOutput> {
  const validation = buildValidationSummary(branches)
  if (validation.blockedReasons.length > 0) {
    return {
      mode: 'blocked',
      doc: '',
      script: '',
      exports: [],
      runtimeMetadata: null,
      validation,
    }
  }

  const skillName = toKebabCase(toolSetName)
  const scriptFileName = `${skillName}-skill.ts`
  const initFileName = 'init.ts'
  const runtimeMetadataFileName = 'skill.runtime.json'

  const toolListText = branches
    .map(b => `- ${b.registration!.toolName}: ${b.registration!.toolDescription}`)
    .join('\n')

  let content: { description: string; intro: string } | null = null
  if (llmSettings?.apiKey) {
    try {
      content = await generateLLMSkillContent(toolSetName, toolListText, branches, llmSettings, hint)
    } catch {
      // fallback below
    }
  }
  if (!content) {
    content = generateTemplateSkillContent(toolSetName, branches)
  }

  const script = generateSkillScript(branches, toolSetName)
  const runtimeMetadata = buildRuntimeMetadata(
    branches,
    toolSetName,
    skillName,
    scriptFileName,
    initFileName,
  )
  const doc = buildSkillDoc(
    branches,
    toolSetName,
    skillName,
    scriptFileName,
    initFileName,
    content,
  )
  const exports = buildSkillExports(
    doc,
    script,
    scriptFileName,
    initFileName,
    runtimeMetadataFileName,
    runtimeMetadata,
  )

  return {
    mode: 'skill-ready',
    doc,
    script,
    exports,
    runtimeMetadata,
    validation,
  }
}

function buildSkillExports(
  doc: string,
  script: string,
  scriptFileName: string,
  initFileName: string,
  runtimeMetadataFileName: string,
  runtimeMetadata: SkillRuntimeMetadata,
): SkillExportFile[] {
  return [
    { filename: 'SKILL.md', content: doc, kind: 'document' },
    {
      filename: runtimeMetadataFileName,
      content: JSON.stringify(runtimeMetadata, null, 2),
      kind: 'metadata',
    },
    { filename: scriptFileName, content: script, kind: 'script' },
    { filename: initFileName, content: buildInitEntry(scriptFileName), kind: 'entry' },
  ]
}

function buildRuntimeMetadata(
  branches: Branch[],
  toolSetName: string,
  skillName: string,
  scriptFileName: string,
  initFileName: string,
): SkillRuntimeMetadata {
  const needsSession = branchesHaveWaitNodes(branches)
  const exports: SkillExportReference[] = [
    {
      id: 'doc',
      filename: 'SKILL.md',
      kind: 'document',
      description: 'Skill documentation and usage guide',
    },
    {
      id: 'runtime-metadata',
      filename: 'skill.runtime.json',
      kind: 'metadata',
      description: 'Shared runtime metadata for package consumers',
    },
    {
      id: 'script',
      filename: scriptFileName,
      kind: 'script',
      description: 'Executable skill implementation and tool handlers',
    },
    {
      id: 'entry',
      filename: initFileName,
      kind: 'entry',
      description: 'Initialization entrypoint for CLI invocation',
    },
  ]
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    toolSetName,
    skillName,
    entrypoint: initFileName,
    scriptFileName,
    needsSession,
    replaySummary: { branchCount: branches.length },
    exports,
  }
}

function buildInitEntry(scriptFileName: string): string {
  return `import './${scriptFileName}'`
}

// ---------------------------------------------------------------------------
// CLI Runner script generation
// ---------------------------------------------------------------------------

export function generateSkillScript(branches: Branch[], toolSetName: string): string {
  const parts: string[] = []
  const safeName = toolSetName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso-skill'
  const needsSession = branchesHaveWaitNodes(branches)

  parts.push(generateImports(needsSession, false))
  parts.push(generateBrowserManagement(needsSession, safeName))

  for (const branch of branches) {
    if (branch.generatedCode) {
      parts.push(branch.generatedCode)
    }
  }

  parts.push(generateCLIRunner(branches, toolSetName))

  return parts.join('\n\n')
}

function generateCLIRunner(branches: Branch[], toolSetName: string): string {
  const toolDefs = branches
    .filter(b => b.generatedCode && b.registration)
    .map(b => {
      const reg = b.registration!
      const fnName = reg.toolName
      const argsTypeName = toPascalCase(fnName) + 'Args'
      const hasArgs = b.params.length > 0
      const numberParamNames = b.params
        .filter(p => p.type === 'number')
        .map(p => resolveRegisteredParamName(p, reg))
      return { fnName, argsTypeName, hasArgs, numberParamNames }
    })

  const availableTools = toolDefs.map(t => t.fnName).join(', ')

  const cases = toolDefs.map(t =>
    `    case '${t.fnName}':\n      result = await ${t.fnName}(${t.hasArgs ? `normalizeParams(params, ${JSON.stringify(t.numberParamNames)}) as ${t.argsTypeName}` : ''});\n      break;`
  ).join('\n')

  const safeName = toolSetName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'yoso-skill'

  return `// ---------------------------------------------------------------------------
// CLI Runner — ${safeName}
// Usage: npx tsx <thisfile> <toolName> [--param1 value1 --param2 value2]
// ---------------------------------------------------------------------------

function parseArgs(): { tool: string; params: Record<string, string> } {
  const [,, tool, ...rest] = process.argv;
  const params: Record<string, string> = {};
  for (let i = 0; i < rest.length - 1; i++) {
    if (rest[i].startsWith('--')) {
      params[rest[i].slice(2)] = rest[i + 1];
      i++;
    }
  }
  return { tool: tool || '', params };
}

function normalizeParams(
  params: Record<string, string>,
  numberParamNames: string[],
): Record<string, string | number> {
  if (numberParamNames.length === 0) return params;
  const normalized: Record<string, string | number> = { ...params };
  for (const key of numberParamNames) {
    if (!(key in normalized)) continue;
    const raw = normalized[key];
    if (typeof raw !== 'string') continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      delete normalized[key];
      continue;
    }
    normalized[key] = num;
  }
  return normalized;
}

async function main() {
  const { tool, params } = parseArgs();
  if (!tool) {
    console.error('Usage: npx tsx <thisfile> <toolName> [--param1 value1 ...]');
    console.error('Available tools: ${availableTools}');
    process.exit(1);
  }

  try {
    let result: unknown;
    switch (tool) {
${cases}
      default:
        console.error(\`Unknown tool: "\${tool}". Available: ${availableTools}\`);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeBrowser();
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

main().catch(err => {
  console.error(String(err));
  process.exit(1);
});`
}

// ---------------------------------------------------------------------------
// LLM content generation
// ---------------------------------------------------------------------------

interface SkillContent {
  description: string  // for YAML frontmatter — trigger-focused, agent activation hint
  intro: string        // for document body — explanatory paragraph
}

async function generateLLMSkillContent(
  toolSetName: string,
  toolListText: string,
  branches: Branch[],
  settings: LLMSettings,
  hint?: string,
): Promise<SkillContent> {
  const systemPrompt = `You are a technical documentation writer specializing in AI Agent Skills.

Your task is to write two pieces of text for a SKILL.md file:
1. "description": a single sentence for the YAML frontmatter. This is what the AI agent reads to decide whether to activate the skill. It must include: what platform/website is automated, key capabilities, and clear activation boundaries. Avoid broad catch-all trigger wording.
2. "intro": 2-3 sentences for the document body. Explain what the toolset automates, on which website/platform, and the main capabilities. This is for human readers and the agent's deeper context.

Return ONLY valid JSON with exactly these two keys: { "description": "...", "intro": "..." }
Do NOT wrap in markdown code fences. Do NOT add any other keys or text.`

  const paramSummary = branches
    .filter(b => b.params.length > 0)
    .map(b => `  ${b.registration?.toolName}: ${b.params.map(p => p.name).join(', ')}`)
    .join('\n')

  let userPrompt = `Generate skill content for a browser automation toolset named "${toolSetName}".

Available tools:
${toolListText}
${paramSummary ? `\nTool parameters:\n${paramSummary}` : ''}`

  if (hint) {
    userPrompt += `\n\nUser Hint: ${hint}\n(Use this hint to better understand the overall intent of the skill set)`
  }

  userPrompt += `\n\nReturn JSON with:
- "description": frontmatter field. One sentence. Must name the platform and list key capabilities with clear activation boundaries, while avoiding broad "use whenever" statements.
- "intro": body paragraph. 2-3 sentences explaining what the toolset automates and its main capabilities.`

  const raw = await callLLM(settings, systemPrompt, userPrompt)

  // Extract JSON — handle accidental markdown fences
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(jsonText) as { description?: string; intro?: string }

  const description = (parsed.description ?? '').trim()
  const intro = (parsed.intro ?? '').trim()

  if (!description || !intro) throw new Error('LLM returned incomplete skill content')
  return { description, intro }
}

function generateTemplateSkillContent(toolSetName: string, branches: Branch[]): SkillContent {
  const toolNames = branches
    .filter(b => b.registration)
    .map(b => b.registration!.toolName)
    .slice(0, 4)
    .join(', ')
  const more = branches.length > 4 ? ` and ${branches.length - 4} more` : ''

  const capabilityList = branches
    .filter(b => b.registration)
    .slice(0, 3)
    .map(b => b.registration!.toolDescription.toLowerCase())
    .join('; ')

  return {
    description: `Browser automation skill for ${toolSetName}, supporting: ${capabilityList}. Use it for these recorded workflow capabilities on ${toolSetName}.`,
    intro: `This skill provides browser automation for **${toolSetName}**, generated by [YOSO](https://github.com/YosoMCP/yoso-extension). It exposes ${branches.length} tool${branches.length !== 1 ? 's' : ''} — ${toolNames}${more} — as a lightweight CLI script powered by Playwright. Invoke it directly from a shell command to automate browser workflows without any protocol setup.`,
  }
}

// ---------------------------------------------------------------------------
// SKILL.md document assembly
// ---------------------------------------------------------------------------

function buildSkillDoc(
  branches: Branch[],
  toolSetName: string,
  skillName: string,
  scriptFileName: string,
  initFileName: string,
  content: SkillContent,
): string {
  const sections: string[] = []

  const frontmatter = buildFrontmatter(skillName, content.description)
  const header = buildSkillHeader(toolSetName, content.intro)
  sections.push(buildToolReference(branches))
  sections.push(buildEnvironmentSetup(scriptFileName, initFileName))
  sections.push(buildInvocationGuide(branches, initFileName))
  sections.push(buildUsageGuidelines(branches))

  return frontmatter + '\n\n' + header + '\n\n---\n\n' + sections.join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Document section builders
// ---------------------------------------------------------------------------

function buildFrontmatter(skillName: string, description: string): string {
  const safeDesc = description.replace(/"/g, "'").replace(/\n/g, ' ')
  return `---\nname: ${skillName}\ndescription: "${safeDesc}"\n---`
}

function buildSkillHeader(toolSetName: string, intro: string): string {
  return `# ${toolSetName}

> Agent Skill — Generated by [YOSO](https://github.com/YosoMCP/yoso-extension) (You Only Show Once)

${intro}`
}

function buildToolReference(branches: Branch[]): string {
  const registered = branches.filter(b => b.registration)
  if (registered.length === 0) return `## Tool Reference\n\n_No tools registered._`

  const toolDocs = registered.map(b => buildToolDoc(b)).join('\n\n')
  return `## Tool Reference

${toolDocs}`
}

function buildToolDoc(branch: Branch): string {
  const reg = branch.registration!
  const lines: string[] = []

  lines.push(`### \`${reg.toolName}\``)
  lines.push('')
  lines.push(reg.toolDescription)
  lines.push('')

  if (branch.params.length > 0) {
    lines.push('')
    lines.push('**Parameters:**')
    lines.push('')
    lines.push('| Name | Type | Required | Description | Options |')
    lines.push('|------|------|----------|-------------|---------|')
    for (const p of branch.params) {
      const name = resolveRegisteredParamName(p, reg)
      const desc = resolveParamBusinessDescription(p)
      const opts = p.enumOptions ? p.enumOptions.map(o => `\`${o}\``).join(', ') : '—'
      const required = p.required ? 'Yes' : 'No'
      lines.push(`| \`${name}\` | \`${p.type}\` | ${required} | ${desc} | ${opts} |`)
    }
  }

  if (branch.returns.length > 0) {
    lines.push('')
    lines.push('**Returns:**')
    lines.push('')
    const hasScreenshotReturn = branch.returns.some(r => r.extractMode === 'screenshot')
    const hasTextReturn = branch.returns.some(r => r.extractMode !== 'screenshot')
    if (hasScreenshotReturn) lines.push(`- Screenshot (saved to \`extract-{timestamp}.png\`)`)
    if (hasTextReturn) lines.push(`- Extracted text content from the target element`)
  }

  return lines.join('\n')
}

function buildEnvironmentSetup(
  scriptFileName: string,
  initFileName: string,
): string {
  return `## Environment Setup

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| [Node.js](https://nodejs.org/) | >= 18.0.0 | Runtime for the CLI script |
| npm | >= 9.0.0 | Package manager (bundled with Node.js) |
| Chromium | latest | Browser engine (auto-installed by Playwright) |

### Workspace Runtime (install once)

Use this skill folder as an isolated runtime. Run the following commands inside the same folder as \`${initFileName}\`:

\`\`\`bash
npm init -y
npm install playwright
npm install -D tsx
npx playwright install chromium
\`\`\`

### Reuse for every export

For each newly exported skill, create or open that skill's own folder and keep files together:

- \`./${initFileName}\`
- \`./${scriptFileName}\`
- \`./skill.runtime.json\`

Then run tools in that same skill folder:

\`\`\`bash
npx tsx ${initFileName} <toolName> [--param value]
\`\`\``
}

function buildInvocationGuide(branches: Branch[], initFileName: string): string {
  const registered = branches.filter(b => b.registration)
  const examples = registered.map(b => {
    const reg = b.registration!
    const flagArgs = b.params
      .slice(0, 2)
      .map(p => {
        const resolvedName = resolveRegisteredParamName(p, reg)
        const sample = p.enumOptions?.[0] ?? (p.type === 'number' ? '5' : 'value')
        const formattedSample = p.type === 'enum'
          ? `"${escapeExampleArg(String(sample))}"`
          : sample
        return `--${resolvedName} ${formattedSample}`
      })
      .join(' ')
    return `# ${reg.toolDescription}\nnpx tsx ${initFileName} ${reg.toolName}${flagArgs ? ' ' + flagArgs : ''}`
  })

  const toolList = registered.map(b => b.registration!.toolName).join(', ')

  return `## Invocation

This skill runs as a **standalone CLI script**. Run commands from this skill directory.

### Syntax

\`\`\`bash
npx tsx ${initFileName} <toolName> [--param1 value1 --param2 value2 ...]
\`\`\`

Square brackets indicate optional arguments in documentation syntax. Do not type \`[\` or \`]\` in actual commands.

### Examples

\`\`\`bash
${examples.join('\n\n')}
\`\`\`

### Output

Results are printed as **JSON** to stdout. Errors go to stderr with a non-zero exit code.

### Available tools

\`${toolList}\``
}

function buildUsageGuidelines(branches: Branch[]): string {
  const registered = branches.filter(b => b.registration)
  const needsSession = branchesHaveWaitNodes(branches)
  const lines: string[] = []
  let n = 1

  lines.push(`## Usage Guidelines`)
  lines.push('')
  lines.push(`${n++}. **One invocation at a time** — each call launches a browser session; avoid concurrent calls.`)
  lines.push(`${n++}. **Handle errors gracefully** — if a tool fails, the target website may have changed its layout. Suggest the user re-record the workflow in YOSO.`)

  if (needsSession) {
    lines.push(`${n++}. **Session Broker** — login state is persisted as \`<skillId>-session.json\` under the broker directory in user home, not in the skill folder. Only \`http/https\` origins can be restored.`)
  }

  if (registered.some(b => b.params.some(p => p.source === 'enum_param'))) {
    lines.push(`${n++}. **Enum parameters** — only pass values from the documented options list. Other values will cause failures.`)
  }

  if (registered.some(b => b.returns.length > 0)) {
    lines.push(`${n++}. **Extracted data** — parse the JSON output and present the relevant fields to the user.`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]+/g, s => s)
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'skill'
}

function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function escapeExampleArg(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
