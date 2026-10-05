import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { makePaneKey } from '../../shared/stable-pane-id'
import { registerPtyHandlers, setLocalPtyProvider } from './pty'
import {
  resetAgentLaunchPanesForTests,
  trackRunningAgentLaunchPane
} from '../agent-launch/agent-launch-pane-attachment'
import {
  pendingAgentSessionOperationRow,
  type AgentSessionOperationOutcome,
  type AgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'

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
  const paneKey = makePaneKey(tabId, leafId)
  const pane = { worktreeId, paneKey }

  afterEach(() => {
    resetAgentLaunchPanesForTests()
  })

  function recorded(outcome: AgentSessionOperationOutcome): AgentSessionOperationRow {
    return {
      ...pendingAgentSessionOperationRow({
        callerKey: 'caller',
        operationId: `${Date.now()}-${'1'.padStart(32, '0')}`,
        fingerprint: 'fp',
        now: Date.now()
      }),
      outcome,
      ownedPane: pane
    }
  }

  function mountPane(): Promise<unknown> {
    return Promise.resolve(
      handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp/agent-launch-early',
        worktreeId,
        tabId,
        leafId,
        env: { ORCA_PANE_KEY: paneKey, ORCA_WORKTREE_ID: worktreeId }
      })
    )
  }

  /** `rows` is the launch record; null models a process that has not opened it yet. */
  function registerWithRuntime(
    providerSpawn: ReturnType<typeof vi.fn>,
    record: { rows: AgentSessionOperationRow[] | null; restoredTabFromLaunch?: boolean }
  ): void {
    setLocalPtyProvider(localProvider(providerSpawn))
    const runtime = {
      setPtyController: vi.fn(),
      createPreAllocatedTerminalHandle: vi.fn(() => 'term_early'),
      registerPreAllocatedHandleForPty: vi.fn(),
      registerPty: vi.fn(),
      onPtySpawned: vi.fn(),
      onPtyExit: vi.fn(),
      onPtyData: vi.fn(),
      hasLiveTerminalForPaneKey: vi.fn(() => false),
      openedAgentSessionRecordStore: vi.fn(() =>
        record.rows ? { listOperationRows: () => record.rows } : null
      ),
      openAgentSessionRecordStore: vi.fn(async () => ({
        listOperationRows: () => record.rows ?? [recorded({ status: 'unknown' })]
      }))
    }
    // The persisted session as a restart restores it: the tab says a launch laid out this leaf.
    const store = record.restoredTabFromLaunch
      ? {
          getWorkspaceSession: () => ({
            tabsByWorktree: { [worktreeId]: [{ id: tabId, agentLaunchLeafId: leafId }] }
          })
        }
      : undefined
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the suite's window double, carrying the members a renderer spawn reaches.
    const window = mainWindow as never
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a runtime carrying only the members a renderer spawn reaches before it is refused or proceeds.
    const spawnRuntime = runtime as never
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a store carrying only the persisted session the launch pane's spawn reads.
    const spawnStore = store as never
    registerPtyHandlers(window, spawnRuntime, undefined, undefined, undefined, spawnStore)
  }

  it('waits for the launch instead of spawning while it runs', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-after-launch' }))
    const rows: AgentSessionOperationRow[] = []
    registerWithRuntime(providerSpawn, { rows })
    const running = trackRunningAgentLaunchPane(pane)

    const mounted = mountPane()
    // An unblocked spawn settles well inside this window.
    const early = await Promise.race([
      mounted.then(() => 'settled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 1000))
    ])
    expect(early).toBe('waiting')
    expect(providerSpawn).not.toHaveBeenCalled()

    rows.push(
      recorded({
        status: 'succeeded',
        sessionId: '',
        launch: {
          outcome: { kind: 'terminal', handle: 'term_1', paneKey },
          worktreeId,
          receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: '' }
        }
      })
    )
    running.finish({ tabTakenBack: false })
    await expect(mounted).resolves.toMatchObject({ id: 'pty-after-launch' })
  })

  it('shows the launch failure instead of starting a shell', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    const rows: AgentSessionOperationRow[] = []
    registerWithRuntime(providerSpawn, { rows })
    const running = trackRunningAgentLaunchPane(pane)

    const mounted = mountPane()
    await new Promise<void>((resolve) => setImmediate(resolve))
    rows.push(recorded({ status: 'failed', code: 'agent_session_exited_during_start' }))
    running.finish({ tabTakenBack: false })

    await expect(mounted).rejects.toThrow(
      '[agent-launch-pane] not-started:agent_session_exited_during_start'
    )
    expect(providerSpawn).not.toHaveBeenCalled()
  })

  it('still refuses a shell to a pane that mounts after the launch failed', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    registerWithRuntime(providerSpawn, {
      rows: [recorded({ status: 'failed', code: 'agent_not_installed' })]
    })

    await expect(mountPane()).rejects.toThrow('not-started:agent_not_installed')
    expect(providerSpawn).not.toHaveBeenCalled()
  })

  it('after a restart, a restored launch pane reads the record before it may start anything', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    registerWithRuntime(providerSpawn, { rows: null, restoredTabFromLaunch: true })

    await expect(mountPane()).rejects.toThrow('[agent-launch-pane] unconfirmed')
    expect(providerSpawn).not.toHaveBeenCalled()
  })

  it('never offers a shell in a tab the host is taking back', async () => {
    const providerSpawn = vi.fn(async () => ({ id: 'pty-plain-shell' }))
    registerWithRuntime(providerSpawn, { rows: [] })
    const running = trackRunningAgentLaunchPane(pane)

    const mounted = mountPane()
    running.finish({ tabTakenBack: true })

    await expect(mounted).rejects.toThrow('[agent-launch-pane] withdrawn')
    expect(providerSpawn).not.toHaveBeenCalled()
  })
})
