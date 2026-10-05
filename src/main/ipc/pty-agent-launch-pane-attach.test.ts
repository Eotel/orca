import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { makePaneKey } from '../../shared/stable-pane-id'
import { registerPtyHandlers, setLocalPtyProvider } from './pty'
import {
  claimAgentLaunchPane,
  resetAgentLaunchPanesForTests
} from '../agent-launch/agent-launch-pane-attachment'
import { AGENT_LAUNCH_PANE_FAILURE_MARKER } from '../../shared/agent-launch-pane-failure'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

function localProvider(spawn: ReturnType<typeof vi.fn>): never {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double carrying every provider member the spawn path calls; an unexpected call throws on the missing method.
  return {
    spawn,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    shutdown: vi.fn(),
    sendSignal: vi.fn(),
    getCwd: vi.fn(),
    getInitialCwd: vi.fn(),
    clearBuffer: vi.fn(),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(),
    getForegroundProcess: vi.fn(),
    serialize: vi.fn(),
    revive: vi.fn(),
    onData: vi.fn(() => () => {}),
    onReplay: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    listProcesses: vi.fn(async () => []),
    attach: vi.fn(),
    getDefaultShell: vi.fn(),
    getProfiles: vi.fn()
  } as never
}

describe('a pane whose process belongs to an agent launch', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()
  const tabId = 'tab-agent-launch-early'
  const leafId = '55555555-5555-4555-8555-555555555555'
  const worktreeId = 'repo-1::/tmp/agent-launch-early'

  afterEach(() => {
    resetAgentLaunchPanesForTests()
  })

  function mountPane(): Promise<unknown> {
    return Promise.resolve(
      handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp/agent-launch-early',
        worktreeId,
        tabId,
        leafId,
        env: { ORCA_PANE_KEY: makePaneKey(tabId, leafId), ORCA_WORKTREE_ID: worktreeId }
      })
    )
  }

  function registerWithRuntime(providerSpawn: ReturnType<typeof vi.fn>): void {
    setLocalPtyProvider(localProvider(providerSpawn))
    const runtime = {
      setPtyController: vi.fn(),
      createPreAllocatedTerminalHandle: vi.fn(() => 'term_early'),
      registerPreAllocatedHandleForPty: vi.fn(),
      registerPty: vi.fn(),
      onPtySpawned: vi.fn(),
      onPtyExit: vi.fn(),
      onPtyData: vi.fn()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the suite's window double and a runtime carrying only the members a renderer spawn reaches.
    registerPtyHandlers(mainWindow as never, runtime as never)
  }

  it('waits for the host instead of spawning while the launch runs', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-after-launch' }))
    registerWithRuntime(providerSpawn)
    const owned = claimAgentLaunchPane(worktreeId, makePaneKey(tabId, leafId))

    const mounted = mountPane()
    // An unblocked spawn settles well inside this window.
    const early = await Promise.race([
      mounted.then(() => 'settled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 1000))
    ])
    expect(early).toBe('waiting')
    expect(providerSpawn).not.toHaveBeenCalled()

    owned.launched()
    await expect(mounted).resolves.toMatchObject({ id: 'pty-after-launch' })
  })

  it('shows the launch failure instead of starting a shell', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    registerWithRuntime(providerSpawn)
    const owned = claimAgentLaunchPane(worktreeId, makePaneKey(tabId, leafId))

    const mounted = mountPane()
    await new Promise<void>((resolve) => setImmediate(resolve))
    owned.failed('spawn agent ENOENT')

    await expect(mounted).rejects.toThrow(`${AGENT_LAUNCH_PANE_FAILURE_MARKER} spawn agent ENOENT`)
    expect(providerSpawn).not.toHaveBeenCalled()
  })

  it('still refuses a shell to a pane that mounts after the launch failed', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    registerWithRuntime(providerSpawn)
    claimAgentLaunchPane(worktreeId, makePaneKey(tabId, leafId)).failed('agent_not_installed')

    await expect(mountPane()).rejects.toThrow('agent_not_installed')
    expect(providerSpawn).not.toHaveBeenCalled()
  })
})
