/**
 * The tab of an `agent.launch`, shown before the launch is admitted.
 *
 * Admission, workspace resolution, the mode decision and the daemon spawn each have a cold cost (a
 * Windows window still booting its first PowerShell measured ~0.55 s and ~1 s), and the tab used to
 * wait for all of them. It now waits for none: the host asks the window for the tab first, under ids
 * the spawn will bake into the agent's PTY, and the pane attaches to that process when it exists.
 *
 * Best-effort by construction. Anything this cannot decide cheaply — a workspace it cannot resolve,
 * a chat-mode default, no window owning the layout — skips the early tab, and the launch's tab
 * appears when it spawns, exactly as before. Placement and presentation never fail a launch.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentLaunchPlacementReceipt,
  AgentLaunchResult
} from '../../../../shared/agent-launch-intent'
import { AGENT_LAUNCH_PLACEMENT_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import type { AgentLaunchTabViewerRule } from '../../../../shared/agent-launch-tab-publication'
import { makePaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import { workspaceKindForWorktreeId } from '../../../../shared/workspace-launch-kind'
import {
  claimAgentLaunchPane,
  type AgentLaunchOwnedPane
} from '../../../agent-launch/agent-launch-pane-attachment'
import {
  decideAgentLaunchMode,
  readAgentLaunchModeSettings
} from '../../../agent-launch/agent-launch-mode'
import { deriveAgentLaunchTerminalViewMode } from '../../../agent-launch/agent-launch-view-mode'
import type { RpcContext } from '../core'
import type { AgentLaunchParams } from './agent-launch-schemas'

/**
 * Whose screen moves, from who called: the split browser tabs already use between the host's view
 * and a caller's own. A paired device moves only its own selection, never the host window.
 */
export function agentLaunchTabViewerRule(
  caller: RpcContext['caller'],
  presentation: AgentLaunchParams['presentation']
): AgentLaunchTabViewerRule {
  if (presentation === 'background') {
    return 'none'
  }
  switch (caller?.kind) {
    case 'paired-device':
      return 'none'
    case 'desktop':
      return 'focus-in-workspace'
    case 'local-cli':
      return presentation === 'focused' ? 'focus-window' : 'reveal-owner'
    case undefined:
      return 'reveal-owner'
  }
}

/**
 * A paired caller that does not advertise the capability reads "my reserved tab is listed" as proof
 * its agent started; a tab listed before the spawn would make a lost reply read as a started agent.
 */
function readsEarlyLaunchTab(context: Pick<RpcContext, 'caller' | 'clientCapabilities'>): boolean {
  return (
    context.caller?.kind !== 'paired-device' ||
    context.clientCapabilities?.includes(AGENT_LAUNCH_PLACEMENT_RUNTIME_CAPABILITY) === true
  )
}

export type EarlyAgentLaunchTab = {
  /** The pane the launch must create: the caller's, or one minted here. */
  paneKey: string
  /** The surface exists; a terminal on this pane lets the waiting pane attach. */
  surfacePublished(result: AgentLaunchResult): void
  /** The launch threw; the pane shows why instead of starting a shell. */
  failed(error: unknown): void
  /** The launch is over, however it ended; a tab nothing launched into is taken back. */
  finish(): void
  /** Where the window placed the tab, once it has said. */
  placement(): AgentLaunchPlacementReceipt | undefined
}

/** The view half of a launch: the tab shown before it ran, and whether the caller's view moves. */
export type AgentLaunchView = {
  early: EarlyAgentLaunchTab | null
  presentation: AgentLaunchParams['presentation']
}

export function withPlacement(result: AgentLaunchResult, view: AgentLaunchView): AgentLaunchResult {
  const placement = view.early?.placement()
  return placement ? { ...result, placement } : result
}

/** Never throws: the early tab is a view, and a launch must not fail over one. */
export function publishEarlyTab(
  params: AgentLaunchParams,
  context: RpcContext
): Promise<EarlyAgentLaunchTab | null> {
  return publishAgentLaunchTabEarly(params, context).catch((error: unknown) => {
    console.warn('[agent-launch] could not show the launch tab early', error)
    return null
  })
}

