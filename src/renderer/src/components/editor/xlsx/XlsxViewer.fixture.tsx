import { defineFixture } from '../../../component-fixtures/component-fixture'
import { encodeBase64Bytes } from '@/lib/base64-bytes'
import workbookUrl from '../../../../../../tests/e2e/fixtures/xlsx/preview.xlsx?url'
import XlsxViewer from './XlsxViewer'

const content = encodeBase64Bytes(new Uint8Array(await (await fetch(workbookUrl)).arrayBuffer()))

export const formatted = defineFixture({
  width: 1000,
  render: () => (
    <div className="h-[840px] flex flex-col">
      <XlsxViewer content={content} filePath="preview.xlsx" />
    </div>
  ),
  interact: async (frame) => {
    if (frame.querySelector('[role="table"]')) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect()
        reject(new Error('Workbook fixture did not render'))
      }, 10_000)
      const observer = new MutationObserver(() => {
        if (frame.querySelector('[role="table"]')) {
          clearTimeout(timeout)
          observer.disconnect()
          resolve()
        }
      })
      observer.observe(frame, { childList: true, subtree: true })
    })
  }
})
