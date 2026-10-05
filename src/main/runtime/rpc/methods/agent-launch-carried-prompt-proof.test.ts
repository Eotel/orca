import { describe, expect, it, vi } from 'vitest'
import type { TerminalForegroundVerdict } from '../../terminal-foreground-group'
import { proveCarriedTerminalAgentLaunchPrompt } from './agent-launch-carried-prompt-proof'

type Verdict = TerminalForegroundVerdict

/**
 * A pane whose foreground reads come from `foreground(ms since start)`, and whose readiness signal
 * fires at `readyAt` (never when null; `blocked` reports a startup dialog instead).
 */
function pane(args: {
  foreground: (elapsedMs: number) => Verdict
  readyAt: number | null
  blocked?: boolean
  hookTurn?: 'observed' | 'unobserved'
}) {
  const startedAt = Date.now()
  const wait = (timeoutMs: number) =>
    new Promise<{ satisfied: boolean; status: string; blockedReason?: string }>((resolve) => {
      if (args.blocked) {
        setTimeout(
          () => resolve({ satisfied: false, status: 'blocked', blockedReason: 'trust' }),
          timeoutMs
        )
      } else if (args.readyAt !== null) {
        setTimeout(() => resolve({ satisfied: true, status: 'ready' }), args.readyAt)
      }
    })
  return {
    waitForTerminal: vi.fn((_handle: string, options: { timeoutMs: number }) =>
      wait(options.timeoutMs)
    ),
    waitForFreshWorkerComposer: vi.fn((_handle: string, _agent: string, timeoutMs: number) =>
      wait(timeoutMs)
    ),
    observeTerminalLaunchTurnStart: vi.fn(
      (_handle: string, _launch: unknown, timeoutMs: number, signal?: AbortSignal) =>
        new Promise<'observed' | 'unobserved'>((resolve) => {
          if (args.hookTurn === 'observed') {
            resolve('observed')
            return
          }
          const timer = setTimeout(() => resolve('unobserved'), timeoutMs)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve('unobserved')
          })
        })
    ),
    getTerminalPromptRequestBinding: vi.fn(() => ({
      ptyId: 'pty-1',
      processIncarnation: 'i',
      generation: 1
    })),
    readTerminalForegroundVerdict: vi.fn(async () => args.foreground(Date.now() - startedAt))
  }
}

function prove(runtime: ReturnType<typeof pane>, timeoutMs = 800) {
  return proveCarriedTerminalAgentLaunchPrompt({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub implements every runtime method the proof calls; the rest of the runtime is never reached.
    runtime: runtime as unknown as Parameters<
      typeof proveCarriedTerminalAgentLaunchPrompt
    >[0]['runtime'],
    handle: 'term_1',
    agent: 'claude',
    launchStartedAt: Date.now(),
    timeoutMs
  })
}

describe('proving a prompt the launch command carried', () => {
  it('counts the launched agent once it signals ready, not before, and close behind it', async () => {
    const started = Date.now()
    const result = await prove(pane({ foreground: () => 'launched-agent', readyAt: 300 }), 2_000)
    const elapsed = Date.now() - started
    expect(result).toEqual({ outcome: 'handed-to-terminal' })
    // Not before the agent is ready, and within one prompt read after it (main pasted ~1.6 s later).
    expect(elapsed).toBeGreaterThanOrEqual(290)
    expect(elapsed).toBeLessThan(300 + 400)
  })

  // Why: a slow shell startup runs its own commands in front; none of them is the agent.
  it('never counts another process in front, ready signal or not', async () => {
    await expect(prove(pane({ foreground: () => 'other', readyAt: 50 }))).resolves.toEqual({
      outcome: 'unconfirmed'
    })
  })

  // Why: a trust or update dialog can draw after the first read; declined, the agent never reads it.
  it('never counts an agent held by a startup dialog', async () => {
    await expect(
      prove(pane({ foreground: () => 'launched-agent', readyAt: null, blocked: true }))
    ).resolves.toEqual({ outcome: 'unconfirmed' })
  })

  it('calls it an exit when the launched agent was seen and the shell came back', async () => {
    const result = await prove(
      pane({ foreground: (ms) => (ms < 150 ? 'launched-agent' : 'shell'), readyAt: null })
    )
    expect(result).toEqual({ outcome: 'not-delivered', reason: 'agent-exited' })
  })

  it('reads a shell in front before the agent ran as not yet started, never as an exit', async () => {
    await expect(prove(pane({ foreground: () => 'shell', readyAt: null }), 400)).resolves.toEqual({
      outcome: 'unconfirmed'
    })
  })

  it("takes the agent's own hook turn as proof, whatever holds the terminal", async () => {
    await expect(
      prove(pane({ foreground: () => 'other', readyAt: null, hookTurn: 'observed' }))
    ).resolves.toEqual({ outcome: 'handed-to-terminal' })
  })

  // Why: bookkeeping never fails a launch whose agent already runs.
  it('reads a host that cannot answer as unconfirmed, never as a failed launch', async () => {
    const broken = pane({ foreground: () => 'launched-agent', readyAt: 0 })
    broken.observeTerminalLaunchTurnStart.mockImplementation(() => {
      throw new Error('terminal_not_writable')
    })
    broken.getTerminalPromptRequestBinding.mockImplementation(() => {
      throw new Error('terminal_not_writable')
    })
    await expect(prove(broken)).resolves.toEqual({ outcome: 'unconfirmed' })
  })
})
