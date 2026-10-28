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
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(testInfo.outputPath(name), Buffer.from(data, 'base64'))
  }
  const resize = orcaPage.getByRole('separator', { name: 'Resize column A', exact: true })
  const width = Number(await resize.getAttribute('aria-valuenow'))
  await resize.focus()
  await resize.press('ArrowRight')
  await expect(resize).toHaveAttribute('aria-valuenow', String(width + 8))
  await capture('orca-summary.png')
  await orcaPage.getByRole('tab', { name: 'メモ', exact: true }).click()
  await expect(orcaPage.getByRole('cell', { name: 'プレビュー確認', exact: true })).toBeVisible()
  await capture('orca-notes.png')
  await orcaPage.getByRole('tab', { name: '売上集計', exact: true }).click()
  await expect(orcaPage.getByRole('cell', { name: '¥8,400', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
