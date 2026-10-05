/**
 * The tab of an `agent.launch` appears before the launch is admitted, at the requested place, and
 * the spawn lands in that tab's pane. Driven through the method's handler with the shared runtime
 * stub and the real durable ledger, so "before admission" is read off the order the host asked for
 * the tab and opened the launch record.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_LAUNCH_PLACEMENT_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../../../../shared/agent-launch-runtime-capability'
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type {
  AgentLaunchTabPublished,
  AgentLaunchTabPublishRequest
} from '../../../../shared/agent-launch-tab-publication'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  resetAgentLaunchPanesForTests,
  resolveAgentLaunchPaneVerdict,
  type AgentLaunchPaneEvidence
} from '../../../agent-launch/agent-launch-pane-attachment'
import type { AgentLaunchPaneVerdict } from '../../../../shared/agent-launch-pane-verdict'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import type { RpcContext } from '../core'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import {
  STRUCTURED_PREFERENCE,
  methodNamed,
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore,
  type AgentLaunchRuntimeStubOptions
} from './agent-launch.test-fixture'

vi.mock('./agent-launch-terminal-prompt', () => ({
  deliverTerminalAgentLaunchPrompt: vi.fn(async () => true)
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')
const AGENT_LAUNCH_REPLAY = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launchReplay')

const TAB_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const LEAF_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const TERMINAL_ONLY = {}
const LAUNCH = { agent: 'claude', target: { kind: 'existing', worktree: 'id:wt-7' } }
const CLI: Partial<RpcContext> = {}
const DESKTOP: Partial<RpcContext> = {
  caller: DESKTOP_RPC_CALLER,
  clientKind: 'runtime',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}
const OLD_PHONE: Partial<RpcContext> = {
  clientKind: 'mobile',
  pairedDeviceId: 'device-1',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}
const PHONE: Partial<RpcContext> = {
  ...OLD_PHONE,
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY, AGENT_LAUNCH_PLACEMENT_RUNTIME_CAPABILITY]
}

let directory: string
let store: AgentSessionRecordStore
let operationCounter = 0

function nextOperationId(): string {
  operationCounter += 1
  return `${Date.now()}-${operationCounter.toString(16).padStart(32, '0')}`
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-launch-instant-tab-'))
  store = await openTestAgentSessionRecordStore(directory)
  setAgentLaunchRecordStore(store)
})

afterEach(async () => {
  setAgentLaunchRecordStore(null)
  resetAgentLaunchPanesForTests()
  await rm(directory, { recursive: true, force: true })
})

/** A host with a window that shows the tab, recording what it was asked and in what order. */
function hostWithWindow(
  options: AgentLaunchRuntimeStubOptions & {
    reply?: Partial<AgentLaunchTabPublished> | Error
  } = {}
) {
  const events: string[] = []
  const published: Omit<AgentLaunchTabPublishRequest, 'requestId'>[] = []
  const runtime = runtimeStub({
    settings: TERMINAL_ONLY,
    ...options,
    publishAgentLaunchTab: (request) => {
      events.push('tab')
      published.push(request)
      return options.reply instanceof Error
        ? Promise.reject(options.reply)
        : Promise.resolve({
            tabId: request.tabId,
            created: true,
            placement: { groupId: 'group-1' },
            ...options.reply
          })
    }
  })
  const openStore = runtime.openAgentSessionRecordStore.getMockImplementation()!
  runtime.openAgentSessionRecordStore.mockImplementation(async () => {
    events.push('admission')
    return openStore()
  })
  const createTerminal = runtime.createTerminal.getMockImplementation()!
  runtime.createTerminal.mockImplementation(async (selector, createOptions) => {
    events.push('spawn')
    return createTerminal(selector, createOptions)
  })
  return Object.assign(runtime, {
    events,
    published,
    selectCreatedMobileSessionTabForClient: vi.fn(() => true)
  })
}

type Host = ReturnType<typeof hostWithWindow>

