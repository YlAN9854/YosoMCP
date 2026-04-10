// 节点角色分析器 — 分析单条操作序列中每个节点的角色

import type { OperationNode } from '@/types/operationTree'
import type { NodeRole, NodeRoleRecommendation, NodeRoleCandidate } from '@/types/operationTree'

// 导航/等待类 action 类型
const NAVIGATION_TYPES = new Set(['navigate', 'scroll'])
const WAIT_TYPES = new Set([
  'wait_for_url',
  'wait_for_selector',
  'wait_for_timeout',
  'wait_for_navigation',
])
const INPUT_TYPES = new Set(['fill', 'select'])
const CLICK_TYPES = new Set(['click', 'dblclick'])

// ARIA role 倾向分类
const ENUM_ROLES = new Set(['tab', 'menuitem', 'option', 'radio', 'menuitemradio'])
const BRANCH_ROLES = new Set(['link', 'button'])

/**
 * 分析操作序列中每个节点的推荐角色。
 * 规则优先，基于 branchCandidates 启发式判断。
 */
export function analyzeNodeRoles(nodes: OperationNode[]): NodeRoleRecommendation[] {
  const recommendations: NodeRoleRecommendation[] = []

  for (const node of nodes) {
    const rec = analyzeOneNode(node, nodes)
    if (rec) {
      recommendations.push(rec)
    }
  }

  return recommendations
}

function analyzeOneNode(
  node: OperationNode,
  _allNodes: OperationNode[]
): NodeRoleRecommendation | null {
  const { action } = node

  // 规则 1：导航类 → 普通节点
  if (NAVIGATION_TYPES.has(action.type)) {
    return {
      nodeId: node.id,
      recommendedRole: 'normal',
      confidence: 1.0,
      reasoning: '导航操作固定为普通节点',
    }
  }

  // 规则 2：等待类 → 普通节点
  if (WAIT_TYPES.has(action.type)) {
    return {
      nodeId: node.id,
      recommendedRole: 'normal',
      confidence: 1.0,
      reasoning: '等待操作固定为普通节点',
    }
  }

  // 规则 3：输入类 → 动态参数
  if (INPUT_TYPES.has(action.type)) {
    return {
      nodeId: node.id,
      recommendedRole: 'dynamic_param',
      confidence: 1.0,
      reasoning: '输入操作固定为动态参数',
    }
  }

  // 规则 4：点击类 → 需要基于 branchCandidates 启发式分析
  if (CLICK_TYPES.has(action.type)) {
    return analyzeClickNode(node)
  }

  // 其他类型（check, keydown, hover, extract_selected_content）→ 普通节点
  return {
    nodeId: node.id,
    recommendedRole: 'normal',
    confidence: 0.9,
    reasoning: '非点击/输入/导航类操作，默认为普通节点',
  }
}

