import { parseXlsxCellReference } from './xlsx-cell-reference'
import { MAX_CHART_CATEGORIES } from './xlsx-chart-xml'

export type XlsxChartReferenceValue = { text: string; numeric?: number }
export type XlsxChartReferenceResolver = (
  reference: string
) => XlsxChartReferenceValue[] | undefined

export type XlsxChartReferenceSheet = {
  rows: readonly (readonly string[])[]
  numericValues: ReadonlyMap<string, number>
}

export function resolveXlsxChartReference(
  reference: string,
  sheets: ReadonlyMap<string, XlsxChartReferenceSheet>
): XlsxChartReferenceValue[] | undefined {
  const match =
    /^(?:'((?:[^']|'')+)'|([^'![\],()+*/]+))!([$]?[A-Z]+[$]?[1-9][0-9]*)(?::([$]?[A-Z]+[$]?[1-9][0-9]*))?$/.exec(
      reference
    )
  if (!match) {
    return undefined
  }
  const sheetName = match[1]?.replaceAll("''", "'") ?? match[2]
  if (!sheetName || /[[\]]/.test(sheetName)) {
    return undefined
  }
  const sheet = sheets.get(sheetName)
  const first = parseXlsxCellReference(match[3]!.replaceAll('$', ''))
  const last = parseXlsxCellReference((match[4] ?? match[3]!).replaceAll('$', ''))
  if (!sheet || !first || !last) {
    return undefined
  }
  if (first.rowIndex !== last.rowIndex && first.columnIndex !== last.columnIndex) {
    return undefined
  }
  const rowStep = Math.sign(last.rowIndex - first.rowIndex)
  const columnStep = Math.sign(last.columnIndex - first.columnIndex)
  const count =
    Math.max(
      Math.abs(last.rowIndex - first.rowIndex),
      Math.abs(last.columnIndex - first.columnIndex)
    ) + 1
  if (count > MAX_CHART_CATEGORIES) {
    return undefined
  }
  return Array.from({ length: count }, (_, index) => {
    const row = first.rowIndex + index * rowStep
    const column = first.columnIndex + index * columnStep
    return {
      text: sheet.rows[row]?.[column] ?? '',
      numeric: sheet.numericValues.get(`${row}:${column}`)
    }
  })
}
