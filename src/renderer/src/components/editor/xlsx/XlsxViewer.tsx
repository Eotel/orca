import React, { useEffect, useMemo, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { decodeBase64Bytes } from '@/lib/base64-bytes'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SpreadsheetGrid } from './SpreadsheetGrid'
import { xlsxColumnLettersFromIndex } from './xlsx-cell-reference'
import { MAX_XLSX_SHEET_ROWS, parseXlsxWorkbook, type XlsxWorkbook } from './xlsx-workbook'
import { getIntlLocale, translate } from '@/i18n/i18n'

type XlsxViewerProps = {
  /** Base64 workbook bytes, as delivered by the previewable-binary read path. */
  content: string
  filePath: string
}

type WorkbookLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workbook: XlsxWorkbook }

export default function XlsxViewer({ content, filePath }: XlsxViewerProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<WorkbookLoadState>({ status: 'loading' })
  const [sheetSelection, setSheetSelection] = useState({ filePath, index: 0 })

  const locale = getIntlLocale()

  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'loading' })
    // Why: decoding and inflating a multi-MB workbook is the expensive part, so
    // it runs off the render pass and its result is dropped if the tab moved on.
    Promise.resolve()
      .then(() => parseXlsxWorkbook(decodeBase64Bytes(content), { locale }))
      .then((workbook) => {
        if (!cancelled) {
          setLoadState({ status: 'ready', workbook })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to read this workbook'
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [content, locale])

  const sheets = loadState.status === 'ready' ? loadState.workbook.sheets : []
  const workbookFontFamily =
    loadState.status === 'ready' ? loadState.workbook.defaultFontFamily : undefined
  // Why: derive the active tab instead of resetting it in an Effect — opening a
  // different file must start on its first sheet without a stale-tab repaint.
  const activeSheetIndex =
    sheetSelection.filePath === filePath && sheetSelection.index < sheets.length
      ? sheetSelection.index
      : 0
  const activeSheet = sheets[activeSheetIndex]
  const columnHeader = useMemo(
    () =>
      Array.from({ length: activeSheet?.maxColumns ?? 0 }, (_, columnIndex) =>
        xlsxColumnLettersFromIndex(columnIndex)
      ),
    [activeSheet?.maxColumns]
  )

  if (loadState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {translate('auto.components.editor.XlsxViewer.4688c4c466', 'Loading workbook...')}
      </div>
    )
  }

  if (loadState.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-sm font-medium text-foreground">
          {translate('auto.components.editor.XlsxViewer.16c54c41e5', 'Unable to render workbook')}
        </div>
        <div className="max-w-xl break-words text-xs text-muted-foreground">
          {loadState.message}
        </div>
      </div>
    )
  }

  return (
    <Tabs
      className="h-full min-h-0"
      value={String(activeSheetIndex)}
      onValueChange={(value) => setSheetSelection({ filePath, index: Number(value) })}
    >
      <TabsContent value={String(activeSheetIndex)} className="flex min-h-0 flex-1">
        {activeSheet && activeSheet.rows.length > 0 ? (
          <SpreadsheetGrid
            key={`${filePath}:${activeSheetIndex}`}
            header={columnHeader}
            rows={activeSheet.rows}
            columnCount={activeSheet.maxColumns}
            cellStyles={activeSheet.styles}
            declaredColumnWidths={activeSheet.columnWidths}
            declaredRowHeights={activeSheet.rowHeights}
            mergedRanges={activeSheet.mergedRanges}
            drawings={activeSheet.drawings}
            sparklines={activeSheet.sparklines}
            headerAlignment="center"
            defaultVerticalAlignment="bottom"
            fontFamily={workbookFontFamily}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            {translate('auto.components.editor.XlsxViewer.2952ec35f8', 'Empty sheet')}
          </div>
        )}
      </TabsContent>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background px-3 py-1 text-xs text-foreground">
        <div className="min-w-0 grow basis-48 overflow-x-auto scrollbar-editor">
          <TabsList size="sm" variant="line">
            {sheets.map((sheet, index) => (
              <TabsTrigger
                key={sheet.name}
                value={String(index)}
                className="flex-none"
                title={
                  sheet.hidden
                    ? translate(
                        'auto.components.editor.XlsxViewer.aaf26ba2b6',
                        '{{name}} (hidden)',
                        {
                          name: sheet.name
                        }
                      )
                    : sheet.name
                }
              >
                <span className={cn(sheet.hidden && 'italic opacity-70')}>{sheet.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <LockKeyhole className="size-4" aria-hidden="true" />
            {translate('auto.components.editor.XlsxViewer.readOnly', 'Read-only')}
          </span>
          {activeSheet && (
            <>
              <span className="flex-shrink-0">
                {activeSheet.rows.length === 1
                  ? translate(
                      'auto.components.editor.XlsxViewer.cb88b1b447_one',
                      '{{rowCount}} row',
                      {
                        count: activeSheet.rows.length,
                        rowCount: activeSheet.rows.length.toLocaleString(getIntlLocale())
                      }
                    )
                  : translate(
                      'auto.components.editor.XlsxViewer.cb88b1b447_other',
                      '{{rowCount}} rows',
                      {
                        count: activeSheet.rows.length,
                        rowCount: activeSheet.rows.length.toLocaleString(getIntlLocale())
                      }
                    )}
              </span>
              <span className="flex-shrink-0">
                {activeSheet.maxColumns === 1
                  ? translate(
                      'auto.components.editor.XlsxViewer.2ce5b9eecb_one',
                      '{{columnCount}} column',
                      { count: activeSheet.maxColumns, columnCount: activeSheet.maxColumns }
                    )
                  : translate(
                      'auto.components.editor.XlsxViewer.2ce5b9eecb_other',
                      '{{columnCount}} columns',
                      { count: activeSheet.maxColumns, columnCount: activeSheet.maxColumns }
                    )}
              </span>
              {activeSheet.truncated && (
                <span className="flex-shrink-0 text-destructive">
                  {translate(
                    'auto.components.editor.XlsxViewer.2c8df21237',
                    'truncated at {{limit}} rows',
                    { limit: MAX_XLSX_SHEET_ROWS.toLocaleString(getIntlLocale()) }
                  )}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </Tabs>
  )
}