export async function publishAgentLaunchTabEarly(
  params: AgentLaunchParams,
  context: RpcContext
): Promise<EarlyAgentLaunchTab | null> {
  const runtime = context.runtime
  if (
    params.target.kind !== 'existing' ||
    params.reuseTerminal ||
    !readsEarlyLaunchTab(context) ||
    !runtime.canPublishAgentLaunchTab()
  ) {
    return null
  }
  let workspace: Awaited<ReturnType<typeof runtime.showTerminalWorkspaceLaunchScope>>
  try {
    workspace = await runtime.showTerminalWorkspaceLaunchScope(params.target.worktree)
  } catch {
    // The launch resolves it again after admission and answers for it there.
    return null
  }
  const settings = readAgentLaunchModeSettings(runtime)
  const preflight = decideAgentLaunchMode({
    placement: {
      agent: params.agent,
      workspaceKind: workspaceKindForWorktreeId(workspace.id),
      workspacePath: workspace.path,
      ...(params.cwd ? { cwd: params.cwd } : {})
    },
    settings
  })
  // A chat's tab is the session's; it appears when the session is created.
  if (preflight.mode !== 'terminal') {
    return null
  }
  const paneKey = params.paneKey ?? makePaneKey(randomUUID(), randomUUID())
  const pane = parsePaneKey(paneKey)
  if (!pane) {
    return null
  }
  // Claimed before the window hears of the tab, so a pane that mounts at once already waits.
  const owned = claimAgentLaunchPane(workspace.id, paneKey)
  let publishing: ReturnType<typeof runtime.publishAgentLaunchTab>
  try {
    publishing = runtime.publishAgentLaunchTab({
      worktreeId: workspace.id,
      tabId: pane.tabId,
      leafId: pane.leafId,
      launchAgent: params.agent,
      viewMode: deriveAgentLaunchTerminalViewMode({
        settings,
        agent: params.agent,
        ...(params.prompt ? { prompt: params.prompt } : {}),
        connectionId: workspace.connectionId
      }),
      ...(params.placement ? { placement: params.placement } : {}),
      viewer: agentLaunchTabViewerRule(context.caller, params.presentation)
    })
  } catch (error) {
    owned.withdraw()
    throw error
  }
  if (!publishing) {
    owned.withdraw()
    return null
  }
  return trackEarlyAgentLaunchTab(owned, paneKey, publishing, (tabId) =>
    runtime.withdrawAgentLaunchTab(tabId)
  )
}

function trackEarlyAgentLaunchTab(
  owned: AgentLaunchOwnedPane,
  paneKey: string,
  publishing: Promise<{ tabId: string; created: boolean; placement: AgentLaunchPlacementReceipt }>,
  closeTab: (tabId: string) => void
): EarlyAgentLaunchTab {
  let placement: AgentLaunchPlacementReceipt | undefined
  let ranHere = false
  const published = publishing.then(
    (reply) => {
      placement = reply.placement
      return reply
    },
    (error: unknown) => {
      // The tab did not appear; the launch still runs and its tab appears when it spawns.
      console.warn('[agent-launch] the window did not show the launch tab early', error)
      return null
    }
  )
  return {
    paneKey,
    surfacePublished: (result) => {
      if (result.outcome.kind === 'terminal' && result.outcome.paneKey === paneKey) {
        ranHere = true
        owned.launched()
      }
    },
    failed: (error) => {
      // A failed launch keeps its tab so its pane can say why.
      ranHere = true
      owned.failed(error instanceof Error ? error.message : String(error))
    },
    finish: () => {
      owned.withdraw()
      if (ranHere) {
        return
      }
      // Only a tab this request created goes; a retry's tab belongs to the attempt that made it.
      void published.then((reply) => {
        if (reply?.created) {
          closeTab(reply.tabId)
        }
      })
    },
    placement: () => placement
  }
}
