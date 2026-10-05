import { afterEach, describe, expect, it, vi } from 'vitest'

const listeners = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => void>())
vi.mock('electron', () => ({
  ipcMain: {
    removeAllListeners: (channel: string) => listeners.delete(channel),
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) =>
      listeners.set(channel, listener)
  }
}))

const { registerAgentLaunchPaneCloseIpc } = await import('./agent-launch-pane-close-ipc')
const { resetAgentLaunchPanesForTests, trackRunningAgentLaunchPane } =
  await import('../agent-launch/agent-launch-pane-attachment')

const TAB = 'tab-close'
const LEAF = '99999999-9999-4999-8999-999999999999'

describe("the window's report that the user closed a launch tab", () => {
  afterEach(() => resetAgentLaunchPanesForTests())

  it('reaches the launch running in that pane, and ignores what is not a pane', () => {
    registerAgentLaunchPaneCloseIpc()
    const running = trackRunningAgentLaunchPane({ worktreeId: 'wt-1', paneKey: `${TAB}:${LEAF}` })
    const report = listeners.get('agentLaunch:paneClosed')!

    report({}, { worktreeId: 'wt-1', tabId: TAB })
    report({}, { worktreeId: 'wt-1', tabId: TAB, leafId: 'not-a-leaf' })
    expect(running.closedByUser()).toBe(false)

    report({}, { worktreeId: 'wt-1', tabId: TAB, leafId: LEAF })
    expect(running.closedByUser()).toBe(true)
  })
})
