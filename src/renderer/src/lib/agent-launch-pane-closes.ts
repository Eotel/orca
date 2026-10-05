/**
 * Launch panes the user closed while their agent was still starting. The record of that explicit
 * close is what lets the agent's spawn-time reveal stop the agent instead of bringing the tab back;
 * a tab merely missing from the window (a reload before the session saved it) is never read as one.
 * Session-only and store-free, so the store's close path can note it without an import cycle.
 */

import { makePaneKey } from '../../../shared/stable-pane-id'

const MAX_REMEMBERED_CLOSES = 32
const closedPaneKeys = new Set<string>()

export function noteAgentLaunchPaneClosedByUser(tabId: string, leafId: string): void {
  const paneKey = makePaneKey(tabId, leafId)
  closedPaneKeys.delete(paneKey)
  closedPaneKeys.add(paneKey)
  for (const oldest of closedPaneKeys) {
    if (closedPaneKeys.size <= MAX_REMEMBERED_CLOSES) {
      break
    }
    closedPaneKeys.delete(oldest)
  }
}

export function wasAgentLaunchPaneClosedByUser(tabId: string, leafId: string): boolean {
  return closedPaneKeys.has(makePaneKey(tabId, leafId))
}
