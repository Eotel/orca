/**
 * What became of a prompt an agent's launch command carried, on a host that can see the agent.
 *
 * A caller acts on this answer (an AI button resolves threads, posts replies, marks notes sent), so
 * it must never be a guess, nor come before main's paste did. Proof is the launched agent itself
 * (named on its command line, never any other process: a slow shell startup runs its own) in front
 * once it signals it is ready, which counts only with no startup dialog up; or the agent's own hook
 * turn, whichever comes first. The launched agent seen and then the shell back is an exit before it
 * read the prompt. Anything else within the budget is unconfirmed: the agent may still run it.
 */

import type { AgentLaunchPromptDisposal } from '../../../../shared/agent-launch-intent'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  waitForLaunchedAgentComposer,
  type LaunchedAgentReadinessRuntime
} from '../../launched-agent-composer-readiness'
import type { OrcaRuntimeService } from '../../orca-runtime'

type CarriedPromptProofRuntime = LaunchedAgentReadinessRuntime &
  Pick<
    OrcaRuntimeService,
    | 'observeTerminalLaunchTurnStart'
    | 'getTerminalPromptRequestBinding'
    | 'readTerminalForegroundVerdict'
  >

const RECEIVED: AgentLaunchPromptDisposal = { outcome: 'handed-to-terminal' }
const EXITED: AgentLaunchPromptDisposal = { outcome: 'not-delivered', reason: 'agent-exited' }
const UNCONFIRMED: AgentLaunchPromptDisposal = { outcome: 'unconfirmed' }

/** The budget the host's paste gives the agent to reach its composer. */
const PROOF_BUDGET_MS = 60_000
/** Each read is one process scan of the pane, so they start often and back off. */
const FIRST_READ_MS = 100
const MAX_READ_MS = 1_000

export async function proveCarriedTerminalAgentLaunchPrompt(args: {
  runtime: CarriedPromptProofRuntime
  handle: string
  agent: TuiAgent
  /** Taken before the spawn: only a hook turn after it proves this prompt. */
  launchStartedAt: number
  timeoutMs?: number
}): Promise<AgentLaunchPromptDisposal> {
  const timeoutMs = args.timeoutMs ?? PROOF_BUDGET_MS
  const stop = new AbortController()
  try {
    const hookTurn = (async () => {
      const verdict = await args.runtime.observeTerminalLaunchTurnStart(
        args.handle,
        { launchStartedAt: args.launchStartedAt, agent: args.agent },
        timeoutMs,
        stop.signal
      )
      return verdict === 'observed' || verdict === 'permission'
        ? RECEIVED
        : verdict === 'exited'
          ? EXITED
          : null
    })().catch(() => null)
    const launchedAgent = watchLaunchedAgent(args, timeoutMs, stop.signal).catch(() => null)
    // Bookkeeping never fails a launch whose agent runs: a read that cannot answer is unconfirmed.
    return (await firstAnswer([hookTurn, launchedAgent])) ?? UNCONFIRMED
  } finally {
    stop.abort()
  }
}

async function watchLaunchedAgent(
  args: { runtime: CarriedPromptProofRuntime; handle: string; agent: TuiAgent },
  timeoutMs: number,
  signal: AbortSignal
): Promise<AgentLaunchPromptDisposal | null> {
  const deadline = Date.now() + timeoutMs
  let ready = false
  // The same signal the host's paste waits for, which holds while a startup dialog is up.
  void (async () => {
    ready = (await waitForLaunchedAgentComposer(args.runtime, args.handle, args.agent, timeoutMs))
      .satisfied
  })().catch(() => {})
  let ptyId: string
  try {
    ptyId = args.runtime.getTerminalPromptRequestBinding(args.handle).ptyId
  } catch {
    return null
  }
  let launchedAgentSeen = false
  let interval = FIRST_READ_MS
  while (!signal.aborted && Date.now() < deadline) {
    const verdict = await args.runtime
      .readTerminalForegroundVerdict(ptyId, args.agent)
      .catch(() => 'unknown' as const)
    if (verdict === 'launched-agent') {
      launchedAgentSeen = true
      if (ready) {
        return RECEIVED
      }
    } else if (verdict === 'shell' && launchedAgentSeen) {
      return EXITED
    }
    // Once ready, the next read is the one that proves it, so it is taken at once.
    await abortableDelay(ready ? FIRST_READ_MS : interval, signal)
    interval = Math.min(interval * 2, MAX_READ_MS)
  }
  return null
}

/** The first answer that is not null, or null once every one has settled without one. */
function firstAnswer<T>(answers: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = answers.length
    for (const answer of answers) {
      void answer.then((value) => {
        pending -= 1
        if (value !== null) {
          resolve(value)
        } else if (pending === 0) {
          resolve(null)
        }
      })
    }
  })
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
