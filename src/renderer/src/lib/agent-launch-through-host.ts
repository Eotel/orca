/**
 * A desktop launch with a prompt, started through the host's `agent.launch`.
 *
 * This window owns the workspace's tab layout, so it makes the agent's tab at the click, in the
 * split it was asked for, as any new agent tab is made. Everything else is the host's: it records
 * the launch under this click's operation id, starts the agent into that tab's pane, and delivers
 * the prompt by its one rule. The pane's spawn waits until the host has taken it
 * (`agent-launch-pane-spawn-hold`), then attaches to the agent or says why it could not start.
 */

import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { persistAgentLaunchTabOrder } from '@/lib/launch-agent-tab-order'
import { rememberAgentLaunchPanePrompt } from '@/lib/agent-launch-pane-prompt'
import {
  holdAgentLaunchPaneSpawn,
  isAgentLaunchPaneSpawnHeld
} from '@/lib/agent-launch-pane-spawn-hold'
import { seedNativeChatAppliedSessionOptions } from '@/components/native-chat/native-chat-session-option-cache'
import { callRuntimeRpc, RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'
import { createAgentSessionOperationId } from '@/runtime/agent-session-operation-id'
import { isAgentLaunchResult, type AgentLaunchResult } from '../../../shared/agent-launch-intent'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { Tab } from '../../../shared/tab-types'

export type HostAgentLaunchArgs = {
  agent: TuiAgent
  worktreeId: string
  /** The split the launch was made from; the tab joins it. */
  groupId?: string
  /** Already trimmed and non-empty. */
  prompt: string
  /** Absent uses the settings default; `null` means no arguments. */
  agentArgs?: string | null
  cwd?: string
  sessionOptions?: Readonly<Record<string, string>>
  launchSource?: LaunchSource
  quickCommandLabel?: string | null
  /** The view the tab opens in, decided as for any new agent tab. */
  viewMode?: Tab['viewMode']
}

/** What became of the prompt. `failureNotified`: the user was already told, by the pane or a notice. */
export type HostAgentLaunchDelivery = {
  delivered: boolean
  failureNotified: boolean
  /** Why it was not delivered, for the caller's own notice. */
  reason?: 'not-delivered' | 'unconfirmed' | 'not-started'
}

/** Refused at admission: nothing ran under this click, and the host takes back the tab it was shown. */
const ADMISSION_REFUSAL_CODES = new Set([
  'agent_session_operation_invalid',
  'agent_session_operation_conflict',
  'agent_session_operation_expired',
  'agent_session_operation_capacity'
])

function tabExists(worktreeId: string, tabId: string): boolean {
  return (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
}

function closeLaunchTab(worktreeId: string, tabId: string): void {
  if (tabExists(worktreeId, tabId)) {
    useAppStore.getState().closeTab(tabId, { recordInteraction: false })
  }
}

function deliveryFromResult(result: AgentLaunchResult): HostAgentLaunchDelivery {
  switch (result.prompt?.outcome) {
    case 'handed-to-terminal':
    case 'journaled':
      return { delivered: true, failureNotified: false }
    case 'unconfirmed':
      return { delivered: false, failureNotified: false, reason: 'unconfirmed' }
    default:
      // A missing receipt under-claims: the caller keeps the text.
      return { delivered: false, failureNotified: false, reason: 'not-delivered' }
  }
}

function launchParams(args: HostAgentLaunchArgs) {
  return {
    agent: args.agent,
    target: { kind: 'existing', worktree: `id:${args.worktreeId}` },
    prompt: { text: args.prompt, delivery: 'submit' },
    ...(args.agentArgs !== undefined ? { agentArgs: args.agentArgs } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.sessionOptions ? { sessionOptions: args.sessionOptions } : {}),
    ...(args.launchSource ? { launchSource: args.launchSource } : {}),
    ...(args.groupId ? { placement: { groupId: args.groupId } } : {}),
    presentation: 'focused'
  }
}

/**
 * The ledger is bookkeeping: a desktop past its per-caller row cap still gets its agent, through the
 * host's unrecorded launch, which shows its own tab when the agent spawns.
 */
async function launchWithoutRecord(args: HostAgentLaunchArgs): Promise<HostAgentLaunchDelivery> {
  try {
    const result = await callRuntimeRpc<unknown>(
      { kind: 'local' },
      'agent.launch',
      launchParams(args)
    )
    return isAgentLaunchResult(result)
      ? deliveryFromResult(result)
      : { delivered: false, failureNotified: false, reason: 'unconfirmed' }
  } catch {
    return { delivered: false, failureNotified: false, reason: 'not-started' }
  }
}

async function settleLaunch(
  args: HostAgentLaunchArgs,
  pane: { tabId: string; leafId: string },
  send: Promise<unknown>,
  releaseHold: () => void
): Promise<HostAgentLaunchDelivery> {
  try {
    const result = await send
    if (!isAgentLaunchResult(result)) {
      return { delivered: false, failureNotified: false, reason: 'unconfirmed' }
    }
    return deliveryFromResult(result)
  } catch (error) {
    const code = error instanceof RuntimeRpcCallError ? error.code : undefined
    // The host never took the pane, so it would open as a shell: the tab goes, and the caller says why.
    const hostTookPane = !isAgentLaunchPaneSpawnHeld(pane.tabId, pane.leafId)
    if (code === 'agent_session_operation_capacity') {
      closeLaunchTab(args.worktreeId, pane.tabId)
      return launchWithoutRecord(args)
    }
    if (!hostTookPane || (code !== undefined && ADMISSION_REFUSAL_CODES.has(code))) {
      closeLaunchTab(args.worktreeId, pane.tabId)
      return {
        delivered: false,
        failureNotified: false,
        reason: code === 'agent_session_operation_unknown' ? 'unconfirmed' : 'not-started'
      }
    }
    // The pane reads how the launch ended off the record and says it: couldn't start, or couldn't
    // confirm it started.
    return { delivered: false, failureNotified: true, reason: 'not-started' }
  } finally {
    releaseHold()
  }
}

export function launchAgentThroughHost(args: HostAgentLaunchArgs): {
  tabId: string
  delivery: Promise<HostAgentLaunchDelivery>
} {
  const store = useAppStore.getState()
  const tabId = createBrowserUuid()
  const leafId = createBrowserUuid()
  // Before the tab exists, so its first mount already waits.
  const releaseHold = holdAgentLaunchPaneSpawn(tabId, leafId)
  const send = callRuntimeRpc<unknown>({ kind: 'local' }, 'agent.launchReplay', {
    ...launchParams(args),
    // A new click is a new operation; the pane is this click's too.
    operationId: createAgentSessionOperationId(),
    paneKey: makePaneKey(tabId, leafId)
  })
  store.createTab(args.worktreeId, args.groupId, undefined, {
    id: tabId,
    initialLeafId: leafId,
    agentLaunchPane: { leafId },
    launchAgent: args.agent,
    quickCommandLabel: args.quickCommandLabel,
    ...(args.viewMode ? { viewMode: args.viewMode } : {})
  })
  rememberAgentLaunchPanePrompt(tabId, args.prompt)
  seedNativeChatAppliedSessionOptions(tabId, args.agent, args.sessionOptions)
  // Why: without it an activated launch can stay hidden behind an editor.
  store.setActiveTabType('terminal', args.worktreeId)
  persistAgentLaunchTabOrder(args.worktreeId, tabId)
  return { tabId, delivery: settleLaunch(args, { tabId, leafId }, send, releaseHold) }
}
