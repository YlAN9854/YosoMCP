// 结构分析主入口

import type { OperationNode } from '@/types/operationTree'
import type { StructuralAnalysisResult } from '@/types/analysis'
import { generateSignatures } from './signature'
import { detectRepeatPatterns } from './repeatDetector'
import { extractBranchPaths, compareAllBranches, identifyEnumBranchGroups } from './branchAnalyzer'
import { detectSplitPoints, generateToolSegments } from './splitDetector'

export function runStructuralAnalysis(nodes: OperationNode[]): StructuralAnalysisResult {
  // Step 1: 生成操作签名
  const signatures = generateSignatures(nodes)

  // Step 2: 检测拆分点
  const splitPoints = detectSplitPoints(nodes)

  // Step 3: 提取分支路径
  const branchPaths = extractBranchPaths(nodes)

  // Step 4: 比较分支相似度
  const branchComparisons = compareAllBranches(branchPaths)

  // Step 5: 识别枚举分支组
  const enumBranchGroups = identifyEnumBranchGroups(branchComparisons, branchPaths, nodes)

  // Step 6: 检测循环模式
  const repeatPatterns = detectRepeatPatterns(signatures, nodes)

  // Step 7: 生成工具片段
  const toolSegments = generateToolSegments(nodes, splitPoints, repeatPatterns)

  return {
    signatures,
    repeatPatterns,
    branchPaths,
    branchComparisons,
    enumBranchGroups,
    splitPoints,
    toolSegments,
  }
}
