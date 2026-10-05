import { describe, expect, it, vi } from 'vitest'
import { setupTerminalCreateSurfacing } from './ipc-events-terminal-create-test-harness'

describe('a launch tab the user closed while its agent was starting', () => {
  it('stays closed, and its agent stops, as closing any tab stops what runs in it', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const { createTab, replyTerminalCreate, createTerminalListenerRef, storeState } = scenario
    if (!createTerminalListenerRef.current) {
      throw new Error('Expected the create-terminal listener to be registered')
    }
    const kill = vi.fn(async () => {})
    Object.assign(window.api, { pty: { kill } })
    storeState.tabsByWorktree['wt-1'] = []

    createTerminalListenerRef.current({
      requestId: 'reveal-closed-launch-tab',
      worktreeId: 'wt-1',
      ptyId: 'pty-agent',
      tabId: 'tab-launch',
      leafId: 'leaf-launch',
      surfaceOwner: false,
      launchTabShown: true
    })

    expect(createTab).not.toHaveBeenCalled()
    expect(kill).toHaveBeenCalledWith('pty-agent')
    expect(replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'reveal-closed-launch-tab',
      error: 'agent_launch_tab_closed'
    })
  })

  it('binds as before when the shown tab is still there', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const { createTerminalListenerRef, storeState, replyTerminalCreate } = scenario
    if (!createTerminalListenerRef.current) {
      throw new Error('Expected the create-terminal listener to be registered')
    }
    const kill = vi.fn(async () => {})
    Object.assign(window.api, { pty: { kill } })
    storeState.tabsByWorktree['wt-1'] = [{ id: 'tab-launch', ptyId: null }]

    createTerminalListenerRef.current({
      requestId: 'reveal-shown-launch-tab',
      worktreeId: 'wt-1',
      ptyId: 'pty-agent',
      tabId: 'tab-launch',
      leafId: 'leaf-launch',
      surfaceOwner: false,
      launchTabShown: true
    })

    expect(kill).not.toHaveBeenCalled()
    expect(replyTerminalCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'agent_launch_tab_closed' })
    )
  })
})