function replayLaunch(
  runtime: Host,
  params: Record<string, unknown>,
  context: Partial<RpcContext>
): Promise<AgentLaunchResult> {
  return AGENT_LAUNCH_REPLAY.handler(
    AGENT_LAUNCH_REPLAY.params.parse({ ...LAUNCH, operationId: nextOperationId(), ...params }),
    rpcContext(runtime, context)
  )
}

function plainLaunch(
  runtime: Host,
  params: Record<string, unknown>,
  context: Partial<RpcContext>
): Promise<AgentLaunchResult> {
  return AGENT_LAUNCH.handler(
    AGENT_LAUNCH.params.parse({ ...LAUNCH, ...params }),
    rpcContext(runtime, context)
  )
}

function terminalOptions(runtime: Host): Record<string, unknown> {
  return runtime.createTerminal.mock.calls[0]?.[1] ?? {}
}

/** What the pane reads when it mounts: this host's runtime, and the launch record on disk. */
function paneEvidence(
  runtime: Host,
  record: AgentSessionRecordStore = store
): AgentLaunchPaneEvidence {
  return {
    isPaneLive: (paneKey) => runtime.hasLiveTerminalForPaneKey(paneKey),
    openedRows: () => record.listOperationRows(),
    paneWasLaidOutByLaunch: () => true,
    openRows: async () => record.listOperationRows(),
    now: () => Date.now()
  }
}

async function paneVerdict(
  runtime: Host,
  record?: AgentSessionRecordStore,
  paneKey = PANE_KEY
): Promise<AgentLaunchPaneVerdict | 'unowned'> {
  return (
    (await resolveAgentLaunchPaneVerdict(
      { worktreeId: 'wt-7', paneKey },
      paneEvidence(runtime, record)
    )) ?? 'unowned'
  )
}

/** A spawn that fails before the daemon was asked for a process: nothing can be running. */
function failBeforeDispatch(runtime: Host, message: string): void {
  runtime.createTerminal.mockRejectedValueOnce(new Error(message))
}

/** A spawn the daemon was asked for, whose answer was lost: the process may exist. */
function failAfterDispatch(runtime: Host, message: string): void {
  runtime.createTerminal.mockImplementationOnce(async (_selector, createOptions) => {
    const dispatched = createOptions?.onPtySpawnDispatched
    if (typeof dispatched === 'function') {
      dispatched()
    }
    throw new Error(message)
  })
}

