import { describe, expect, it } from 'vitest'
import { getActivityThreadTaskTitle } from './activity-thread-display'

describe('getActivityThreadTaskTitle', () => {
  const tab = {
    customTitle: null,
    generatedTitle: 'Refactor auth middleware',
    title: 'Claude',
    defaultTitle: 'Claude'
  }

  it("names a resumed session by its own name, not the tab's first prompt", () => {
    expect(
      getActivityThreadTaskTitle({
        entry: {
          prompt: 'How is the rename going?',
          stateHistory: [],
          agentType: 'claude',
          providerSession: { key: 'session_id', id: 'session-1' }
        },
        tab: {
          ...tab,
          generatedTitle: 'Mac restarted at 15 01 so this tab stopped',
          aiVaultTitle: {
            agent: 'claude',
            sessionId: 'session-1',
            title: 'Triage lead handover',
            kind: 'named'
          }
        },
        generatedTitlesEnabled: true
      })
    ).toBe('Triage lead handover')
  })
})
