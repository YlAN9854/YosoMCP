import { useEffect, useState } from 'react'
import { useBranchStore } from '@/sidepanel/stores/branchStore'
import { useRecorderStore } from '@/sidepanel/stores/recorderStore'
import { useToolsetStore } from '@/sidepanel/stores/toolsetStore'
import { useSettingsStore } from '@/sidepanel/stores/settingsStore'
import type { Branch, BranchParam } from '@/types/branch'
import { copyToClipboard, downloadAsZip, downloadJson } from '@/sidepanel/utils/export'
import { useI18n } from '@/sidepanel/hooks/useI18n'
import TracePackageCard from './TracePackageCard'

function BranchSummaryLine({ branch }: { branch: Branch }) {
  const keyNodes = branch.path.filter(n =>
    !['wait_for_selector', 'wait_for_url', 'wait_for_timeout', 'wait_for_navigation'].includes(n.action.type)
  )
  const parts = keyNodes.slice(0, 5).map(n => {
    const role = n.metadata.nodeRole
    const text = n.action.innerText?.slice(0, 12) || n.action.value?.slice(0, 12) || ''
    if (role === 'enum_param') return `[enum]${text}`
    if (role === 'dynamic_param') return `[input]${text}`
    if (role === 'loop_target') return `[loop]`
    if (n.action.type === 'extract_selected_content') return `[extract]`
    if (n.action.type === 'navigate') return `nav`
    if (n.action.type === 'hover') return `hover`
    return text || n.action.type
  })
  const suffix = keyNodes.length > 5 ? '...' : ''
  return <span className="text-gray-500">{parts.join(' > ')}{suffix}</span>
}

function ReadinessBadge({ branch }: { branch: Branch }) {
  const { t } = useI18n()
  if (!branch.isReady) {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium shrink-0">
        {t('branch.pendingN', { n: branch.unconfirmedNodeIds.length })}
      </span>
    )
  }
  if (branch.replayStatus === 'code-ready') {
    return <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium shrink-0">code-ready</span>
  }
  return <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium shrink-0">text-only</span>
}

function isParamDefaultValid(param: BranchParam): boolean {
  if (param.type === 'number') {
    if (param.defaultValue === undefined || param.defaultValue === null) return false
    const num = typeof param.defaultValue === 'number' ? param.defaultValue : Number(param.defaultValue)
    return Number.isFinite(num) && num > 0
  }
  if (param.type === 'enum') {
    if (typeof param.defaultValue !== 'string' || !param.defaultValue.trim()) return false
    if (!param.enumOptions || param.enumOptions.length === 0) return false
    return param.enumOptions.includes(param.defaultValue)
  }
  return typeof param.defaultValue === 'string' && !!param.defaultValue.trim()
}

