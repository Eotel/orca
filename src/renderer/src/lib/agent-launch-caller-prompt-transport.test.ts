// How each call site's prompt reaches the agent: handed to the host, which carries it by its one
// rule, or kept by the window (a draft, or text an agent takes only after it starts and the tab
// leaves unsent) — and whether it submits. Pinned per agent mode crossed with the delivery a call
// site asks for. How the host carries a prompt is pinned host-side, against the same rule.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../../shared/tui-agent'
import {
  callerProfileCases,
  type AgentLaunchCallerProfile
} from './agent-launch-caller-profiles-test-harness'
import {
  createLaunchFunnelStore,
  hostLaunchRequest,
  queuedStartupCommand,
  resetLaunchFunnelStore
} from './agent-launch-funnel-test-harness'
import { newTabPromptLaunchesThroughHost } from './launch-agent-new-tab-host-route'

const store = createLaunchFunnelStore()
/** Loosely typed so the suite can read back the whole delivery request the funnel built. */
const mockPasteDraftWhenAgentReady = vi.hoisted(() =>
  vi.fn<(request: Record<string, unknown>) => Promise<boolean>>(async () => true)
)

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdFromState: () => null }))
vi.mock('@/lib/native-chat-transcript-readability', () => ({
  isNativeChatTranscriptLocalReadable: () => true
}))
vi.mock('@/runtime/web-runtime-session', () => ({ isWebRuntimeSessionActive: () => false }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => 'local',
  getRuntimeEnvironmentIdForWorktree: () => null
}))
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: (_stored: unknown, terminalIds: string[]) => terminalIds
}))
vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))
vi.mock('@/components/native-chat/native-chat-session-option-cache', () => ({
  seedNativeChatAppliedSessionOptions: vi.fn()
}))
vi.mock('@/lib/agent-paste-draft', () => ({
  pasteDraftWhenAgentReady: mockPasteDraftWhenAgentReady
}))
vi.mock('@/lib/agent-ready-wait', () => ({
  waitForAgentReady: vi.fn(async () => ({ ready: true, reason: 'foreground-match' }))
}))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  readLocalRuntimeCapabilitiesOrUnknown: () => []
}))
function hostReceipt(outcome: 'handed-to-terminal' | 'not-delivered') {
  return {
    outcome: { kind: 'terminal', handle: 'term_1', paneKey: 'tab:leaf' },
    worktreeId: 'wt-1',
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'x' },
    prompt: { delivery: 'submit', outcome }
  }
}
const callRuntimeRpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc, RuntimeRpcCallError: Error }))
vi.mock('sonner', () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }))

function launchesThroughHost(args: AgentLaunchCallerProfile['args']): boolean {
  return newTabPromptLaunchesThroughHost({
    agent: args.agent,
    prompt: args.prompt?.trim() ?? '',
    promptDelivery: args.promptDelivery ?? 'auto-submit'
  })
}

/** A prompt the host delivers: one request, nothing the window types or pastes itself. */
function expectHandedToHost(
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready' | undefined,
  prompt: string
): void {
  expect(hostLaunchRequest(callRuntimeRpc)?.prompt).toEqual({
    text: prompt,
    delivery: 'submit',
    // Only a caller that acts on the result asks for one the host can prove.
    ...(promptDelivery === 'submit-after-ready' ? { confirmation: 'required' } : {})
  })
  expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
  expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
}

const PROMPT = 'Explain the failing check and propose a fix.'

/**
 * One agent per prompt-injection mode crossed with the delivery a call site can ask for.
 * `transport` is what the window does with the text: `host` hands it to the host's launch, `argv`
 * folds a draft into the launch command, `paste` starts the agent empty and pastes it once ready.
 */
