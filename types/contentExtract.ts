export type ContentExtractMode = 'text' | 'screenshot'

export interface ContentExtractPickedResult {
  selector: string
  extractMode: ContentExtractMode
  extractedText?: string
  extractedScreenshot?: string  // base64 data URL，截图模式下录制时捕获的元素快照
}
