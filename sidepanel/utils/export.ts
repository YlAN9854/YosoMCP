import type { ToolSet } from '@/types/toolset'
import { zipSync, strToU8 } from 'fflate'

export interface ZipFileEntry {
  filename: string
  content: string
}

export function downloadAsZip(files: readonly ZipFileEntry[], zipFilename: string): void {
  const zipData: Record<string, Uint8Array> = {}

  for (const file of files) {
    zipData[file.filename] = strToU8(file.content)
  }

  const zipped = zipSync(zipData)
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = zipFilename
  a.click()

  URL.revokeObjectURL(url)
}

export function downloadCode(code: string, filename: string) {
  const blob = new Blob([code], { type: 'text/typescript' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function downloadSkill(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

export function downloadToolSetAsJson(toolSet: ToolSet, filename?: string): void {
  const json = JSON.stringify(toolSet, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const safeName = toolSet.name.replace(/[^\w\u4e00-\u9fa5\-_.]/g, '_')
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `${safeName}.yoso.json`
  a.click()

  URL.revokeObjectURL(url)
}

/** Stable codes for i18n in UI layer */
export const TOOLSET_IMPORT = {
  NO_FILE: 'TOOLSET_IMPORT_NO_FILE',
  INVALID: 'TOOLSET_IMPORT_INVALID',
  JSON_PARSE: 'TOOLSET_IMPORT_JSON_PARSE',
  READ: 'TOOLSET_IMPORT_READ',
  CANCELLED: 'TOOLSET_IMPORT_CANCELLED',
} as const

export function importToolSetFromFile(): Promise<ToolSet> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.yoso.json'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error(TOOLSET_IMPORT.NO_FILE))
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string
          const parsed = JSON.parse(text) as Partial<ToolSet>

          if (!parsed.id || !parsed.name) {
            throw new Error(TOOLSET_IMPORT.INVALID)
          }

          resolve(parsed as ToolSet)
        } catch (err) {
          if (err instanceof Error && err.message === TOOLSET_IMPORT.INVALID) {
            reject(err)
            return
          }
          reject(err instanceof Error ? err : new Error(TOOLSET_IMPORT.JSON_PARSE))
        }
      }
      reader.onerror = () => reject(new Error(TOOLSET_IMPORT.READ))
      reader.readAsText(file)
    }

    input.oncancel = () => reject(new Error(TOOLSET_IMPORT.CANCELLED))
    input.click()
  })
}
