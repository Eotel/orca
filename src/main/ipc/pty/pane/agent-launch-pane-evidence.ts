import { toSshExecutionHostId } from '../../../../shared/execution-host'
import type { AgentLaunchPaneEvidence } from '../../../agent-launch/agent-launch-pane-attachment'
import type { Store } from '../../../persistence'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'

/** Reading the record is bookkeeping: a read that fails must leave the spawn as it was, never stop it. */
function orElse<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** What a pane's spawn reads to learn whether an agent launch owns it. */
export function agentLaunchPaneEvidence(
  deps: { runtime?: OrcaRuntimeService; store?: Store },
  pane: { worktreeId: string; tabId: string; leafId: string; connectionId?: string | null }
): AgentLaunchPaneEvidence {
  const { runtime, store } = deps
  return {
    isPaneLive: (paneKey) =>
      orElse(() => runtime?.hasLiveTerminalForPaneKey(paneKey) ?? false, false),
    openedRows: () =>
      orElse(() => runtime?.openedAgentSessionRecordStore()?.listOperationRows() ?? null, null),
    paneWasLaidOutByLaunch: () =>
      orElse(() => {
        if (!store || typeof store.getWorkspaceSession !== 'function') {
          return false
        }
        const session = store.getWorkspaceSession(
          pane.connectionId ? toSshExecutionHostId(pane.connectionId) : undefined
        )
        const tab = session.tabsByWorktree?.[pane.worktreeId]?.find(
          (candidate) => candidate.id === pane.tabId
        )
        return tab?.agentLaunchLeafId === pane.leafId
      }, false),
    openRows: async () => {
      if (!runtime) {
        throw new Error('runtime_unavailable')
      }
      return (await runtime.openAgentSessionRecordStore()).listOperationRows()
    },
    now: () => Date.now()
  }
}
