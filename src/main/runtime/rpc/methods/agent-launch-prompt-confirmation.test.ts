/**
 * `prompt.confirmation: 'required'`: a caller whose follow-up acts on the delivery result gets one
 * the host can prove. The prompt travels as main delivered such prompts (`once-agent-runs`: pasted
 * once the agent runs where nothing proves a carried one), and a carried prompt counts only once the
 * agent's turn proves it. Which transport the rule picks per host is pinned in
 * `shared/launch-prompt-carry.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import type { RpcContext } from '../core'
import {
  CAPABLE_CLIENT,
  methodNamed,
  rpcContext,
  runtimeStub,
  type AgentLaunchRuntimeStub
} from './agent-launch.test-fixture'

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const { settledAtCreation } = await import('../../../agent-launch/agent-launch-prompt-delivery')
const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')

const DESKTOP: Partial<RpcContext> = {
  clientKind: 'runtime',
  caller: DESKTOP_RPC_CALLER,
  clientCapabilities: [...DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES]
}
const EXISTING = { agent: 'claude', target: { kind: 'existing', worktree: 'id:wt-7' } }
const REQUIRED = { text: 'resolve these threads', delivery: 'submit', confirmation: 'required' }
const BEST_EFFORT = { text: 'resolve these threads', delivery: 'submit' }

type Verdict = 'observed' | 'permission' | 'unsupported' | 'unobserved' | 'exited'

function withHostEvidence(
  runtime: AgentLaunchRuntimeStub,
  evidence: { verdict?: Verdict; foreground?: 'agent' | 'shell' | 'unknown'; provesAgent?: boolean }
) {
  const observeTerminalLaunchTurnStart = vi.fn(
    async (_handle: string, _launch: { launchStartedAt: number; agent: string }) =>
      evidence.verdict ?? 'observed'
  )
  const sendTerminalAgentPrompt = vi.fn(
    async (
      _handle: string,
      _text: string,
      options: { beforeWrite?: (ptyId: string) => Promise<void> }
    ) => {
      await options.beforeWrite?.('pty-1')
      return { handle: 'term_1', accepted: true, bytesWritten: 1 }
    }
  )
  return {
    runtime: Object.assign(runtime, {
      observeTerminalLaunchTurnStart,
      sendTerminalAgentPrompt,
      waitForTerminal: vi.fn(async () => ({ satisfied: true, status: 'idle' })),
      waitForFreshWorkerComposer: vi.fn(async () => ({ satisfied: true, status: 'ready' })),
      readLaunchedAgentForeground: vi.fn(async () => evidence.foreground ?? 'agent'),
      launchedAgentHostProvesAgent: vi.fn(() => evidence.provesAgent ?? true),
      subscribeToTerminalData: vi.fn(() => () => {})
    }),
    observeTerminalLaunchTurnStart,
    sendTerminalAgentPrompt
  }
}

async function launch(params: unknown, runtime: AgentLaunchRuntimeStub, context = DESKTOP) {
  const parsed = AGENT_LAUNCH.params.safeParse(params)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid')
  }
  return AGENT_LAUNCH.handler(parsed.data, rpcContext(runtime, context))
}

describe('a launch prompt whose caller acts on the result', () => {
  it('asks the startup plan for main’s paste once the agent runs', async () => {
    const { runtime } = withHostEvidence(runtimeStub({ settings: {} }), {})

    await launch({ ...EXISTING, prompt: REQUIRED }, runtime)

    expect(runtime.createTerminal.mock.calls[0]?.[1]).toMatchObject({
      startupPrompt: REQUIRED.text,
      startupPromptPaste: 'once-agent-runs'
    })
  })

  it.each<[Verdict, unknown]>([
    ['observed', { delivery: 'submit', outcome: 'handed-to-terminal' }],
    ['permission', { delivery: 'submit', outcome: 'handed-to-terminal' }],
    ['unsupported', { delivery: 'submit', outcome: 'handed-to-terminal' }],
    ['exited', { delivery: 'submit', outcome: 'not-delivered', reason: 'agent-exited' }],
    ['unobserved', { delivery: 'submit', outcome: 'unconfirmed' }]
  ])('reports a carried prompt by the agent’s own turn: %s', async (verdict, receipt) => {
    const { runtime, observeTerminalLaunchTurnStart } = withHostEvidence(
      runtimeStub({ settings: {} }),
      { verdict }
    )
    const before = Date.now()

    const result = await launch({ ...EXISTING, prompt: REQUIRED }, runtime)

    expect(result.prompt).toEqual(receipt)
    const launchArgs = observeTerminalLaunchTurnStart.mock.calls[0]![1]
    // Only a turn after the terminal was asked for proves this prompt.
    expect(launchArgs.agent).toBe('claude')
    expect(launchArgs.launchStartedAt).toBeGreaterThanOrEqual(before)
  })

  it('pastes where the host cannot prove the agent, refused only by a shell in front', async () => {
    const { runtime, sendTerminalAgentPrompt } = withHostEvidence(
      runtimeStub({ settings: {}, lineCarriesPrompt: false }),
      { foreground: 'unknown', provesAgent: false }
    )

    const result = await launch({ ...EXISTING, prompt: REQUIRED }, runtime)

    expect(sendTerminalAgentPrompt).toHaveBeenCalledWith('term_1', REQUIRED.text, expect.anything())
    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
  })

  it('never pastes into a shell proven in front, so the follow-up never runs', async () => {
    const { runtime } = withHostEvidence(runtimeStub({ settings: {}, lineCarriesPrompt: false }), {
      foreground: 'shell',
      provesAgent: false
    })

    const result = await launch({ ...EXISTING, prompt: REQUIRED }, runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'not-delivered' })
  })
})

describe('a launch prompt whose caller only reads the result', () => {
  it('rides the line as handed over, with no proof wait and the guarded paste', async () => {
    const { runtime, observeTerminalLaunchTurnStart } = withHostEvidence(
      runtimeStub({ settings: {} }),
      {}
    )

    const result = await launch({ ...EXISTING, prompt: BEST_EFFORT }, runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
    expect(runtime.createTerminal.mock.calls[0]?.[1]).not.toHaveProperty('startupPromptPaste')
    expect(observeTerminalLaunchTurnStart).not.toHaveBeenCalled()
  })

  it('keeps the guarded paste off a host that cannot prove the agent', async () => {
    const { runtime } = withHostEvidence(runtimeStub({ settings: {}, lineCarriesPrompt: false }), {
      foreground: 'unknown',
      provesAgent: false
    })

    const result = await launch({ ...EXISTING, prompt: BEST_EFFORT }, runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'not-delivered' })
  })

  it('treats `required` from a caller that cannot read `unconfirmed` as best-effort', async () => {
    const { runtime, observeTerminalLaunchTurnStart } = withHostEvidence(
      runtimeStub({ settings: {} }),
      { verdict: 'unobserved' }
    )

    const result = await launch({ ...EXISTING, prompt: REQUIRED }, runtime, CAPABLE_CLIENT)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
    expect(runtime.createTerminal.mock.calls[0]?.[1]).not.toHaveProperty('startupPromptPaste')
    expect(observeTerminalLaunchTurnStart).not.toHaveBeenCalled()
  })
})

describe('what the launch record says before the proof comes back', () => {
  it('records a carried prompt a caller acts on as unconfirmed, never as handed over', () => {
    const carried = { promptRodeLaunchCommand: true }
    // A host that stops mid-proof must not replay "delivered" to a caller that acts on it.
    expect(settledAtCreation({ prompt: { ...REQUIRED, delivery: 'submit' } }, carried)).toEqual({
      outcome: 'unconfirmed'
    })
    expect(settledAtCreation({ prompt: { ...BEST_EFFORT, delivery: 'submit' } }, carried)).toEqual({
      outcome: 'handed-to-terminal'
    })
  })
})
