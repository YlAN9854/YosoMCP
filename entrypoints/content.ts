import { CS_MSG } from '@/types/message'
import {
  startRecording,
  pauseRecording,
  resumeRecording,
  stopRecording,
  getRecordingStatus,
  getPageSnapshot,
} from '@/content/recorder'
import { executeAction } from '@/content/replayer'
import {
  startSelectorPicker,
  stopSelectorPicker,
  getPickerOriginalElement,
  getPickedElements,
} from '@/content/selectorPicker'
import { inferSelectorPattern } from '@/content/selectorPatternInfer'
import {
  startContentExtractPicker,
  stopContentExtractPicker,
} from '@/content/contentExtractPicker'
import {
  startUploadPicker,
  stopUploadPicker,
} from '@/content/uploadPicker'
import {
  startHoverPicker,
  stopHoverPicker,
} from '@/content/hoverPicker'
import {
  startWaitElementPicker,
  stopWaitElementPicker,
} from '@/content/waitElementPicker'
import {
  testLoopTargetPreviewAtIndex,
  scanLoopTargetPreview,
  testSelectorHighlight,
} from '@/content/loopTargetPreview'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    // 防止重复初始化
    if ((window as any).__YOSO_CONTENT_SCRIPT_INITIALIZED__) {
      console.log('[YOSO] Content script already initialized')
      return
    }
    ;(window as any).__YOSO_CONTENT_SCRIPT_INITIALIZED__ = true

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case CS_MSG.START_RECORDING:
          startRecording(message.data)
          sendResponse({ success: true })
          break
        case CS_MSG.PAUSE_RECORDING:
          pauseRecording()
          sendResponse({ success: true })
          break
        case CS_MSG.RESUME_RECORDING:
          resumeRecording()
          sendResponse({ success: true })
          break
        case CS_MSG.STOP_RECORDING:
          stopRecording()
          sendResponse({ success: true })
          break
        case CS_MSG.GET_PAGE_INFO:
          sendResponse({
            success: true,
            data: {
              url: location.href,
              title: document.title,
              ...getRecordingStatus(),
            },
          })
          break
        case CS_MSG.GET_PAGE_SNAPSHOT:
          sendResponse({
            success: true,
            data: getPageSnapshot(),
          })
          break
        case CS_MSG.REPLAY_EXECUTE_ACTION:
          executeAction(message.data)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: (err as Error).message }))
          return true // 异步 sendResponse

        case CS_MSG.START_SELECTOR_PICKER:
          startSelectorPicker(
            message.data.originalSelector,
            (_pickedElements, patternResult) => {
              chrome.runtime.sendMessage({
                type: CS_MSG.SELECTOR_PICKED,
                data: { patternResult },
              })
            },
            {
              originalTagName: message.data.originalTagName,
              originalText: message.data.originalText,
              parentSelector: message.data.parentSelector,
              elementIndex: message.data.elementIndex,
            }
          )
          sendResponse({ success: true })
          break

        case CS_MSG.STOP_SELECTOR_PICKER:
          stopSelectorPicker()
          sendResponse({ success: true })
          break

        case CS_MSG.START_CONTENT_EXTRACT_PICKER:
          startContentExtractPicker(
            (result) => {
              chrome.runtime.sendMessage({
                type: CS_MSG.CONTENT_EXTRACT_PICKED,
                data: result,
              })
            },
            () => {
              chrome.runtime.sendMessage({
                type: CS_MSG.CONTENT_EXTRACT_CANCELLED,
              })
            }
          )
          sendResponse({ success: true })
          break

        case CS_MSG.STOP_CONTENT_EXTRACT_PICKER:
          stopContentExtractPicker()
          sendResponse({ success: true })
          break

        case CS_MSG.START_UPLOAD_PICKER:
          startUploadPicker(
            (result) => {
              chrome.runtime.sendMessage({
                type: CS_MSG.UPLOAD_PICKED,
                data: result,
              })
            },
            () => {
              chrome.runtime.sendMessage({
                type: CS_MSG.UPLOAD_CANCELLED,
              })
            }
          )
          sendResponse({ success: true })
          break

        case CS_MSG.STOP_UPLOAD_PICKER:
          stopUploadPicker()
          sendResponse({ success: true })
          break

        case CS_MSG.START_HOVER_PICKER:
          startHoverPicker(
            (result) => {
              chrome.runtime.sendMessage({
                type: CS_MSG.HOVER_PICKED,
                data: result,
              })
            },
            () => {
              chrome.runtime.sendMessage({
                type: CS_MSG.HOVER_CANCELLED,
              })
            }
          )
          sendResponse({ success: true })
          break

        case CS_MSG.STOP_HOVER_PICKER:
          stopHoverPicker()
          sendResponse({ success: true })
          break

        case CS_MSG.START_WAIT_ELEMENT_PICKER:
          startWaitElementPicker(
            message.data || {},
            (result) => {
              chrome.runtime.sendMessage({
                type: CS_MSG.WAIT_ELEMENT_PICKED,
                data: result,
              })
            },
            () => {
              chrome.runtime.sendMessage({
                type: CS_MSG.WAIT_ELEMENT_CANCELLED,
              })
            }
          )
          sendResponse({ success: true })
          break

        case CS_MSG.STOP_WAIT_ELEMENT_PICKER:
          stopWaitElementPicker()
          sendResponse({ success: true })
          break

        case CS_MSG.INFER_SELECTOR_PATTERN: {
          const sanitizeSelectorForLookup = (selector: string): string => {
            // 去掉常见瞬时状态类，避免录制结束后元素无法再命中（如 tr.hover）
            return selector
              .replace(/\.hover\b/g, '')
              .replace(/\.active\b/g, '')
              .replace(/\.selected\b/g, '')
              .replace(/\.focus\b/g, '')
              .replace(/\.current\b/g, '')
          }

          const resolveBySelectorAndIndex = (
            selector?: string,
            index?: number
          ): Element | null => {
            if (!selector) return null
            try {
              const exact = (() => {
                if (typeof index === 'number' && index >= 0) {
                  const matches = document.querySelectorAll(selector)
                  return matches[index] || null
                }
                return document.querySelector(selector)
              })()
              if (exact) return exact

              const sanitized = sanitizeSelectorForLookup(selector)
              if (sanitized !== selector) {
                if (typeof index === 'number' && index >= 0) {
                  const matches = document.querySelectorAll(sanitized)
                  return matches[index] || null
                }
                return document.querySelector(sanitized)
              }

              if (typeof index === 'number' && index >= 0) {
                const matches = document.querySelectorAll(selector)
                return matches[index] || null
              }
              return document.querySelector(selector)
            } catch {
              return null
            }
          }

          const origEl = getPickerOriginalElement()
            || resolveBySelectorAndIndex(
              message.data.originalSelector,
              message.data.originalSelectorIndex
            )
          const picked = getPickedElements()

          if (!origEl) {
            sendResponse({ success: false, error: '无法定位原始元素' })
            break
          }

          // 如果有 pickedSelectors（从 Background 透传），在 DOM 中查找对应元素
          let elements = picked
          if (elements.length === 0 && message.data.pickedSelectorTargets) {
            elements = (message.data.pickedSelectorTargets as Array<{ selector: string; index?: number }>)
              .map(target => resolveBySelectorAndIndex(target.selector, target.index))
              .filter((el: Element | null): el is Element => el !== null)
          }

          if (elements.length === 0 && message.data.pickedSelectors) {
            elements = (message.data.pickedSelectors as string[])
              .map((sel: string) => resolveBySelectorAndIndex(sel))
              .filter((el: Element | null): el is Element => el !== null)
          }

          // 去重并排除与原始元素相同的样本，避免“同一个元素”导致分叉层级无法定位
          const uniqueElements = Array.from(new Set(elements)).filter(el => el !== origEl)
          const result = inferSelectorPattern(origEl, uniqueElements)
          sendResponse({ success: true, data: result })
          break
        }
        case CS_MSG.LOOP_TARGET_PREVIEW_TEST: {
          const result = testLoopTargetPreviewAtIndex({
            fullSelector: message.data.fullSelector,
            clickTargetWithinItem: message.data.clickTargetWithinItem,
            index: message.data.index,
            highlightMs: message.data.highlightMs,
          })
          sendResponse({ success: true, data: result })
          break
        }
        case CS_MSG.LOOP_TARGET_PREVIEW_SCAN: {
          const result = scanLoopTargetPreview({
            fullSelector: message.data.fullSelector,
            clickTargetWithinItem: message.data.clickTargetWithinItem,
            maxScan: message.data.maxScan,
          })
          sendResponse({ success: true, data: result })
          break
        }

        case CS_MSG.TEST_SELECTOR_HIGHLIGHT: {
          const result = testSelectorHighlight(
            message.data.selector,
            message.data.highlightMs,
          )
          sendResponse({ success: true, data: result })
          break
        }

        default:
          return false
      }
      return true
    })
  },
})
