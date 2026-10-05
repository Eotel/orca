import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { createTabsSliceMockApi } from '../store/slices/tabs-slice-test-harness'
import { createTestStore } from '../store/slices/store-test-helpers'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentStatusModule>()),
  detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
}))

const testStore = vi.hoisted(() => {
  const ref: { current: ReturnType<typeof createTestStore> | null } = { current: null }
  return ref
})
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => {
      if (!testStore.current) {
        throw new Error('no test store')
      }
      return testStore.current.getState()
    }
  }
}))
const callRuntimeRpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params: Record<string, unknown>) => Promise<unknown>>()
)
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callRuntimeRpc
}))

createTabsSliceMockApi()

const { launchAgentThroughHost } = await import('./agent-launch-through-host')
const { agentLaunchPaneSpawnHold, releaseAgentLaunchPaneSpawn } =
  await import('./agent-launch-pane-spawn-hold')
const { agentLaunchPanePrompt } = await import('./agent-launch-pane-prompt')

const WT = 'repo1::/tmp/feature'
let store: ReturnType<typeof createTestStore>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function rpcError(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({
    id: 'desktop-ipc',
    ok: false,
    error: { code, message: code },
    _meta: { runtimeId: 'runtime-1' }
  })
}

function terminalResult(paneKey: string, outcome: string) {
  return {
    outcome: { kind: 'terminal', handle: 'term_1', paneKey },
    worktreeId: WT,
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'x' },
    prompt: { delivery: 'submit', outcome }
  }
}

function launchTab(tabId: string | null) {
  return store.getState().tabsByWorktree[WT]?.find((tab) => tab.id === tabId)
}

function lastParams(): Record<string, unknown> {
  return callRuntimeRpc.mock.calls.at(-1)?.[2] ?? {}
}

function lastPaneKey(): string {
  return String(lastParams().paneKey)
}

function launch() {
  return launchAgentThroughHost({
    agent: 'claude',
    worktreeId: WT,
    groupId: store.getState().activeGroupIdByWorktree[WT],
    prompt: 'fix the failing checks',
    agentArgs: null,
    launchSource: 'source_control_recovery'
  })
}

/** What the host does first: it takes the pane, by asking this window to show the tab. */
function hostTakesPane(tabId: string | null): void {
  const tab = launchTab(tabId)!
  releaseAgentLaunchPaneSpawn(tab.id, tab.agentLaunchPane!.leafId)
}

beforeEach(() => {
  store = createTestStore()
  testStore.current = store
  callRuntimeRpc.mockReset()
  store.getState().setActiveWorktree(WT)
  store.getState().createUnifiedTab(WT, 'terminal')
})

