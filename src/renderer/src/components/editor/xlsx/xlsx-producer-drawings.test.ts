// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXlsxWorkbook } from './xlsx-workbook'
import { resolveXlsxChartReference } from './xlsx-chart-references'
import { parseXlsxChart } from './xlsx-chart'
import { parseXlsxThemePalette } from './xlsx-theme-palette'

describe('producer drawing formats', () => {
  it.each(['preview.xlsx', 'preview-libreoffice.xlsx', 'preview-excel-style.xlsx'])(
    'reads images and populated charts from %s',
    async (name) => {
      const bytes = await readFile(resolve('tests/e2e/fixtures/xlsx', name))
      const workbook = await parseXlsxWorkbook(bytes)
      const drawings = workbook.sheets[0]!.drawings
      expect(
        drawings.some(
          (drawing) =>
            drawing.kind === 'image' && drawing.source.startsWith('data:image/png;base64,')
        )
      ).toBe(true)
      const chart = drawings.find((drawing) => drawing.kind === 'chart')
      expect(chart?.kind === 'chart' ? chart.chart.series[0]?.values : undefined).toEqual([
        8400, 4500, 7200
      ])
      expect(chart?.kind === 'chart' ? chart.chart.categories : undefined).toEqual([
        'ノート',
        'ペン',
        'ファイル'
      ])
      if (name === 'preview.xlsx') {
        expect(workbook.sheets[0]?.styles[26]?.[4]?.textColor).toBe('#466b87')
        expect(chart).toMatchObject({
          fromRow: 10,
          fromColumn: 0,
          widthPx: 6120000 / 9525,
          heightPx: 2808000 / 9525
        })
      }
    }
  )

  it('uses namespace URIs and preserves caches before resolving references', () => {
    const xml = `<q:chartSpace xmlns:q="http://schemas.openxmlformats.org/drawingml/2006/chart"><q:chart><q:plotArea><q:barChart><q:ser><q:val><q:numRef><q:f>Sheet1!A1:A2</q:f><q:numCache><q:pt idx="0"><q:v>7</q:v></q:pt></q:numCache></q:numRef></q:val></q:ser></q:barChart></q:plotArea></q:chart></q:chartSpace>`
    const chart = parseXlsxChart(xml, parseXlsxThemePalette(''), {
      resolveReference: () => {
        throw new Error('Cached references must not resolve')
      }
    })
    expect(chart?.series[0]?.values).toEqual([7])
  })

  it('only resolves a continuous row or column on a sheet in this workbook', () => {
    const sheets = new Map([
      [
        'Sheet 1',
        {
          rows: [
            ['a', 'b'],
            ['c', 'd']
          ],
          numericValues: new Map([['1:0', 12]])
        }
      ],
      ["O'Brien", { rows: [['quoted']], numericValues: new Map<string, number>() }]
    ])
    expect(
      resolveXlsxChartReference("'Sheet 1'!$A$1:$B$1", sheets)?.map((value) => value.text)
    ).toEqual(['a', 'b'])
    expect(resolveXlsxChartReference('Sheet 1!A1:A2', sheets)?.[1]?.numeric).toBe(12)
    expect(resolveXlsxChartReference("'O''Brien'!A1", sheets)?.[0]?.text).toBe('quoted')
    for (const reference of [
      "'Sheet 1'!A1:B2",
      "'[other.xlsx]Sheet 1'!A1",
      'NamedRange',
      'SUM(Sheet 1!A1:A2)',
      "'Sheet 1'!A1,A2"
    ]) {
      expect(resolveXlsxChartReference(reference, sheets)).toBeUndefined()
    }
  })
})
