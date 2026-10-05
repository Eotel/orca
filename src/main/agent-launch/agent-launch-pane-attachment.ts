/**
 * What a pane may do when an `agent.launch` showed it before its agent existed.
 *
 * Derived on every spawn. While the launch's fate is open, the launch record (the operation ledger)
 * names the launch that owns the pane and how it ended; the runtime, and the pane's persisted
 * binding, say whether a process holds it. Once the fate is final for the pane, the tab itself keeps
 * it (`agentLaunchPane.outcome`) for the tab's life, so the pane no longer reads the record. The one
 * in-memory fact is a launch still running in this process, which dies with that launch.
 */

import {
  listAgentSessionOperationRowsOwningPane,
  type AgentSessionOperationOwnedPane,
  type AgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import { isAgentLaunchResult } from '../../shared/agent-launch-intent'
import type {
  AgentLaunchPaneOutcome,
  AgentLaunchPaneVerdict
} from '../../shared/agent-launch-pane-verdict'

type RunningLaunch = { finished: Promise<{ tabTakenBack: boolean }> }

const runningLaunchesByPane = new Map<string, RunningLaunch>()

function paneKeyOf(pane: AgentSessionOperationOwnedPane): string {
  return JSON.stringify([pane.worktreeId, pane.paneKey])
}

export type RunningAgentLaunchPane = {
  /** The launch is over; its record says how. `tabTakenBack`: the host is closing the tab. */
  finish(outcome: { tabTakenBack: boolean }): void
}

/** Registered before the window hears of the tab, so a pane that mounts at once already waits. */
export function trackRunningAgentLaunchPane(
  pane: AgentSessionOperationOwnedPane
): RunningAgentLaunchPane {
  const key = paneKeyOf(pane)
  let resolve!: (outcome: { tabTakenBack: boolean }) => void
  const running: RunningLaunch = {
    finished: new Promise((done) => {
      resolve = done
    })
  }
  runningLaunchesByPane.set(key, running)
  let finished = false
  return {
    finish: (outcome) => {
      if (finished) {
        return
      }
      finished = true
      if (runningLaunchesByPane.get(key) === running) {
        runningLaunchesByPane.delete(key)
      }
      resolve(outcome)
    }
  }
}

function launchRanInPane(row: AgentSessionOperationRow, paneKey: string): boolean {
  if (row.outcome.status !== 'succeeded' || !isAgentLaunchResult(row.outcome.launch)) {
    return false
  }
  const { outcome } = row.outcome.launch
  return outcome.kind === 'terminal' && outcome.paneKey === paneKey
}

/** The pane's fate as the record tells it. Exported for the record-only cases a test pins. */
export function agentLaunchPaneVerdictFromRecord(
  owning: readonly AgentSessionOperationRow[],
  paneKey: string
): AgentLaunchPaneVerdict {
  if (owning.length === 0 || owning.some((row) => launchRanInPane(row, paneKey))) {
    // Nothing owns it, or an agent ran here and is gone: the pane is an ordinary terminal again.
    return { kind: 'proceed' }
  }
  const latest = owning.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a))
  switch (latest.outcome.status) {
    case 'failed':
      return { kind: 'not-started', code: latest.outcome.code }
    case 'succeeded':
      // A chat, or another pane: nothing ran here.
      return { kind: 'withdrawn' }
    case 'unknown':
    case 'pending':
      return { kind: 'unconfirmed' }
  }
}

export type AgentLaunchPaneEvidence = {
  /** A process holds the pane, live or by its persisted binding: the spawn adopts it, whatever the
   *  record says. */
  isPaneLive(paneKey: string): boolean
  /** The record's rows when the store is already open; null when it is not. */
  openedRows(): Iterable<AgentSessionOperationRow> | null
  /** What the pane's tab keeps about its launch: null when no launch laid it out, no outcome while
   *  the fate is open, the outcome once it is final. */
  launchPaneOnTab(): { outcome?: AgentLaunchPaneOutcome } | null
  openRows(): Promise<Iterable<AgentSessionOperationRow>>
  now(): number
}

async function settleVerdict(
  pane: AgentSessionOperationOwnedPane,
  evidence: AgentLaunchPaneEvidence
): Promise<AgentLaunchPaneVerdict> {
  for (;;) {
    const running = runningLaunchesByPane.get(paneKeyOf(pane))
    if (!running) {
      break
    }
    if ((await running.finished).tabTakenBack) {
      return { kind: 'withdrawn' }
    }
  }
  if (evidence.isPaneLive(pane.paneKey)) {
    return { kind: 'proceed' }
  }
  const final = evidence.launchPaneOnTab()?.outcome
  if (final) {
    return final
  }
  // Bookkeeping never gates the user: a record that cannot be read leaves an ordinary terminal.
  const rows = evidence.openedRows() ?? (await evidence.openRows().catch(() => null))
  return rows
    ? agentLaunchPaneVerdictFromRecord(
        listAgentSessionOperationRowsOwningPane(rows, pane, evidence.now()),
        pane.paneKey
      )
    : { kind: 'proceed' }
}

/**
 * Null when nothing can own the pane — no launch running for it, its tab keeping nothing about a
 * launch, and no record row naming it — so every other spawn keeps its timing and reads nothing.
 * Otherwise the verdict, once any running launch is over.
 */
export function resolveAgentLaunchPaneVerdict(
  pane: AgentSessionOperationOwnedPane,
  evidence: AgentLaunchPaneEvidence
): Promise<AgentLaunchPaneVerdict> | null {
  if (!runningLaunchesByPane.has(paneKeyOf(pane)) && evidence.launchPaneOnTab() === null) {
    const rows = evidence.openedRows()
    if (!rows || listAgentSessionOperationRowsOwningPane(rows, pane, evidence.now()).length === 0) {
      return null
    }
  }
  return settleVerdict(pane, evidence)
}

export function resetAgentLaunchPanesForTests(): void {
  runningLaunchesByPane.clear()
}