const TRANSPORT_TABLE: readonly {
  agent: TuiAgent
  mode: string
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  transport: 'host' | 'argv' | 'paste'
  submits: boolean
}[] = [
  { agent: 'codex', mode: 'argv', promptDelivery: 'auto-submit', transport: 'host', submits: true },
  { agent: 'codex', mode: 'argv', promptDelivery: 'draft', transport: 'paste', submits: false },
  {
    agent: 'codex',
    mode: 'argv',
    promptDelivery: 'submit-after-ready',
    transport: 'host',
    submits: true
  },
  // Claude is the argv agent with a native draft flag, so its draft rides argv instead of pasting.
  { agent: 'claude', mode: 'argv', promptDelivery: 'draft', transport: 'argv', submits: false },
  {
    agent: 'gemini',
    mode: 'flag-prompt-interactive',
    promptDelivery: 'auto-submit',
    transport: 'host',
    submits: true
  },
  {
    agent: 'opencode',
    mode: 'flag-prompt',
    promptDelivery: 'auto-submit',
    transport: 'host',
    submits: true
  },
  {
    agent: 'copilot',
    mode: 'flag-interactive',
    promptDelivery: 'auto-submit',
    transport: 'host',
    submits: true
  },
  // Hermes's query rides its environment, never a command line; the host builds that too.
  {
    agent: 'hermes',
    mode: 'hermes-query',
    promptDelivery: 'auto-submit',
    transport: 'host',
    submits: true
  },
  // A followup-path agent cannot take a prompt on its command line at all, so the tab leaves it
  // unsent for the user.
  {
    agent: 'amp',
    mode: 'stdin-after-start',
    promptDelivery: 'auto-submit',
    transport: 'paste',
    submits: false
  },
  // A caller that asked for it submitted gets the host's paste once the agent runs.
  {
    agent: 'amp',
    mode: 'stdin-after-start',
    promptDelivery: 'submit-after-ready',
    transport: 'host',
    submits: true
  }
]

const cases = callerProfileCases()

async function launch(profile: AgentLaunchCallerProfile) {
  const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
  return launchAgentInNewTab({ requestId: 'request-1', ...profile.args })
}

