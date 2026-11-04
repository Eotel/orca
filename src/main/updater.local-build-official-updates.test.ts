import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'
import { updaterMainWindow } from './updater-test-main-window'

const {
  appMock,
  autoUpdaterMock,
  chooseLocalBuildMock,
  fetchNudgeMock,
  moduleFactories,
  powerMonitorOnMock,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('./ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

warmUpdaterModule()

describe('updater on a local build', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
    appMock.getVersion.mockReturnValue('1.4.247-local.1793753958683.9f15f6d1291d')
  })

  it.each(['1.4.247-local.1793753958683.9f15f6d1291d', '1.4.159-rc.0.local.123.abc'])(
    'never asks the official feed on its own: %s',
    async (version) => {
      appMock.getVersion.mockReturnValue(version)
      const { setupAutoUpdater, checkForUpdates } = await loadUpdaterModule()

      setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => null })
      checkForUpdates()
      await vi.advanceTimersByTimeAsync(TWO_DAYS_MS)

      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(fetchNudgeMock).not.toHaveBeenCalled()
      expect(powerMonitorOnMock).not.toHaveBeenCalled()
    }
  )

  it('answers a menu check and a pinned official build without asking the feed', async () => {
    const send = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(updaterMainWindow(send), { getLastUpdateCheckAt: () => null })

    checkForUpdatesFromMenu()
    checkForUpdatesFromMenu({ channel: 'stable', targetTag: 'v1.4.247' })
    await vi.advanceTimersByTimeAsync(0)

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('updater:status', {
      state: 'not-available',
      userInitiated: true
    })
  })

  it.runIf(process.platform === 'darwin')(
    'still switches to a local build the user picks',
    async () => {
      chooseLocalBuildMock.mockResolvedValue({
        version: '1.4.248-local.1793753958684.abc',
        manifestContent: 'version: 1.4.248-local.1793753958684.abc',
        artifacts: new Map()
      })
      const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
      setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => null })

      checkForUpdatesFromMenu({ localBuild: true })

      await vi.waitFor(() => {
        expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
      })
      expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
        provider: 'generic',
        url: 'http://127.0.0.1:1234/token/'
      })
    }
  )

  it('tells paired desktops that this server is updated by hand', async () => {
    const { setupAutoUpdater, getRemoteServerUpdateSupport } = await loadUpdaterModule()
    setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => null })

    expect(getRemoteServerUpdateSupport()).toMatchObject({
      automatic: false,
      reason: 'unpackaged-build'
    })
  })
})
