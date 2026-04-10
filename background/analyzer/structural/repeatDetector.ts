// 循环检测算法

import type { OperationNode } from '@/types/operationTree'
import type { OperationSignature, RepeatPattern } from '@/types/analysis'

/** 在 parentId 链上判断 ancestorId 是否为 descendantId 的祖先（含直接父节点） */
function isAncestorInParentTree(
  ancestorId: string,
  descendantId: string,
  parentById: Map<string, string | null | undefined>
): boolean {
  const seen = new Set<string>()
  let cur: string | null | undefined = descendantId
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    cur = parentById.get(cur) ?? null
  }
  return false
}

/** 相邻两次签名重复之间，后一段首节点须落在前一段末节点的子树内，避免兄弟分支同构流程被并为一组 */
function repeatBoundariesRespectParentTree(
  signatures: OperationSignature[],
  startIdx: number,
  patternLen: number,
  repeatCount: number,
  parentById: Map<string, string | null | undefined>
): boolean {
  if (repeatCount < 2) return true
  for (let r = 1; r < repeatCount; r++) {
    const idx = startIdx + r * patternLen
    const prevId = signatures[idx - 1]!.nodeId
    const currId = signatures[idx]!.nodeId
    if (!isAncestorInParentTree(prevId, currId, parentById)) {
      return false
    }
  }
  return true
}

function buildParentById(nodes: OperationNode[]): Map<string, string | null | undefined> {
  const m = new Map<string, string | null | undefined>()
  for (const n of nodes) {
    m.set(n.id, n.parentId ?? null)
  }
  return m
}

export function detectRepeatPatterns(
  signatures: OperationSignature[],
  nodes: OperationNode[],
  minRepeatCount: number = 2
): RepeatPattern[] {
  const parentById = buildParentById(nodes)
  const maxPatternLength = Math.floor(signatures.length / minRepeatCount)
  const patterns: RepeatPattern[] = []
  const usedIndices = new Set<number>()

  for (let patternLen = maxPatternLength; patternLen >= 1; patternLen--) {
    for (
      let startIdx = 0;
      startIdx <= signatures.length - patternLen * minRepeatCount;
      startIdx++
    ) {
      if (usedIndices.has(startIdx)) continue

      const patternSigs = signatures
        .slice(startIdx, startIdx + patternLen)
        .map(s => s.signature)

      const repeatCount = countConsecutiveRepeats(signatures, startIdx, patternSigs)

      if (repeatCount >= minRepeatCount && isValidRepeatPattern(patternSigs, repeatCount)) {
        if (
          signatures.length !== nodes.length ||
          !repeatBoundariesRespectParentTree(
            signatures,
            startIdx,
            patternLen,
            repeatCount,
            parentById
          )
        ) {
          continue
        }

        const endIndex = startIdx + patternLen * repeatCount

        // 收集每次重复的节点 ID
        const patternNodeIds: string[][] = []
        for (let r = 0; r < repeatCount; r++) {
          const offset = startIdx + r * patternLen
          patternNodeIds.push(
            signatures.slice(offset, offset + patternLen).map(s => s.nodeId)
          )
        }

        patterns.push({
          patternSignatures: patternSigs,
          patternNodeIds,
          repeatCount,
          startIndex: startIdx,
          endIndex,
          patternLength: patternLen,
        })

        for (let i = startIdx; i < endIndex; i++) {
          usedIndices.add(i)
        }
      }
    }
  }

  return patterns.sort((a, b) => a.startIndex - b.startIndex)
}

function countConsecutiveRepeats(
  signatures: OperationSignature[],
  startIdx: number,
  pattern: string[]
): number {
  let count = 0
  let offset = startIdx

  while (offset + pattern.length <= signatures.length) {
    const chunk = signatures.slice(offset, offset + pattern.length).map(s => s.signature)
    if (chunk.every((sig, i) => sig === pattern[i])) {
      count++
      offset += pattern.length
    } else {
      break
    }
  }

  return count
}

function isValidRepeatPattern(pattern: string[], repeatCount: number): boolean {
  // 模式长度 >= 2，或单签名需要 >= 3 次
  if (pattern.length === 1 && repeatCount < 3) return false
  if (pattern.length < 1) return false
  return true
}
