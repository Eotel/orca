/**
 * Panes whose process belongs to an `agent.launch` that has not spawned it yet.
 *
 * The launch publishes its tab before it admits the request, so the window can mount the pane while
 * the host is still deciding and spawning. That pane's own `pty:spawn` must wait for the host's
 * process and attach to it, and must never fall back to a plain shell: a failed launch shows its
 * failure in the pane instead. The marker is in memory only; it dies with the process, and failures
 * are capped so a pane that never mounts cannot hold one forever.
 */

import { formatAgentLaunchPaneFailure } from '../../shared/agent-launch-pane-failure'

type Settlement = { kind: 'launched' } | { kind: 'failed'; message: string } | { kind: 'withdrawn' }

type PendingEntry = {
  state: 'pending'
  settled: Promise<Settlement>
}
type FailedEntry = { state: 'failed'; message: string }
type Entry = PendingEntry | FailedEntry

/** Enough for every launch a session plausibly fails without its pane ever mounting. */
export const MAX_REMEMBERED_AGENT_LAUNCH_PANE_FAILURES = 64

const entriesByKey = new Map<string, Entry>()

function paneOwnerKey(worktreeId: string, paneKey: string): string {
  return JSON.stringify([worktreeId, paneKey])
}

function rememberFailure(key: string, entry: FailedEntry): void {
  entriesByKey.delete(key)
  entriesByKey.set(key, entry)
  const failed = [...entriesByKey].filter(([, candidate]) => candidate.state === 'failed')
  for (const [oldKey] of failed.slice(0, -MAX_REMEMBERED_AGENT_LAUNCH_PANE_FAILURES)) {
    entriesByKey.delete(oldKey)
  }
}

export type AgentLaunchOwnedPane = {
  /** The host's PTY is bound to the pane; a waiting pane attaches to it. */
  launched(): void
  /** The launch failed; the pane shows `reason`, now or whenever it mounts. */
  failed(reason: string): void
  /** The launch did not run into this pane (a replay, a refusal, another surface). */
  withdraw(): void
}

/** Claims the pane before the window can mount it. Only the first settlement counts. */
export function claimAgentLaunchPane(worktreeId: string, paneKey: string): AgentLaunchOwnedPane {
  const key = paneOwnerKey(worktreeId, paneKey)
  const previous = entriesByKey.get(key)
  let resolve!: (settlement: Settlement) => void
  const entry: PendingEntry = {
    state: 'pending',
    settled: new Promise<Settlement>((done) => {
      resolve = done
    })
  }
  entriesByKey.set(key, entry)
  let done = false
  const settle = (settlement: Settlement, next: Entry | undefined): void => {
    if (done) {
      return
    }
    done = true
    if (entriesByKey.get(key) === entry) {
      if (next?.state === 'failed') {
        rememberFailure(key, next)
      } else if (next) {
        entriesByKey.set(key, next)
      } else {
        entriesByKey.delete(key)
      }
    }
    resolve(settlement)
  }
  return {
    launched: () => settle({ kind: 'launched' }, undefined),
    failed: (reason) => {
      const message = formatAgentLaunchPaneFailure(reason)
      settle({ kind: 'failed', message }, { state: 'failed', message })
    },
    // An earlier attempt's failure on this pane still stands; this attempt never touched it.
    withdraw: () =>
      previous?.state === 'failed'
        ? settle({ kind: 'failed', message: previous.message }, previous)
        : settle({ kind: 'withdrawn' }, previous)
  }
}

/**
 * Called by a pane's own spawn before it reserves anything. Null when no launch owns the pane, so
 * every other spawn keeps its timing; otherwise resolves once the pane may proceed (the host's
 * process is bound) and rejects with the launch's failure instead of letting the spawn start a shell.
 */
export function awaitAgentLaunchPaneAttachment(
  worktreeId: string | undefined,
  paneKey: string | null
): Promise<void> | null {
  const entry = worktreeId && paneKey ? entriesByKey.get(paneOwnerKey(worktreeId, paneKey)) : null
  if (!entry) {
    return null
  }
  if (entry.state === 'failed') {
    return Promise.reject(new Error(entry.message))
  }
  return entry.settled.then((settlement) => {
    if (settlement.kind === 'failed') {
      throw new Error(settlement.message)
    }
  })
}

export function resetAgentLaunchPanesForTests(): void {
  entriesByKey.clear()
}
