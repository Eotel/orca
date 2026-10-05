import { afterEach, describe, expect, it } from 'vitest'
import { applyAgentLaunchPaneCloseReport } from './agent-launch-pane-close-report'
import {
  resetAgentLaunchPanesForTests,
  trackRunningAgentLaunchPane
} from './agent-launch-pane-attachment'

const TAB = 'tab-close'
const LEAF = '99999999-9999-4999-8999-999999999999'

describe("the window's report that the user closed a launch tab", () => {
  afterEach(() => resetAgentLaunchPanesForTests())

  it('reaches the launch running in that pane, and ignores what is not a pane', () => {
    const running = trackRunningAgentLaunchPane({ worktreeId: 'wt-1', paneKey: `${TAB}:${LEAF}` })

    applyAgentLaunchPaneCloseReport({ worktreeId: 'wt-1', tabId: TAB })
    applyAgentLaunchPaneCloseReport({ worktreeId: 'wt-1', tabId: TAB, leafId: 'not-a-leaf' })
    expect(running.closedByUser()).toBe(false)

    applyAgentLaunchPaneCloseReport({ worktreeId: 'wt-1', tabId: TAB, leafId: LEAF })
    expect(running.closedByUser()).toBe(true)
  })
})