describe('agent launch caller prompt transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetLaunchFunnelStore(store)
    mockPasteDraftWhenAgentReady.mockResolvedValue(true)
    callRuntimeRpc.mockResolvedValue(hostReceipt('handed-to-terminal'))
  })

  it.each(cases)(
    'carries the prompt %s sends on the transport its mode picks',
    async (_id, profile) => {
      const result = await launch(profile)

      if (profile.args.prompt === undefined) {
        expect(result?.pasteDraftAfterLaunch).toBe(false)
        expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
        expect(queuedStartupCommand(store)).not.toContain(PROMPT)
        return
      }
      if (launchesThroughHost(profile.args)) {
        expect(result?.pasteDraftAfterLaunch).toBe(false)
        expectHandedToHost(profile.args.promptDelivery, PROMPT)
        return
      }
      // Codex cannot prefill a draft, so the window pastes it once the agent is ready.
      expect(result?.pasteDraftAfterLaunch).toBe(true)
      expect(queuedStartupCommand(store)?.includes(PROMPT)).toBe(false)
    }
  )

  it.each(cases)(
    'exposes a delivery result to %s only for a prompt it waits to see submitted',
    async (_id, profile) => {
      const result = await launch(profile)

      // Why: call sites branch on this result being present. A draft launch must NOT get one,
      // because the composer owns the text until the user sends it; a submit-after-ready prompt the
      // launch command carries still waits on the agent's receipt before the caller acts.
      const waitsForSubmit =
        profile.args.prompt !== undefined && profile.args.promptDelivery === 'submit-after-ready'
      expect(result?.promptDeliveryResult !== undefined).toBe(waitsForSubmit)
    }
  )

  it.each(cases)('tells %s when its prompt was actually delivered', async (_id, profile) => {
    const onPromptDelivered = vi.fn()
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-2',
      ...profile.args,
      onPromptDelivered
    })
    await result?.promptDeliveryResult

    if (profile.args.prompt === undefined) {
      expect(onPromptDelivered).not.toHaveBeenCalled()
      return
    }
    await vi.waitFor(() => expect(onPromptDelivered).toHaveBeenCalledTimes(1))
  })

  it.each(
    TRANSPORT_TABLE.map(
      (row) => [`${row.agent} (${row.mode}) on ${row.promptDelivery}`, row] as const
    )
  )('delivers a prompt to %s the way its agent supports', async (_label, row) => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-3',
      agent: row.agent,
      worktreeId: 'wt-1',
      prompt: PROMPT,
      promptDelivery: row.promptDelivery
    })

    expect(result?.pasteDraftAfterLaunch).toBe(row.transport === 'paste')
    if (row.transport === 'host') {
      expect(row.submits).toBe(true)
      expectHandedToHost(row.promptDelivery === 'draft' ? undefined : row.promptDelivery, PROMPT)
      return
    }
    expect(queuedStartupCommand(store)?.includes(PROMPT)).toBe(row.transport === 'argv')
    if (row.transport === 'paste') {
      expect(mockPasteDraftWhenAgentReady.mock.calls[0]?.[0]).toMatchObject({
        content: PROMPT,
        submit: row.submits
      })
    } else {
      expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
    }
  })

  // Main pasted an AI button's prompt once the agent ran, whatever its size or host; the host's one
  // rule now picks the transport for that caller (confirmation `required`), and the window keeps
  // no copy of it: no line, launch file or unstageable-line wish of its own.
  it.each([
    ['a prompt past the argv ceiling', 'claude', 'x'.repeat(100_001), 'darwin'],
    ['a Windows prompt', 'gemini', 'say "hi"', 'win32'],
    ['a 9 KB multi-line Windows prompt', 'codex', `Fix the checks.\n${'x'.repeat(9_100)}`, 'win32'],
    ['a 20 KB POSIX prompt', 'codex', `Session context:\n${'w'.repeat(20_000)}`, 'darwin']
  ] as const)(
    'hands %s for %s to the host and waits for its proof',
    async (_label, agent, prompt, launchPlatform) => {
      const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

      const result = launchAgentInNewTab({
        requestId: 'prompt-carry-243',
        agent,
        worktreeId: 'wt-1',
        prompt,
        promptDelivery: 'submit-after-ready',
        launchPlatform
      })

      await expect(result?.promptDeliveryResult).resolves.toEqual({
        delivered: true,
        failureNotified: false
      })
      expectHandedToHost('submit-after-ready', prompt)
    }
  )

  it('mirrors an argv-carried draft into the chat composer', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-4',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: PROMPT,
      promptDelivery: 'draft'
    })

    // Why: the draft rode in on `--prefill`, so no paste runs and nothing else would seed chat.
    expect(store.seedNativeChatLaunchDraft).toHaveBeenCalledTimes(1)
    expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
  })

  it('refuses a whitespace-only prompt rather than launching a blank agent', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-5',
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: '   \n  ',
      promptDelivery: 'submit-after-ready'
    })

    expect(result?.pasteDraftAfterLaunch).toBe(false)
    expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
  })

  it('reports an undelivered submit-after-ready prompt without throwing at the caller', async () => {
    callRuntimeRpc.mockResolvedValue(hostReceipt('not-delivered'))
    const onPromptDelivered = vi.fn()
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    // Amp takes its text only after start, so it is the agent a submit-after-ready launch pastes into.
    const result = launchAgentInNewTab({
      requestId: 'request-6',
      agent: 'amp',
      worktreeId: 'wt-1',
      prompt: PROMPT,
      promptDelivery: 'submit-after-ready',
      onPromptDelivered
    })

    await expect(result?.promptDeliveryResult).resolves.toMatchObject({ delivered: false })
    expect(onPromptDelivered).not.toHaveBeenCalled()
  })
})