describe('the instant tab', () => {
  it('is asked for before the launch is admitted, and the spawn lands in its pane', async () => {
    const runtime = hostWithWindow({ terminalPaneKey: PANE_KEY })

    await replayLaunch(runtime, { paneKey: PANE_KEY }, CLI)

    expect(runtime.events.indexOf('tab')).toBeLessThan(runtime.events.indexOf('admission'))
    expect(runtime.published[0]).toMatchObject({
      worktreeId: 'wt-7',
      tabId: TAB_ID,
      leafId: LEAF_ID
    })
    expect(terminalOptions(runtime)).toMatchObject({ tabId: TAB_ID, leafId: LEAF_ID })
  })

  it('names a pane the host minted when the caller sent none, and spawns into that pane', async () => {
    const runtime = hostWithWindow()

    await replayLaunch(runtime, {}, CLI)

    const request = runtime.published[0]!
    expect(terminalOptions(runtime)).toMatchObject({
      tabId: request.tabId,
      leafId: request.leafId,
      requireFreshPane: true
    })
  })

  it('binds the spawn to the shown tab without moving anyone a second time', async () => {
    const runtime = hostWithWindow()

    await replayLaunch(runtime, { presentation: 'focused' }, CLI)

    expect(terminalOptions(runtime)).toMatchObject({ surfaceOwner: false, launchTabShown: true })
  })

  it('reveals the spawn as before when the window never said it showed the tab', async () => {
    const runtime = hostWithWindow({ reply: new Error('renderer_unavailable') })

    const result = await replayLaunch(runtime, {}, CLI)

    expect(result.outcome.kind).toBe('terminal')
    expect(result.placement).toBeUndefined()
    expect(terminalOptions(runtime)).not.toHaveProperty('surfaceOwner')
    expect(terminalOptions(runtime)).not.toHaveProperty('launchTabShown')
  })

  it('records the pane it showed with the launch, and lets the pane attach once the agent runs', async () => {
    const runtime = hostWithWindow({ terminalPaneKey: PANE_KEY })

    await replayLaunch(runtime, { paneKey: PANE_KEY }, CLI)

    expect(store.listOperationRows()[0]?.ownedPane).toEqual({
      worktreeId: 'wt-7',
      paneKey: PANE_KEY
    })
    await expect(paneVerdict(runtime)).resolves.toEqual({ kind: 'proceed' })
    expect(runtime.withdrawAgentLaunchTab).not.toHaveBeenCalled()
  })

  it('is not shown early for a chat-mode launch, whose tab is the session', async () => {
    const runtime = hostWithWindow({ settings: STRUCTURED_PREFERENCE })

    await replayLaunch(runtime, {}, CLI)

    expect(runtime.published).toEqual([])
  })

  it('is not shown early to a phone that would read a listed tab as a started agent', async () => {
    const runtime = hostWithWindow()

    await replayLaunch(runtime, { paneKey: PANE_KEY }, OLD_PHONE)

    expect(runtime.published).toEqual([])
  })

  it('is not shown early without an operation id: no record could tell its pane how it ended', async () => {
    const runtime = hostWithWindow()

    await plainLaunch(runtime, {}, CLI)

    expect(runtime.published).toEqual([])
  })
})

describe('the pane after its launch', () => {
  it('says a failed spawn did not start, keeps the tab, and says it again after a restart', async () => {
    const runtime = hostWithWindow()
    failBeforeDispatch(runtime, 'spawn claude ENOENT')

    await expect(replayLaunch(runtime, { paneKey: PANE_KEY }, CLI)).rejects.toThrow('ENOENT')

    await expect(paneVerdict(runtime)).resolves.toEqual({
      kind: 'not-started',
      code: 'spawn claude ENOENT'
    })
    expect(runtime.withdrawAgentLaunchTab).not.toHaveBeenCalled()
    // A restarted host: no launch in memory, the record read back from disk.
    resetAgentLaunchPanesForTests()
    const reopened = await openTestAgentSessionRecordStore(directory)
    await expect(paneVerdict(hostWithWindow(), reopened)).resolves.toMatchObject({
      kind: 'not-started'
    })
  })

  it('says it cannot confirm a spawn whose outcome is unknown, and attaches if the agent turns up', async () => {
    const runtime = hostWithWindow()
    failAfterDispatch(runtime, 'daemon create timed out')

    await expect(replayLaunch(runtime, { paneKey: PANE_KEY }, CLI)).rejects.toThrow(
      'agent_session_operation_unknown'
    )

    await expect(paneVerdict(runtime)).resolves.toEqual({ kind: 'unconfirmed' })
    runtime.hasLiveTerminalForPaneKey.mockReturnValue(true)
    await expect(paneVerdict(runtime)).resolves.toEqual({ kind: 'proceed' })
  })

  it("never touches a running agent's pane when a second launch names it", async () => {
    const first = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(first, { paneKey: PANE_KEY }, CLI)

    const second = hostWithWindow({
      adoptedPanes: { [PANE_KEY]: 'term_1' },
      terminalPaneAlreadyLive: true
    })
    await expect(replayLaunch(second, { paneKey: PANE_KEY }, CLI)).rejects.toThrow(
      'agent_launch_pane_already_live'
    )

    expect(second.published).toEqual([])
    expect(second.withdrawAgentLaunchTab).not.toHaveBeenCalled()
    // Its agent exits and the pane remounts: still the first launch's pane, never "couldn't start".
    second.hasLiveTerminalForPaneKey.mockReturnValue(false)
    await expect(paneVerdict(second)).resolves.toEqual({ kind: 'proceed' })
  })

  it('takes back a tab nothing ran into without letting its waiting pane start a shell', async () => {
    const operationId = nextOperationId()
    await replayLaunch(hostWithWindow({ terminalPaneKey: PANE_KEY }), { operationId }, CLI)

    const verdicts: Promise<AgentLaunchPaneVerdict | 'unowned'>[] = []
    const refused = hostWithWindow()
    const publish = refused.publishAgentLaunchTab.getMockImplementation()!
    refused.publishAgentLaunchTab.mockImplementation((request) => {
      const published = publish(request)
      // The pane mounts as soon as the tab exists.
      verdicts.push(paneVerdict(refused, store, `${request.tabId}:${request.leafId}`))
      return published
    })
    // The same id with other params: a conflict, so admission refuses and nothing runs.
    await expect(
      replayLaunch(refused, { operationId, prompt: { text: 'other', delivery: 'submit' } }, CLI)
    ).rejects.toThrow('agent_session_operation_conflict')

    await expect(verdicts[0]).resolves.toEqual({ kind: 'withdrawn' })
    await vi.waitFor(() => expect(refused.withdrawAgentLaunchTab).toHaveBeenCalledOnce())
  })
})

