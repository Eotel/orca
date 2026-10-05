import { createPasteReadinessTimeoutNotice } from '@/lib/launch-agent-paste-timeout-notice'
import {
  deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab
} from '@/lib/agent-launch-prompt-delivery'
import type { TuiAgent } from '../../../shared/tui-agent'

/**
 * A new agent tab's prompt the window keeps: a draft, or text an agent takes only after it starts,
 * which the tab leaves unsent for the user. A prompt to submit is the host's to deliver
 * (`launch-agent-new-tab-host-route`), so nothing here waits on a turn.
 */
export function deliverNewTabLaunchPrompt(args: {
  worktreeId: string
  tabId: string
  agent: TuiAgent
  /** Trimmed; empty for a launch with no prompt. */
  prompt: string
  /** Null when the launch command already carries the draft as an editable prefill. */
  pasteDraftAfterLaunch: string | null
  onPromptDelivered?: () => void
  onPromptDeliveryUnconfirmed?: () => void
}): void {
  const { tabId, agent, prompt, pasteDraftAfterLaunch } = args
  if (!prompt) {
    return
  }
  if (pasteDraftAfterLaunch === null) {
    // Why: no paste runs to seed the chat's copy; the draft rode in on argv (Claude --prefill etc.).
    seedNativeChatLaunchDraftForAgentTab({ tabId, agent, text: prompt })
    args.onPromptDelivered?.()
    return
  }
  const timeoutNotice = createPasteReadinessTimeoutNotice({
    worktreeId: args.worktreeId,
    tabId,
    agent,
    submitted: false,
    content: pasteDraftAfterLaunch
  })
  void deliverLaunchPromptToAgentTab({
    tabId,
    content: pasteDraftAfterLaunch,
    agent,
    submit: false,
    forcePaste: true,
    onTimeout: timeoutNotice.onTimeout,
    ...(args.onPromptDeliveryUnconfirmed
      ? { onUnconfirmedDelivery: args.onPromptDeliveryUnconfirmed }
      : {})
  })
    .then((delivered) => timeoutNotice.settle(delivered, args.onPromptDelivered))
    .catch((error) => console.error('Prompt delivery failed after launch', error))
}