function BranchDetailView({ branch, isHistoricalToolSet }: { branch: Branch; isHistoricalToolSet: boolean }) {
  const { t } = useI18n()
  const meta = useBranchStore(s => s.branchMeta[branch.id])
  const registerTool = useBranchStore(s => s.registerTool)
  const generateBranchCode = useBranchStore(s => s.generateBranchCode)
  const updateBranchRegistration = useBranchStore(s => s.updateBranchRegistration)
  const updateBranchHint = useBranchStore(s => s.updateBranchHint)
  const updateBranchParamDefaultValue = useBranchStore(s => s.updateBranchParamDefaultValue)
  const confirmBranchParamDefaultValue = useBranchStore(s => s.confirmBranchParamDefaultValue)
  const confirmAllBranchParamDefaults = useBranchStore(s => s.confirmAllBranchParamDefaults)
  const downgradeBranchToTextOnly = useBranchStore(s => s.downgradeBranchToTextOnly)
  const settings = useSettingsStore(s => s.settings)
  const setSelectedNodeId = useToolsetStore(s => s.setSelectedNodeId)
  const [copied, setCopied] = useState(false)
  const isCodeReady = branch.replayStatus === 'code-ready'
  const branchDefaultsReady = branch.params.every(p => isParamDefaultValid(p) && !!p.defaultValueConfirmed)

  const handleRegister = () => registerTool(branch.id, settings.llm.apiKey ? settings.llm : undefined)
  const handleGenerate = () => generateBranchCode(branch.id)
  const handleDowngrade = () => downgradeBranchToTextOnly(branch.id)
  const handleCopy = async () => {
    if (branch.generatedCode) {
      await copyToClipboard(branch.generatedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      {/* Path overview */}
      <div className="bg-white rounded p-2 border border-gray-200">
        <div className="font-medium text-gray-700 mb-1">{t('branch.pathSteps', { n: branch.path.length })}</div>
        <div className="space-y-0.5">
          {branch.path.map(n => {
            const role = n.metadata.nodeRole
            const isUnconfirmed = branch.unconfirmedNodeIds.includes(n.id)
            return (
              <div
                key={n.id}
                className={`flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer hover:bg-gray-50 ${isUnconfirmed ? 'bg-amber-50' : ''}`}
                onClick={() => setSelectedNodeId(n.id)}
              >
                <span className="text-gray-400 w-14 shrink-0 truncate">{n.action.type}</span>
                <span className="truncate flex-1 text-gray-600">
                  {n.action.innerText?.slice(0, 25) || n.action.selector?.slice(0, 25) || n.action.url?.slice(0, 25) || ''}
                </span>
                {role && role !== 'normal' && (
                  <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${
                    role === 'enum_param' ? 'bg-green-100 text-green-600' :
                    role === 'dynamic_param' ? 'bg-blue-100 text-blue-600' :
                    role === 'loop_target' ? 'bg-purple-100 text-purple-600' :
                    role === 'branch_point' ? 'bg-orange-100 text-orange-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {role === 'enum_param' ? t('branch.roleEnum') : role === 'dynamic_param' ? t('branch.roleDynamic') : role === 'loop_target' ? t('branch.roleLoop') : role === 'branch_point' ? t('branch.roleBranch') : role}
                  </span>
                )}
                {n.action.type === 'extract_selected_content' && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-teal-100 text-teal-600 shrink-0">{t('branch.extract')}</span>
                )}
                {isUnconfirmed && (
                  <span className="text-[9px] text-amber-500 shrink-0">!</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className={`rounded p-2 border ${isCodeReady ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] font-medium ${isCodeReady ? 'text-green-700' : 'text-slate-700'}`}>
            {t('branch.exportStatus', { status: branch.replayStatus })}
          </span>
          {isCodeReady && (
            <button
              onClick={handleDowngrade}
              className="px-2 py-0.5 rounded text-[10px] bg-slate-600 text-white hover:bg-slate-700 transition-colors"
            >
              {t('branch.downgradeTextOnly')}
            </button>
          )}
        </div>
        {!isCodeReady && (
          <div className="text-[10px] text-slate-600 mt-1 break-words">{branch.failReason || t('branch.replayFailedDefault')}</div>
        )}
        {isHistoricalToolSet && (
          <div className="text-[10px] text-amber-600 mt-1">{t('branch.historicalHint')}</div>
        )}
      </div>

      {/* Parameters */}
      {branch.params.length > 0 && (
        <div className="bg-white rounded p-2 border border-blue-200">
          <div className="font-medium text-blue-700 mb-1">{t('branch.paramDefaults', { n: branch.params.length })}</div>
          <div className="space-y-2">
            {branch.params.map(p => {
              const valid = isParamDefaultValid(p)
              const confirmed = !!p.defaultValueConfirmed && valid
              const defaultText = p.defaultValue === undefined || p.defaultValue === null ? '' : String(p.defaultValue)
              return (
                <div key={p.nodeId} className="rounded border border-blue-100 p-2 bg-blue-50/30">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-gray-600">
                      <span className="font-mono text-blue-600">{p.name}</span>
                      <span className="text-gray-400 ml-1">({p.type})</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${confirmed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {confirmed ? t('tree.confirmed') : t('tree.rolePending')}
                    </span>
                  </div>
                  {p.type === 'enum' ? (
                    <select
                      value={defaultText}
                      onChange={e => updateBranchParamDefaultValue(branch.id, p.nodeId, e.target.value)}
                      className="w-full border border-blue-200 rounded px-1.5 py-1 text-xs bg-white"
                    >
                      <option value="">{t('branch.pickDefault')}</option>
                      {(p.enumOptions || []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={p.type === 'number' ? 'number' : 'text'}
                      value={defaultText}
                      onChange={e => updateBranchParamDefaultValue(branch.id, p.nodeId, e.target.value)}
                      className="w-full border border-blue-200 rounded px-1.5 py-1 text-xs"
                      placeholder={p.type === 'number' ? t('branch.placeholderLoopCount') : t('branch.placeholderDefault')}
                    />
                  )}
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className={`text-[10px] ${valid ? 'text-gray-500' : 'text-red-500'}`}>
                      {valid ? t('branch.defaultValid') : t('branch.defaultInvalid')}
                    </span>
                    <button
                      onClick={() => confirmBranchParamDefaultValue(branch.id, p.nodeId)}
                      disabled={!valid}
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        !valid ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {t('branch.confirmDefault')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className={`text-[10px] ${branchDefaultsReady ? 'text-green-600' : 'text-amber-600'}`}>
              {branchDefaultsReady ? t('branch.allDefaultsOk') : t('branch.completeDefaultsFirst')}
            </span>
            <button
              onClick={() => confirmAllBranchParamDefaults(branch.id)}
              className="px-2 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200"
            >
              {t('branch.confirmAllDefaults')}
            </button>
          </div>
        </div>
      )}

      {!branchDefaultsReady && branch.params.length > 0 && (
        <div className="rounded p-2 border border-amber-200 bg-amber-50 text-[10px] text-amber-700">
          {t('branch.needDefaultsBeforeLlm')}
        </div>
      )}

      {/* Returns */}
      {branch.returns.length > 0 && (
        <div className="bg-white rounded p-2 border border-teal-200">
          <div className="font-medium text-teal-700 mb-1">{t('branch.returns', { n: branch.returns.length })}</div>
          {branch.returns.map(r => (
            <div key={r.nodeId} className="ml-2 text-gray-600">
              <span className="text-teal-600">{r.extractMode}</span>
              <span className="text-gray-400 ml-1 truncate">{r.selector.slice(0, 40)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Registration */}
      <div className="bg-white rounded p-2 border border-gray-200">
        <div className="font-medium text-gray-700 mb-1.5">{t('branch.toolReg')}</div>
        <div className="mb-2">
          <input
            type="text"
            placeholder={t('branch.intentHint')}
            value={branch.hint || ''}
            onChange={e => updateBranchHint(branch.id, e.target.value)}
            className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-full placeholder:text-gray-300"
          />
        </div>
        {branch.registration ? (
          <div className="space-y-1">
            <div>
              <span className="text-gray-400">{t('branch.fnName')}</span>
              <input
                type="text"
                value={branch.registration.toolName}
                onChange={e => updateBranchRegistration(branch.id, { ...branch.registration!, toolName: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs font-mono w-full mt-0.5"
              />
            </div>
            <div>
              <span className="text-gray-400">{t('branch.desc')}</span>
              <input
                type="text"
                value={branch.registration.toolDescription}
                onChange={e => updateBranchRegistration(branch.id, { ...branch.registration!, toolDescription: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-full mt-0.5"
              />
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-[10px]">{t('branch.notRegistered')}</div>
        )}
        <button
          onClick={handleRegister}
          disabled={!branch.isReady || !isCodeReady || !branchDefaultsReady || meta?.registrationStatus === 'registering'}
          className={`mt-2 w-full py-1 px-2 rounded text-[10px] font-medium transition-colors ${
            !branch.isReady || !isCodeReady || !branchDefaultsReady
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : meta?.registrationStatus === 'registering'
              ? 'bg-blue-100 text-blue-500 cursor-wait'
              : 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer'
          }`}
        >
          {meta?.registrationStatus === 'registering' ? t('branch.registerAnalyzing') :
           branch.registration ? t('branch.reregisterLlm') : t('branch.registerLlm')}
        </button>
        {meta?.registrationStatus === 'error' && (
          <div className="text-red-500 text-[10px] mt-1">{meta.error}</div>
        )}
        {branch.registration?.fallbackReason && (
          <div className="text-amber-600 text-[10px] mt-1 break-words" title={branch.registration.fallbackReason}>
            {t('branch.defaultNaming', { reason: branch.registration.fallbackReason.length > 50
              ? `${branch.registration.fallbackReason.slice(0, 50)}…`
              : branch.registration.fallbackReason })}
          </div>
        )}
      </div>

      {/* Code Generation */}
      <div className="bg-white rounded p-2 border border-gray-200">
        <div className="font-medium text-gray-700 mb-1.5">{t('branch.codeGen')}</div>
        <button
          onClick={handleGenerate}
          disabled={!branch.isReady || !isCodeReady || !branchDefaultsReady || meta?.codeGenStatus === 'generating'}
          className={`w-full py-1 px-2 rounded text-[10px] font-medium transition-colors ${
            !branch.isReady || !isCodeReady || !branchDefaultsReady
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : meta?.codeGenStatus === 'generating'
              ? 'bg-green-100 text-green-500 cursor-wait'
              : 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
          }`}
        >
          {meta?.codeGenStatus === 'generating' ? t('branch.generating') :
           branch.generatedCode ? t('branch.regenCode') : t('branch.genCode')}
        </button>
        {meta?.codeGenStatus === 'error' && (
          <div className="text-red-500 text-[10px] mt-1">{meta.error}</div>
        )}
        {branch.generatedCode && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-[10px]">{t('branch.preview')}</span>
              <button
                onClick={handleCopy}
                className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
              >
                {copied ? t('branch.codeCopied') : t('branch.copyCode')}
              </button>
            </div>
            <pre className="bg-gray-50 rounded p-2 text-[10px] leading-relaxed font-mono text-gray-700 whitespace-pre-wrap break-all max-h-60 overflow-auto border border-gray-100">
              {branch.generatedCode}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default function BranchPanel() {
  const { t } = useI18n()
  const nodes = useRecorderStore(s => s.nodes)
  const branches = useBranchStore(s => s.branches)
  const currentBranchId = useBranchStore(s => s.currentBranchId)
  const isExtracting = useBranchStore(s => s.isExtracting)
  const isGeneratingSkill = useBranchStore(s => s.isGeneratingSkill)
  const isGeneratingMcp = useBranchStore(s => s.isGeneratingMcp)
  const isExportingSession = useBranchStore(s => s.isExportingSession)
  const skillContent = useBranchStore(s => s.skillContent)
  const mcpContent = useBranchStore(s => s.mcpContent)
  const extractBranches = useBranchStore(s => s.extractBranches)
  const generateSkill = useBranchStore(s => s.generateSkill)
  const generateMcpServer = useBranchStore(s => s.generateMcpServer)
  const exportSkillSession = useBranchStore(s => s.exportSkillSession)
  const setCurrentBranchId = useBranchStore(s => s.setCurrentBranchId)
  const currentToolSet = useToolsetStore(s => {
    const id = s.currentToolSetId
    return id ? s.toolSets.find(ts => ts.id === id) : null
  })
  const settings = useSettingsStore(s => s.settings)
  const isHistoricalToolSet = !!currentToolSet && (currentToolSet.metadata?.replayValidationVersion ?? 0) < 1
  const autoExtractKey = useBranchStore(s => s.autoExtractKey)
  const setAutoExtractKey = useBranchStore(s => s.setAutoExtractKey)
  const [skillHint, setSkillHint] = useState('')

  useEffect(() => {
    if (branches.length === 0 || nodes.length === 0 || isExtracting) return
    const key = `${isHistoricalToolSet}-${nodes.map(n => n.id).join(',')}`
    if (autoExtractKey === key) return
    setAutoExtractKey(key)
    extractBranches(nodes, { markAsHistoricalTextOnly: isHistoricalToolSet })
  }, [branches.length, extractBranches, isExtracting, isHistoricalToolSet, nodes, autoExtractKey, setAutoExtractKey])

  const handleExtract = () => {
    // 分支提取统一以当前操作树（recorderStore.nodes）为准，
    // 确保在录制界面对节点角色的修改能立即反映到分支视图中
    if (nodes.length > 0) {
      const key = `${isHistoricalToolSet}-${nodes.map(n => n.id).join(',')}`
      setAutoExtractKey(key)
      extractBranches(nodes, { markAsHistoricalTextOnly: isHistoricalToolSet })
    }
  }

  const handleGenerateSkill = async () => {
    const name = currentToolSet?.name || 'yoso-tools'
    await generateSkill(name, settings.llm.apiKey ? settings.llm : undefined, skillHint)
  }

  const handleDownloadSkillZip = () => {
    const name = currentToolSet?.name || 'yoso-skill'
    const files = skillContent?.exports?.map(file => ({
      filename: file.filename,
      content: file.content,
    })) ?? []
    if (files.length === 0) {
      const skillFileName = `${name}-skill.ts`
      if (skillContent?.doc) files.push({ filename: 'SKILL.md', content: skillContent.doc })
      if (skillContent?.script) files.push({ filename: skillFileName, content: skillContent.script })
    }
    if (files.length === 0) return
    downloadAsZip(files, `${name}-skill.zip`)
  }

  const handleGenerateMcpServer = async () => {
    const name = currentToolSet?.name || 'yoso-tools'
    await generateMcpServer(name, settings.llm.apiKey ? settings.llm : undefined)
  }

  const handleDownloadMcpZip = () => {
    const name = currentToolSet?.name || 'yoso-tools'
    const files = mcpContent?.exports?.map(file => ({
      filename: file.filename,
      content: file.content,
    })) ?? []
    if (files.length === 0) return
    downloadAsZip(files, `${name}-mcp-server.zip`)
  }
  const handleExportSession = async () => {
    if (!currentToolSet?.name) return
    const confirmed = window.confirm(t('branch.sessionConfirm'))
    if (!confirmed) return
    try {
      const exported = await exportSkillSession(currentToolSet.name, 'main-and-login-chain')
      downloadJson(exported.content, exported.filename)
      const domains = exported.summary.domains.map(d => `- ${d}`).join('\n')
      window.alert(t('branch.sessionExported', {
        filename: exported.filename,
        domains: String(exported.summary.domains.length),
        cookies: String(exported.summary.cookieCount),
        domainList: domains,
      }))
    } catch (error) {
      window.alert(t('branch.sessionExportFailed', { msg: (error as Error).message }))
    }
  }

  const selectedBranch = branches.find(b => b.id === currentBranchId)
  const sourceCount = nodes.length
  const readyCount = branches.filter(b => b.isReady).length
  const codeGenCount = branches.filter(b => !!b.generatedCode).length
  const codeReadyCount = branches.filter(b => b.replayStatus === 'code-ready').length
  const textOnlyCount = branches.filter(b => b.replayStatus === 'text-only').length
  const canExportSession = codeReadyCount > 0 && !!currentToolSet?.name
  const canDownloadSkill = skillContent?.mode === 'skill-ready' && (skillContent.exports?.length ?? 0) > 0
  const canDownloadMcp = mcpContent?.mode === 'mcp-ready' && (mcpContent.exports?.length ?? 0) > 0
  const skillBlockedReasons = skillContent?.mode === 'blocked' ? skillContent.validation.blockedReasons : []
  const mcpBlockedReasons = mcpContent?.mode === 'blocked' ? mcpContent.validation.blockedReasons : []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {sourceCount > 0 && (
        <div className="px-3 py-2 bg-white border-b border-gray-200 flex items-center justify-between shrink-0">
          <span className="text-xs font-medium text-gray-700">{t('branch.manage')}</span>
          <button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting}
            className="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {isExtracting ? t('branch.extracting') : branches.length > 0 ? t('branch.reextract') : t('branch.extractBranches')}
          </button>
        </div>
      )}

      <TracePackageCard />

      {sourceCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-400 text-sm gap-2 p-8">
          <span className="text-4xl">🔀</span>
          <span>{t('branch.noNodes')}</span>
          <span className="text-xs">{t('branch.loadOrRecord')}</span>
        </div>
      ) : branches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-xs p-8">
          <div className="text-center">
            <div className="text-3xl mb-2">🔀</div>
            <div>{t('branch.extractHint')}</div>
            <div className="text-[10px] mt-1 text-gray-300">{t('branch.eachIsTool')}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Branch stats */}
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-500 flex gap-3 shrink-0">
            <span>{t('branch.countBranches', { n: branches.length })}</span>
            <span>{t('branch.ready', { n: readyCount })}</span>
            <span>{t('branch.codeReadyCount', { n: codeReadyCount })}</span>
            <span>{t('branch.textOnlyCount', { n: textOnlyCount })}</span>
            <span>{t('branch.generatedCount', { n: codeGenCount })}</span>
          </div>
          {isHistoricalToolSet && (
            <div className="px-3 py-1.5 text-[10px] text-amber-700 bg-amber-50 border-b border-amber-200">
              {t('branch.historicalBanner')}
            </div>
          )}

          {/* Branch list + detail split */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Branch list */}
            <div className="shrink-0 max-h-40 overflow-y-auto border-b border-gray-200">
              {branches.map((branch, idx) => (
                <div
                  key={branch.id}
                  onClick={() => setCurrentBranchId(branch.id)}
                  className={`px-3 py-1.5 flex items-center gap-2 cursor-pointer text-xs border-b border-gray-100 last:border-b-0 transition-colors ${
                    currentBranchId === branch.id ? 'bg-blue-50 border-l-2 border-l-blue-400' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-gray-400 w-5 shrink-0 text-[10px]">#{idx + 1}</span>
                  <div className="flex-1 truncate">
                    {branch.registration?.toolName ? (
                      <span className="font-mono text-blue-600">{branch.registration.toolName}</span>
                    ) : (
                      <BranchSummaryLine branch={branch} />
                    )}
                  </div>
                  <ReadinessBadge branch={branch} />
                  {branch.generatedCode && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-600 shrink-0">code</span>
                  )}
                </div>
              ))}
            </div>

            {/* Detail panel */}
            <div className="flex-1 overflow-y-auto">
              {selectedBranch ? (
                <BranchDetailView branch={selectedBranch} isHistoricalToolSet={isHistoricalToolSet} />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 text-xs">
                  {t('branch.selectOne')}
                </div>
              )}
            </div>
          </div>

          {/* Skill export footer */}
          <div className="shrink-0 px-3 py-2 bg-white border-t border-gray-200 space-y-2">
            <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-amber-700">Agent Skill</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-500 font-medium">
                    SKILL.md + TS
                  </span>
                </div>
                {skillContent && !isGeneratingSkill && (
                  <button
                    onClick={handleGenerateSkill}
                    className="text-[9px] text-amber-400 hover:text-amber-600 transition-colors"
                  >
                    {t('branch.regenerate')}
                  </button>
                )}
              </div>
              <div className="mb-1">
                <input
                  type="text"
                  placeholder={t('branch.skillHintPh')}
                  value={skillHint}
                  onChange={e => setSkillHint(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 border border-amber-200 rounded bg-white/50 placeholder:text-amber-300 focus:outline-none focus:border-amber-400"
                />
              </div>
              {isGeneratingSkill ? (
                <div className="py-1 text-[10px] text-center text-amber-400 animate-pulse">
                  {t('branch.skillGenRunning')}
                </div>
              ) : canDownloadSkill ? (
                <button
                  onClick={handleDownloadSkillZip}
                  className="w-full py-1 text-[10px] font-medium bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                >
                  {t('branch.downloadSkill')}
                </button>
              ) : (
                <button
                  onClick={handleGenerateSkill}
                  className="w-full py-1 text-[10px] bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                >
                  {t('branch.generateSkill')}
                </button>
              )}
              {skillBlockedReasons.length > 0 && (
                <div className="text-[9px] text-amber-900 leading-relaxed bg-amber-100/70 border border-amber-200 rounded p-1.5">
                  <div className="font-medium mb-1">{t('branch.mcpBlocked')}</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {skillBlockedReasons.slice(0, 5).map((reason, idx) => (
                      <li key={`skill-${idx}-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-[9px] text-amber-700 leading-relaxed">
                {t('branch.mcpHint')}
              </div>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-sky-700">MCP Server</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-500 font-medium">
                    TS + README
                  </span>
                </div>
                {mcpContent && !isGeneratingMcp && (
                  <button
                    onClick={handleGenerateMcpServer}
                    className="text-[9px] text-sky-500 hover:text-sky-700 transition-colors"
                  >
                    {t('branch.regenerate')}
                  </button>
                )}
              </div>
              {isGeneratingMcp ? (
                <div className="py-1 text-[10px] text-center text-sky-500 animate-pulse">
                  {t('branch.mcpGenRunning')}
                </div>
              ) : canDownloadMcp ? (
                <button
                  onClick={handleDownloadMcpZip}
                  className="w-full py-1 text-[10px] font-medium bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
                >
                  {t('branch.downloadMcp')}
                </button>
              ) : (
                <button
                  onClick={handleGenerateMcpServer}
                  className="w-full py-1 text-[10px] bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
                >
                  {t('branch.generateMcp')}
                </button>
              )}
              {mcpBlockedReasons.length > 0 && (
                <div className="text-[9px] text-sky-800 leading-relaxed bg-sky-100/70 border border-sky-200 rounded p-1.5">
                  <div className="font-medium mb-1">{t('branch.mcpBlocked')}</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {mcpBlockedReasons.slice(0, 5).map((reason, idx) => (
                      <li key={`${idx}-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-[9px] text-sky-700 leading-relaxed">
                {t('branch.mcpHint')}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-700">{t('branch.exportSessionBlock')}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200/80 text-slate-600 font-medium">
                  {t('branch.exportSessionBadge')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleExportSession}
                disabled={!canExportSession || isExportingSession}
                className={`w-full py-1 text-[10px] rounded transition-colors ${
                  !canExportSession
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : isExportingSession
                      ? 'bg-slate-200 text-slate-500 cursor-wait'
                      : 'bg-slate-700 text-white hover:bg-slate-800'
                }`}
              >
                {isExportingSession ? t('branch.exportSessionRunning') : t('branch.exportSession')}
              </button>
              <div className="text-[9px] text-slate-600 leading-relaxed">{t('branch.sessionScopeHint')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