describe('retries', () => {
  it('a replay never makes a second tab, and never closes one an agent still runs in', async () => {
    const operationId = nextOperationId()
    const first = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(first, { paneKey: PANE_KEY, operationId }, CLI)

    // The agent is running: nothing is published, nothing taken back.
    const replayedIntoLiveAgent = hostWithWindow({ adoptedPanes: { [PANE_KEY]: 'term_1' } })
    await replayLaunch(replayedIntoLiveAgent, { paneKey: PANE_KEY, operationId }, CLI)
    expect(replayedIntoLiveAgent.published).toEqual([])
    expect(replayedIntoLiveAgent.withdrawAgentLaunchTab).not.toHaveBeenCalled()

    // The window still has the tab: it finds it by id, and nothing is taken back.
    const replayedIntoShownTab = hostWithWindow({ reply: { created: false } })
    await replayLaunch(replayedIntoShownTab, { paneKey: PANE_KEY, operationId }, CLI)
    expect(replayedIntoShownTab.createTerminal).not.toHaveBeenCalled()
    expect(replayedIntoShownTab.withdrawAgentLaunchTab).not.toHaveBeenCalled()

    // The tab is gone and so is its agent: the replay's own empty tab is taken back.
    const replayedAfterClose = hostWithWindow()
    await replayLaunch(replayedAfterClose, { paneKey: PANE_KEY, operationId }, CLI)
    await vi.waitFor(() =>
      expect(replayedAfterClose.withdrawAgentLaunchTab).toHaveBeenCalledWith(TAB_ID)
    )
    expect(replayedAfterClose.createTerminal).not.toHaveBeenCalled()
  })

  it('a replay that remade the tab of an agent that survived leaves it', async () => {
    const operationId = nextOperationId()
    await replayLaunch(
      hostWithWindow({ terminalPaneKey: PANE_KEY }),
      { paneKey: PANE_KEY, operationId },
      CLI
    )

    const replayed = hostWithWindow()
    // The agent's pane comes back while the replay runs (the daemon kept it across a crash).
    replayed.publishAgentLaunchTab.mockImplementationOnce(async (request) => {
      replayed.hasLiveTerminalForPaneKey.mockReturnValue(true)
      return { tabId: request.tabId, created: true, placement: { groupId: 'group-1' } }
    })
    await replayLaunch(replayed, { paneKey: PANE_KEY, operationId }, CLI)

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(replayed.withdrawAgentLaunchTab).not.toHaveBeenCalled()
  })
})