function analyzeClickNode(node: OperationNode): NodeRoleRecommendation {
  const { action } = node
  const candidates = action.branchCandidates

  // 无候选项 → 普通节点
  if (!candidates || candidates.length === 0) {
    return {
      nodeId: node.id,
      recommendedRole: 'normal',
      confidence: 0.9,
      reasoning: '无兄弟候选元素，推荐为普通节点',
    }
  }

  // 构建候选节点列表（包含被点击的元素自身）
  const roleCandidate = buildRoleCandidates(node, candidates)

  // 启发式判断
  const candidateCount = candidates.length
  const clickedRole = action.attributes?.['role']
  const candidateRoles = candidates
    .map(c => c.attributes?.['role'])
    .filter(Boolean) as string[]

  // 启发式 1：ARIA role 是 tab/menuitem/option/radio → 枚举参数
  if (clickedRole && ENUM_ROLES.has(clickedRole)) {
    return {
      nodeId: node.id,
      recommendedRole: 'enum_param',
      confidence: 0.9,
      reasoning: `元素角色为 "${clickedRole}"，属于枚举式选择`,
      candidates: roleCandidate,
    }
  }

  // 启发式 2：大多数候选项有 tab/menuitem/option role → 枚举参数
  const enumRoleCount = candidateRoles.filter(r => ENUM_ROLES.has(r)).length
  if (enumRoleCount > candidateCount * 0.5) {
    return {
      nodeId: node.id,
      recommendedRole: 'enum_param',
      confidence: 0.8,
      reasoning: `多数候选元素具有枚举式角色 (${enumRoleCount}/${candidateCount})`,
      candidates: roleCandidate,
    }
  }

  // 启发式 3：候选数量 2~5 且文本各不相同 → 倾向枚举参数
  if (candidateCount >= 1 && candidateCount <= 5) {
    const texts = [
      action.innerText,
      ...candidates.map(c => c.innerText),
    ].filter(Boolean)
    const uniqueTexts = new Set(texts)

    if (uniqueTexts.size === texts.length && texts.length >= 2) {
      // 检查 href 差异 → 如果 href 指向不同的路径结构，可能是分支
      const hrefs = [
        action.attributes?.['href'],
        ...candidates.map(c => c.attributes?.['href']),
      ].filter(Boolean) as string[]

      if (hrefs.length >= 2 && hasStructurallyDifferentPaths(hrefs)) {
        return {
          nodeId: node.id,
          recommendedRole: 'branch_point',
          confidence: 0.6,
          reasoning: `候选元素链接指向结构不同的路径，可能是分支点`,
          candidates: roleCandidate,
        }
      }

      return {
        nodeId: node.id,
        recommendedRole: 'enum_param',
        confidence: 0.7,
        reasoning: `${candidateCount + 1} 个选项，文本各不相同，推荐为枚举参数`,
        candidates: roleCandidate,
      }
    }
  }

  // 启发式 4：候选数量 >5 → 可能是列表数据，推荐为循环目标
  if (candidateCount > 5) {
    return {
      nodeId: node.id,
      recommendedRole: 'loop_target',
      confidence: 0.7,
      reasoning: `候选元素较多 (${candidateCount}个)，可能是列表项，推荐为循环目标`,
      candidates: roleCandidate,
    }
  }

  // 启发式 5：有 BRANCH_ROLES 且候选项 tagName 不一致 → 分支点
  const clickedTag = action.tagName?.toLowerCase()
  const candidateTags = candidates.map(c => c.tagName)
  const hasMixedTags = candidateTags.some(t => t !== clickedTag)
  if (hasMixedTags) {
    return {
      nodeId: node.id,
      recommendedRole: 'branch_point',
      confidence: 0.5,
      reasoning: '候选元素标签类型不一致，可能是分支点',
      candidates: roleCandidate,
    }
  }

  // 默认：有候选但无法确定 → 普通节点，但附带候选信息供用户判断
  return {
    nodeId: node.id,
    recommendedRole: 'normal',
    confidence: 0.5,
    reasoning: `存在 ${candidateCount} 个候选元素，但无法确定角色`,
    candidates: roleCandidate,
  }
}

/**
 * 构建角色候选列表（包含被点击元素自身作为第一项，默认选中）
 */
function buildRoleCandidates(
  node: OperationNode,
  branchCandidates: NonNullable<OperationNode['action']['branchCandidates']>
): NodeRoleCandidate[] {
  const self: NodeRoleCandidate = {
    selector: node.action.selector,
    innerText: node.action.innerText?.slice(0, 50),
    tagName: node.action.tagName,
    attributes: node.action.attributes,
    selected: true, // 被点击的元素默认选中
  }

  const others: NodeRoleCandidate[] = branchCandidates.map(c => ({
    selector: c.selector,
    innerText: c.innerText?.slice(0, 50),
    tagName: c.tagName,
    attributes: c.attributes,
    elementIndex: c.elementIndex,
    parentSelector: c.parentSelector,
    selected: true, // 候选默认全选
  }))

  return [self, ...others]
}

/**
 * 从录制的 action.branchCandidates 构建侧栏/元数据用的 candidates（第一项为实际被点击元素）。
 * 供 loop_target 或改角色懒加载等场景复用，与 analyzeClickNode 内部逻辑一致。
 */
export function buildClickNodeRoleCandidates(node: OperationNode): NodeRoleCandidate[] | undefined {
  if (!CLICK_TYPES.has(node.action.type)) return undefined
  const branchCandidates = node.action.branchCandidates
  if (!branchCandidates || branchCandidates.length === 0) return undefined
  return buildRoleCandidates(node, branchCandidates)
}

/**
 * 检查一组 href 是否指向结构上不同的路径
 * 例如 /admin/dashboard 和 /user/profile 结构不同
 * 而 /products/1 和 /products/2 结构相同
 */
function hasStructurallyDifferentPaths(hrefs: string[]): boolean {
  const patterns = hrefs.map(href => {
    try {
      const url = new URL(href, 'http://placeholder')
      // 将路径中的数字和 UUID 段替换为通配
      return url.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/*').replace(/\/\d+/g, '/*')
    } catch {
      return href.replace(/\/[0-9a-f-]{8,}/gi, '/*').replace(/\/\d+/g, '/*')
    }
  })

  const uniquePatterns = new Set(patterns)
  return uniquePatterns.size > 1
}