describe('a desktop launch through the host', () => {
  it('shows its tab at the click, in its split, waiting for the host before it spawns', () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)

    const { tabId } = launch()

    const tab = launchTab(tabId)!
    expect(tab).toMatchObject({ ptyId: null, launchAgent: 'claude' })
    const leafId = tab.agentLaunchPane!.leafId
    expect(agentLaunchPaneSpawnHold(tab.id, leafId)).not.toBeNull()
    expect(agentLaunchPanePrompt(tab.id)).toBe('fix the failing checks')
    expect(store.getState().activeTabId).toBe(tabId)
    expect(callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'agent.launchReplay', {
      agent: 'claude',
      target: { kind: 'existing', worktree: `id:${WT}` },
      prompt: { text: 'fix the failing checks', delivery: 'submit' },
      agentArgs: null,
      launchSource: 'source_control_recovery',
      placement: { groupId: store.getState().activeGroupIdByWorktree[WT] },
      presentation: 'focused',
      operationId: expect.stringMatching(/^\d+-[0-9a-f]{32}$/),
      paneKey: `${tabId}:${leafId}`
    })
  })

  it('names every click as its own operation', () => {
    callRuntimeRpc.mockReturnValue(new Promise(() => {}))
    launch()
    const first = lastParams()
    launch()
    const second = lastParams()
    expect(second.operationId).not.toBe(first.operationId)
    expect(second.paneKey).not.toBe(first.paneKey)
  })

  it('reports the prompt delivered only on the host receipt', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, delivery } = launch()
    hostTakesPane(tabId)

    reply.resolve(terminalResult(lastPaneKey(), 'handed-to-terminal'))

    await expect(delivery).resolves.toEqual({ kind: 'delivered' })
    expect(launchTab(tabId)).toBeDefined()
  })

  it('keeps the follow-up from running when the host did not deliver the prompt', async () => {
    callRuntimeRpc.mockResolvedValue(terminalResult('tab:leaf', 'not-delivered'))
    await expect(launch().delivery).resolves.toEqual({ kind: 'not-delivered', agentExited: false })
  })

  it('passes on that the agent exited at startup before it read its prompt', async () => {
    callRuntimeRpc.mockResolvedValue({
      ...terminalResult('tab:leaf', 'not-delivered'),
      prompt: { delivery: 'submit', outcome: 'not-delivered', reason: 'agent-exited' }
    })
    await expect(launch().delivery).resolves.toEqual({ kind: 'not-delivered', agentExited: true })
  })

  it('takes its tab back on a refusal, before the pane ever spawns', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, delivery } = launch()

    reply.reject(rpcError('agent_session_operation_conflict'))

    await expect(delivery).resolves.toEqual({
      kind: 'not-started',
      unconfirmed: false,
      code: 'agent_session_operation_conflict'
    })
    expect(launchTab(tabId)).toBeUndefined()
  })

  it('takes back a tab the host took and then refused, so no pane is left with nothing to say', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, delivery } = launch()
    hostTakesPane(tabId)

    reply.reject(rpcError('agent_session_operation_expired'))

    await expect(delivery).resolves.toEqual({
      kind: 'not-started',
      unconfirmed: false,
      code: 'agent_session_operation_expired'
    })
    expect(launchTab(tabId)).toBeUndefined()
  })

  it('leaves a launch the host took to its pane, which says how it ended', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, delivery } = launch()
    hostTakesPane(tabId)

    reply.reject(rpcError('agent_session_operation_unknown'))

    await expect(delivery).resolves.toEqual({ kind: 'pane-says' })
    expect(launchTab(tabId)).toBeDefined()
  })

  it('never leaves a pane the host did not take, which would open as a shell', async () => {
    const reply = deferred<unknown>()
    callRuntimeRpc.mockReturnValue(reply.promise)
    const { tabId, delivery } = launch()

    reply.reject(rpcError('worktree_not_found'))

    await expect(delivery).resolves.toEqual({
      kind: 'not-started',
      unconfirmed: false,
      code: 'worktree_not_found'
    })
    expect(launchTab(tabId)).toBeUndefined()
  })

  it('still starts the agent in the same tab when the launch record is full', async () => {
    const unrecorded = deferred<unknown>()
    callRuntimeRpc
      .mockRejectedValueOnce(rpcError('agent_session_operation_capacity'))
      .mockReturnValueOnce(unrecorded.promise)
    const { tabId, delivery } = launch()
    const paneKey = lastPaneKey()
    await vi.waitFor(() => expect(callRuntimeRpc).toHaveBeenCalledTimes(2))

    const [, method, params] = callRuntimeRpc.mock.calls[1]!
    expect(method).toBe('agent.launch')
    expect(params).not.toHaveProperty('operationId')
    // The same pane, so the tab neither closes nor reopens, and stays held until the answer.
    expect(params.paneKey).toBe(paneKey)
    expect(launchTab(tabId)).toBeDefined()
    const leafId = launchTab(tabId)!.agentLaunchPane!.leafId
    expect(agentLaunchPaneSpawnHold(tabId!, leafId)).not.toBeNull()

    unrecorded.resolve(terminalResult(paneKey, 'handed-to-terminal'))
    await expect(delivery).resolves.toEqual({ kind: 'delivered' })
    expect(launchTab(tabId)).toBeDefined()
  })

  it('takes its tab back when the unrecorded launch fails before the host revealed it', async () => {
    callRuntimeRpc
      .mockRejectedValueOnce(rpcError('agent_session_operation_capacity'))
      .mockRejectedValueOnce(rpcError('worktree_not_found'))
    const { tabId, delivery } = launch()

    await expect(delivery).resolves.toEqual({
      kind: 'not-started',
      unconfirmed: false,
      code: 'worktree_not_found'
    })
    expect(launchTab(tabId)).toBeUndefined()
  })

  describe('when chat is the default', () => {
    beforeEach(() => {
      store.setState({
        settings: {
          ...store.getState().settings!,
          experimentalNativeChat: true,
          experimentalStructuredNativeChat: true,
          openAgentTabsInChatByDefault: true
        }
      })
    })

    it('leaves the tab to the host, which alone knows if this ends as a chat', () => {
      callRuntimeRpc.mockReturnValue(new Promise(() => {}))
      const tabsBefore = store.getState().tabsByWorktree[WT]?.length ?? 0

      expect(launch().tabId).toBeNull()

      expect(store.getState().tabsByWorktree[WT]?.length ?? 0).toBe(tabsBefore)
      expect(lastParams().paneKey).toEqual(expect.any(String))
    })

    it('leaves a failed launch to the tab the host showed, and says it when it showed none', async () => {
      callRuntimeRpc.mockRejectedValueOnce(rpcError('agent_session_operation_unknown'))
      await expect(launch().delivery).resolves.toEqual({
        kind: 'not-started',
        unconfirmed: true,
        code: 'agent_session_operation_unknown'
      })

      const reply = deferred<unknown>()
      callRuntimeRpc.mockReturnValueOnce(reply.promise)
      const { delivery } = launch()
      const [tabId, leafId] = lastPaneKey().split(':')
      store.getState().createTab(WT, undefined, undefined, { id: tabId, initialLeafId: leafId })
      reply.reject(rpcError('agent_session_operation_unknown'))
      await expect(delivery).resolves.toEqual({ kind: 'pane-says' })
    })
  })
})