describe('placement', () => {
  it('passes the requested place to the window and reports where the tab landed', async () => {
    const runtime = hostWithWindow({
      reply: { placement: { groupId: 'group-anchor', fallback: 'anchor-group' } }
    })

    const result = await replayLaunch(
      runtime,
      { placement: { groupId: 'group-closed', afterTabId: 'tab-anchor' } },
      CLI
    )

    expect(runtime.published[0]?.placement).toEqual({
      groupId: 'group-closed',
      afterTabId: 'tab-anchor'
    })
    expect(result.placement).toEqual({ groupId: 'group-anchor', fallback: 'anchor-group' })
  })

  it('is not part of what a retry must repeat', async () => {
    const operationId = nextOperationId()
    const runtime = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(
      runtime,
      { paneKey: PANE_KEY, operationId, placement: { groupId: 'g-1' } },
      CLI
    )

    await expect(
      replayLaunch(
        hostWithWindow({ reply: { created: false } }),
        { paneKey: PANE_KEY, operationId, placement: { groupId: 'g-2' } },
        CLI
      )
    ).resolves.toMatchObject({ outcome: { kind: 'terminal' } })
  })
})

describe('whose view moves', () => {
  it.each([
    ['a local caller asking for focus moves the window', CLI, 'focused', 'focus-window'],
    ['a local caller by default reveals the workspace as before', CLI, undefined, 'reveal-owner'],
    [
      'the desktop stays in its workspace if you moved on',
      DESKTOP,
      undefined,
      'focus-in-workspace'
    ],
    ['a phone never moves the window', PHONE, 'focused', 'none'],
    ['background moves nobody', CLI, 'background', 'none']
  ] as const)('%s', async (_name, context, presentation, viewer) => {
    const runtime = hostWithWindow()

    await replayLaunch(runtime, presentation ? { presentation } : {}, context)

    expect(runtime.published[0]?.viewer).toBe(viewer)
  })

  it("moves the phone's own selection unless it asked for the background", async () => {
    const focused = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(focused, { paneKey: PANE_KEY }, PHONE)
    expect(focused.selectCreatedMobileSessionTabForClient).toHaveBeenCalledOnce()

    const background = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(background, { paneKey: PANE_KEY, presentation: 'background' }, PHONE)
    expect(background.selectCreatedMobileSessionTabForClient).not.toHaveBeenCalled()
  })
})

describe('the view the tab opens in', () => {
  const CHAT_VIEW = { experimentalNativeChat: true, openAgentTabsInChatByDefault: true }

  it('is derived on the host, the same for the shown tab and the spawn', async () => {
    const runtime = hostWithWindow({ settings: CHAT_VIEW })

    await replayLaunch(runtime, {}, CLI)

    expect(runtime.published[0]?.viewMode).toBe('chat')
    expect(terminalOptions(runtime)).toMatchObject({ viewMode: 'chat' })
  })

  it('stays the terminal for a draft the chat view cannot mirror', async () => {
    const runtime = hostWithWindow({ settings: CHAT_VIEW })

    await replayLaunch(runtime, { prompt: { text: '   ', delivery: 'draft' } }, CLI)

    expect(runtime.published[0]?.viewMode).toBe('terminal')
    expect(terminalOptions(runtime)).toMatchObject({ viewMode: 'terminal' })
  })
})

it('hands the window the prompt, so a pane whose agent did not start can offer to copy it', async () => {
  const runtime = hostWithWindow()
  await replayLaunch(runtime, { prompt: { text: 'fix the build', delivery: 'submit' } }, CLI)
  expect(runtime.published[0]?.prompt).toBe('fix the build')
})

it('parses the minted pane key the window was given', async () => {
  const runtime = hostWithWindow()
  await replayLaunch(runtime, {}, CLI)
  const request = runtime.published[0]!
  expect(parsePaneKey(`${request.tabId}:${request.leafId}`)).not.toBeNull()
})
