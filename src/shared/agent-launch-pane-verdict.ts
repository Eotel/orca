/**
 * What a pane an `agent.launch` showed before its agent existed does instead of starting a shell.
 * Main derives it from the launch record and the live runtime; the window shows it in the pane.
 */

export type AgentLaunchPaneVerdict =
  /** No launch owns the pane, or its agent ran there: the pane's own spawn decides, as for any pane. */
  | { kind: 'proceed' }
  /** The launch failed before its agent ran; `code` is the recorded reason, for the window to word. */
  | { kind: 'not-started'; code: string }
  /** The launch may have started its agent and nothing can tell. */
  | { kind: 'unconfirmed' }
  /** The launch ran elsewhere or never ran; the tab is the host's to take back. */
  | { kind: 'withdrawn' }

export type AgentLaunchPaneRefusal = Exclude<AgentLaunchPaneVerdict, { kind: 'proceed' }>

const MARKER = '[agent-launch-pane]'
// Matched anywhere: the message arrives IPC-wrapped ("Error invoking remote method 'pty:spawn': …").
const PATTERN = /\[agent-launch-pane\] (not-started|unconfirmed|withdrawn)(?::([A-Za-z0-9_.-]{1,128}))?/

export function formatAgentLaunchPaneRefusal(refusal: AgentLaunchPaneRefusal): string {
  return refusal.kind === 'not-started'
    ? `${MARKER} not-started:${refusal.code}`
    : `${MARKER} ${refusal.kind}`
}

export function parseAgentLaunchPaneRefusal(error: string): AgentLaunchPaneRefusal | null {
  const match = PATTERN.exec(error)
  if (!match) {
    return null
  }
  if (match[1] === 'not-started') {
    return { kind: 'not-started', code: match[2] ?? '' }
  }
  return { kind: match[1] === 'unconfirmed' ? 'unconfirmed' : 'withdrawn' }
}
