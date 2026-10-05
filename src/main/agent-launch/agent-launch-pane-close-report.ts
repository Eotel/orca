import type { AgentLaunchPaneAddress } from '../../shared/agent-launch-pane-verdict'
import { makePaneKey } from '../../shared/stable-pane-id'
import { markAgentLaunchPaneClosedByUser } from './agent-launch-pane-attachment'

function isPaneAddress(value: unknown): value is AgentLaunchPaneAddress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'worktreeId' in value &&
    'tabId' in value &&
    'leafId' in value &&
    typeof value.worktreeId === 'string' &&
    typeof value.tabId === 'string' &&
    typeof value.leafId === 'string'
  )
}

/** The window's report that the user closed a launch's tab while it waited, so the launch stops. */
export function applyAgentLaunchPaneCloseReport(report: unknown): void {
  if (!isPaneAddress(report)) {
    return
  }
  try {
    markAgentLaunchPaneClosedByUser({
      worktreeId: report.worktreeId,
      paneKey: makePaneKey(report.tabId, report.leafId)
    })
  } catch {
    // A pane id this build cannot read is no launch's.
  }
}
