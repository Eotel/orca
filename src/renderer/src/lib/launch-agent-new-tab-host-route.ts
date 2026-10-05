import { useAppStore } from '@/store'
import { seedNativeChatLaunchPromptForAgentTab } from '@/lib/agent-launch-prompt-delivery'
import {
  showAgentLaunchExitedNotice,
  showAgentLaunchOutcomeNotice,
  showAgentLaunchPromptNotDeliveredNotice,
  showAgentLaunchPromptUnconfirmedNotice
} from '@/lib/agent-launch-prompt-not-delivered-notice'
import {
  launchAgentThroughHost,
  type HostAgentLaunchArgs,
  type HostAgentLaunchDelivery
} from '@/lib/agent-launch-through-host'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../shared/tui-agent'

type NewTabPromptDelivery = 'auto-submit' | 'draft' | 'submit-after-ready'

/**
 * Whether a new agent tab's prompt goes to the host to deliver. A draft stays the window's (the host
 * delivers none to a terminal), and so does a prompt an agent takes only after it starts, which the
 * tab leaves unsent for the user unless a caller asked for it submitted.
 */
export function newTabPromptLaunchesThroughHost(args: {
  agent: TuiAgent
  prompt: string
  promptDelivery: NewTabPromptDelivery
}): boolean {
  if (!args.prompt) {
    return false
  }
  if (args.promptDelivery === 'submit-after-ready') {
    return true
  }
  return (
    args.promptDelivery === 'auto-submit' &&
    TUI_AGENT_CONFIG[args.agent].promptInjectionMode !== 'stdin-after-start'
  )
}

/** Tells the user what became of the launch, once, and answers the caller that waits on it. */
function settleNewTabHostDelivery(
  delivery: HostAgentLaunchDelivery,
  args: {
    worktreeId: string
    /** Null when the host showed the tab. */
    tabId: string | null
    agent: TuiAgent
    prompt: string
    actsOnResult: boolean
    onPromptDelivered?: () => void
  }
): { delivered: boolean; failureNotified: boolean } {
  const { agent, prompt } = args
  const userClosedTab =
    delivery.kind !== 'not-started' &&
    args.tabId !== null &&
    !(useAppStore.getState().tabsByWorktree[args.worktreeId] ?? []).some(
      (tab) => tab.id === args.tabId
    )
  if (delivery.kind !== 'delivered' && userClosedTab) {
    // Why: the user closed the tab, and with it the agent; nothing is owed a notice.
    return { delivered: false, failureNotified: true }
  }
  switch (delivery.kind) {
    case 'delivered':
      args.onPromptDelivered?.()
      return { delivered: true, failureNotified: false }
    case 'not-delivered':
      if (delivery.agentExited) {
        // Why its own words: the agent did not really start, so "paste it once ready" is wrong.
        showAgentLaunchExitedNotice({ agent, prompt })
        return { delivered: false, failureNotified: true }
      }
      showAgentLaunchPromptNotDeliveredNotice({ agent, prompt })
      return { delivered: false, failureNotified: true }
    case 'unconfirmed':
      // Why silent when nothing waits on it: main reported nothing for such a launch.
      if (!args.actsOnResult) {
        return { delivered: false, failureNotified: false }
      }
      // The agent may have the prompt: say so, and never invite pasting it a second time.
      showAgentLaunchPromptUnconfirmedNotice({ agent, prompt })
      return { delivered: false, failureNotified: true }
    case 'pane-says':
      return { delivered: false, failureNotified: true }
    case 'not-started':
      // The tab is gone, so its pane's words go in a notice instead.
      showAgentLaunchOutcomeNotice({
        outcome: delivery.unconfirmed
          ? { kind: 'unconfirmed' }
          : { kind: 'not-started', code: delivery.code ?? '' },
        prompt
      })
      return { delivered: false, failureNotified: true }
  }
}

/**
 * A new agent tab whose prompt the host delivers. The tab is this window's, made at the click; the
 * agent, its prompt and the record of the launch are the host's. A caller that acts on the result
 * (`submit-after-ready`) gets it from the host's proof, never from the tab appearing.
 */
export function launchNewTabPromptThroughHost(
  args: Omit<HostAgentLaunchArgs, 'confirmation'> & {
    promptDelivery: NewTabPromptDelivery
    onPromptDelivered?: () => void
  }
): {
  /** Null when the host shows the tab itself. */
  tabId: string | null
  promptDeliveryResult?: Promise<{ delivered: boolean; failureNotified: boolean }>
} {
  const { promptDelivery, onPromptDelivered, ...launch } = args
  const actsOnResult = promptDelivery === 'submit-after-ready'
  const { tabId, delivery } = launchAgentThroughHost({
    ...launch,
    confirmation: actsOnResult ? 'required' : 'best-effort'
  })
  // Why only then: such a prompt is never put in a launch file, whose pointer would be all the
  // agent's transcript shows, so it could never prune this copy.
  const seeded =
    actsOnResult &&
    tabId !== null &&
    seedNativeChatLaunchPromptForAgentTab({ tabId, agent: launch.agent, text: launch.prompt })
  const result = delivery.then((settled) => {
    if (seeded && tabId && (settled.kind === 'not-delivered' || settled.kind === 'pane-says')) {
      useAppStore.getState().markNativeChatLaunchPromptFailed(tabId)
    }
    return settleNewTabHostDelivery(settled, {
      worktreeId: launch.worktreeId,
      tabId,
      agent: launch.agent,
      prompt: launch.prompt,
      actsOnResult,
      ...(onPromptDelivered ? { onPromptDelivered } : {})
    })
  })
  if (actsOnResult) {
    return { tabId, promptDeliveryResult: result }
  }
  void result.catch((error) => console.error('Prompt delivery failed after launch', error))
  return { tabId }
}
