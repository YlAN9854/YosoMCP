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

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}
