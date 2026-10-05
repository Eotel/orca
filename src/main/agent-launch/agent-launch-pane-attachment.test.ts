import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitAgentLaunchPaneAttachment,
  claimAgentLaunchPane,
  MAX_REMEMBERED_AGENT_LAUNCH_PANE_FAILURES,
  resetAgentLaunchPanesForTests
} from './agent-launch-pane-attachment'

const WT = 'wt-1'

/** What a pane's spawn waits on: nothing when no launch owns the pane. */
async function paneMayProceed(worktreeId: string, paneKey: string): Promise<void> {
  await (awaitAgentLaunchPaneAttachment(worktreeId, paneKey) ?? Promise.resolve())
}

describe('agent launch pane attachment', () => {
  afterEach(() => {
    resetAgentLaunchPanesForTests()
  })

  it('leaves a pane no launch owns alone, without even a wait', () => {
    expect(awaitAgentLaunchPaneAttachment(WT, 'tab:leaf')).toBeNull()
  })

  it('withdrawn: the pane proceeds as it would have without the launch', async () => {
    const owned = claimAgentLaunchPane(WT, 'tab:leaf')
    const waiting = paneMayProceed(WT, 'tab:leaf')
    owned.withdraw()
    await expect(waiting).resolves.toBeUndefined()
    await expect(paneMayProceed(WT, 'tab:leaf')).resolves.toBeUndefined()
  })

  it('only the first settlement counts', async () => {
    const owned = claimAgentLaunchPane(WT, 'tab:leaf')
    owned.launched()
    owned.failed('late')
    await expect(paneMayProceed(WT, 'tab:leaf')).resolves.toBeUndefined()
  })

  it('a retry that withdraws keeps the failure an earlier attempt left on the pane', async () => {
    claimAgentLaunchPane(WT, 'tab:leaf').failed('first attempt failed')
    claimAgentLaunchPane(WT, 'tab:leaf').withdraw()
    await expect(paneMayProceed(WT, 'tab:leaf')).rejects.toThrow('first attempt failed')
  })

  it('a retry that launches into the pane clears an earlier failure', async () => {
    claimAgentLaunchPane(WT, 'tab:leaf').failed('first attempt failed')
    claimAgentLaunchPane(WT, 'tab:leaf').launched()
    await expect(paneMayProceed(WT, 'tab:leaf')).resolves.toBeUndefined()
  })

  it('is per workspace: the same pane key elsewhere is not owned', async () => {
    claimAgentLaunchPane(WT, 'tab:leaf').failed('failed here')
    await expect(paneMayProceed('wt-2', 'tab:leaf')).resolves.toBeUndefined()
  })

  it('forgets the oldest failures past the cap, so a pane that never mounts cannot hold one forever', async () => {
    for (let index = 0; index <= MAX_REMEMBERED_AGENT_LAUNCH_PANE_FAILURES; index += 1) {
      claimAgentLaunchPane(WT, `tab-${index}:leaf`).failed(`failed ${index}`)
    }
    await expect(paneMayProceed(WT, 'tab-0:leaf')).resolves.toBeUndefined()
    await expect(paneMayProceed(WT, 'tab-1:leaf')).rejects.toThrow('failed 1')
  })
})
