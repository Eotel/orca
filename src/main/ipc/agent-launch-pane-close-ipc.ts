import { ipcMain } from 'electron'
import type { AgentLaunchPaneAddress } from '../../shared/agent-launch-pane-verdict'
import { makePaneKey } from '../../shared/stable-pane-id'
import { markAgentLaunchPaneClosedByUser } from '../agent-launch/agent-launch-pane-attachment'

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

/** The window reports the user closing a launch's tab while it waited, so the launch stops. */
export function registerAgentLaunchPaneCloseIpc(): void {
  ipcMain.removeAllListeners('agentLaunch:paneClosed')
  ipcMain.on('agentLaunch:paneClosed', (_event, pane: unknown) => {
    if (!isPaneAddress(pane)) {
      return
    }
    try {
      markAgentLaunchPaneClosedByUser({
        worktreeId: pane.worktreeId,
        paneKey: makePaneKey(pane.tabId, pane.leafId)
      })
    } catch {
      // A pane id this build cannot read is no launch's.
    }
  })
}
