// Leads the error a launch-owned pane gets instead of a shell; the window swaps it for its own copy.
export const AGENT_LAUNCH_PANE_FAILURE_MARKER = '[agent-launch-not-started]'

export function formatAgentLaunchPaneFailure(reason: string): string {
  return `${AGENT_LAUNCH_PANE_FAILURE_MARKER} ${reason}`.trimEnd()
}
