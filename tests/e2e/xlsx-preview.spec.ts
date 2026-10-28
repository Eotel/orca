import { copyFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'

test('Excel preview renders formatted sheets, drawings, and switches tabs', async ({
  orcaPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 1100)
  )
  const filePath = path.join(seededRepoPath, 'preview.xlsx')
  copyFileSync(path.join(process.cwd(), 'tests/e2e/fixtures/xlsx/preview.xlsx'), filePath)
  const errors: string[] = []
  orcaPage.on('pageerror', (error) => errors.push(error.message))
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture workspace')
    }
    state.openFile({
      filePath,
      relativePath: 'preview.xlsx',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  await expect(orcaPage.getByRole('tab', { name: '売上集計', exact: true })).toBeVisible()
  await expect(orcaPage.getByText('四半期 売上レポート', { exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('cell', { name: '¥8,400', exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('cell', { name: '2026/10/01', exact: true })).toBeVisible()
  await expect(orcaPage.getByText('Binary file — cannot display', { exact: true })).toHaveCount(0)
  await expect(orcaPage.locator('svg[role="img"]')).toHaveCount(1)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
  const cdp = await orcaPage.context().newCDPSession(orcaPage)
  const capture = async (name: string): Promise<void> => {
    await orcaPage.evaluate(async () => {
      await Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished)
      )
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    })
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(testInfo.outputPath(name), Buffer.from(data, 'base64'))
  }
  const measure = () =>
    orcaPage.getByRole('table').evaluate((table) => {
      const bounds = (selector: string) => {
        const element = table.querySelector(selector)
        if (!element) {
          throw new Error(`Missing geometry target ${selector}`)
        }
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      return {
        chart: bounds('svg[role="img"]'),
        image: bounds('img'),
        firstColumn: bounds('[role="columnheader"][aria-colindex="2"]'),
        imageColumn: bounds('[role="columnheader"][aria-colindex="6"]'),
        chartRow: bounds('[role="row"][data-index="10"]'),
        imageRow: bounds('[role="row"][data-index="8"]')
      }
    })
  const originalGeometry = await measure()
  for (const level of [3, 0]) {
    await orcaPage.evaluate(
      (level) => window.__store?.getState().setEditorFontZoomLevel(level),
      level
    )
    await expect
      .poll(async () => (await measure()).chart.width)
      .toBeCloseTo(((6120000 / 9525) * (13 + level)) / 13, 1)
    const geometry = await measure()
    expect(geometry.chart.x).toBeCloseTo(geometry.firstColumn.x, 0)
    expect(geometry.chart.y).toBeCloseTo(geometry.chartRow.y, 0)
    expect(geometry.image.x).toBeCloseTo(geometry.imageColumn.x, 0)
    expect(geometry.image.y).toBeCloseTo(geometry.imageRow.y, 0)
    expect(geometry.chart.width / originalGeometry.chart.width).toBeCloseTo((13 + level) / 13, 2)
    expect(geometry.image.width / originalGeometry.image.width).toBeCloseTo((13 + level) / 13, 2)
  }
  const resize = orcaPage.getByRole('separator', { name: 'Resize column A', exact: true })
  const width = Number(await resize.getAttribute('aria-valuenow'))
  await resize.focus()
  await resize.press('ArrowRight')
  await expect(resize).toHaveAttribute('aria-valuenow', String(width + 8))
  await resize.press('Enter')
  await expect(resize).toHaveAttribute('aria-valuenow', String(width))
  await resize.evaluate((element) => element.blur())
  await expect(resize).not.toBeFocused()
  await capture('orca-summary.png')
  const notesTab = orcaPage.getByRole('tab', { name: 'メモ', exact: true })
  await notesTab.click()
  await expect(notesTab).toHaveAttribute('aria-selected', 'true')
  await expect(orcaPage.getByRole('tab', { name: '売上集計', exact: true })).toHaveAttribute(
    'aria-selected',
    'false'
  )
  await expect(orcaPage.getByRole('cell', { name: 'プレビュー確認', exact: true })).toBeVisible()
  await capture('orca-notes.png')
  expect(await notesTab.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe(
    '1'
  )
  await orcaPage.getByRole('tab', { name: '売上集計', exact: true }).click()
  await expect(orcaPage.getByRole('cell', { name: '¥8,400', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
