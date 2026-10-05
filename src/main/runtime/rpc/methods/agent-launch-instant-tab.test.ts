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
  awaitAgentLaunchPaneAttachment,
  resetAgentLaunchPanesForTests
} from '../../../agent-launch/agent-launch-pane-attachment'
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

    await plainLaunch(runtime, {}, CLI)

    const request = runtime.published[0]!
    expect(terminalOptions(runtime)).toMatchObject({
      tabId: request.tabId,
      leafId: request.leafId,
      requireFreshPane: true
    })
  })

  it('binds the spawn to the shown tab without moving anyone a second time', async () => {
    const runtime = hostWithWindow()

    await plainLaunch(runtime, { presentation: 'focused' }, CLI)

    expect(terminalOptions(runtime)).toMatchObject({ surfaceOwner: false })
  })

  it('lets the waiting pane attach once the agent is running', async () => {
    const runtime = hostWithWindow({ terminalPaneKey: PANE_KEY })

    await plainLaunch(runtime, { paneKey: PANE_KEY }, CLI)

    // Nothing left to wait on: the pane's spawn goes straight to the agent's process.
    expect(awaitAgentLaunchPaneAttachment('wt-7', PANE_KEY)).toBeNull()
    expect(runtime.withdrawAgentLaunchTab).not.toHaveBeenCalled()
  })

  it('shows a failed spawn in the pane, keeps the tab, and never offers the pane a shell', async () => {
    const runtime = hostWithWindow()
    runtime.createTerminal.mockRejectedValueOnce(new Error('spawn claude ENOENT'))

    await expect(plainLaunch(runtime, { paneKey: PANE_KEY }, CLI)).rejects.toThrow('ENOENT')

    await expect(awaitAgentLaunchPaneAttachment('wt-7', PANE_KEY)!).rejects.toThrow(
      'spawn claude ENOENT'
    )
    expect(runtime.withdrawAgentLaunchTab).not.toHaveBeenCalled()
  })

  it('still launches when the window could not show the tab early', async () => {
    const runtime = hostWithWindow({ reply: new Error('renderer_unavailable') })

    const result = await plainLaunch(runtime, {}, CLI)

    expect(result.outcome.kind).toBe('terminal')
    expect(result.placement).toBeUndefined()
  })

  it('is not shown early for a chat-mode launch, whose tab is the session', async () => {
    const runtime = hostWithWindow({ settings: STRUCTURED_PREFERENCE })

    await plainLaunch(runtime, {}, CLI)

    expect(runtime.published).toEqual([])
  })

  it('is not shown early to a phone that would read a listed tab as a started agent', async () => {
    const runtime = hostWithWindow()

    await replayLaunch(runtime, { paneKey: PANE_KEY }, OLD_PHONE)

    expect(runtime.published).toEqual([])
  })
})

describe('retries', () => {
  it('a replay never makes a second tab: it reuses the first, and takes back one it had to make', async () => {
    const operationId = nextOperationId()
    const first = hostWithWindow({ terminalPaneKey: PANE_KEY })
    await replayLaunch(first, { paneKey: PANE_KEY, operationId }, CLI)

    // The tab is still there: the window finds it by id, and nothing is taken back.
    const replayedIntoLiveTab = hostWithWindow({ reply: { created: false } })
    await replayLaunch(replayedIntoLiveTab, { paneKey: PANE_KEY, operationId }, CLI)
    expect(replayedIntoLiveTab.createTerminal).not.toHaveBeenCalled()
    expect(replayedIntoLiveTab.withdrawAgentLaunchTab).not.toHaveBeenCalled()

    // The user closed it meanwhile: the replay's own tab is taken back, not left empty.
    const replayedAfterClose = hostWithWindow()
    await replayLaunch(replayedAfterClose, { paneKey: PANE_KEY, operationId }, CLI)
    await vi.waitFor(() =>
      expect(replayedAfterClose.withdrawAgentLaunchTab).toHaveBeenCalledWith(TAB_ID)
    )
    expect(replayedAfterClose.createTerminal).not.toHaveBeenCalled()
  })
})

describe('placement', () => {
  it('passes the requested place to the window and reports where the tab landed', async () => {
    const runtime = hostWithWindow({
      reply: { placement: { groupId: 'group-anchor', fallback: 'anchor-group' } }
    })

    const result = await plainLaunch(
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
    ['the CLI asking for focus moves the window', CLI, 'focused', 'focus-window'],
    ['the CLI by default reveals the workspace as before', CLI, undefined, 'reveal-owner'],
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

    await plainLaunch(runtime, {}, CLI)

    expect(runtime.published[0]?.viewMode).toBe('chat')
    expect(terminalOptions(runtime)).toMatchObject({ viewMode: 'chat' })
  })

  it('stays the terminal for a draft the chat view cannot mirror', async () => {
    const runtime = hostWithWindow({ settings: CHAT_VIEW })

    await plainLaunch(runtime, { prompt: { text: '   ', delivery: 'draft' } }, CLI)

    expect(runtime.published[0]?.viewMode).toBe('terminal')
    expect(terminalOptions(runtime)).toMatchObject({ viewMode: 'terminal' })
  })
})

it('parses the minted pane key the window was given', async () => {
  const runtime = hostWithWindow()
  await plainLaunch(runtime, {}, CLI)
  const request = runtime.published[0]!
  expect(parsePaneKey(`${request.tabId}:${request.leafId}`)).not.toBeNull()
})
