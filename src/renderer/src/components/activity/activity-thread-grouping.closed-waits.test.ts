import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status/contracts/agent-status-freshness'
import { buildActivityThreadGroups } from './activity-thread-grouping'
import {
  makeActivityResult,
  makeRetainedDoneEntry,
  makeTab,
  makeThreads,
  makeWorkingEntryWithoutHistory,
  PANE_KEY
} from './ActivityPrototypePage-test-fixtures'

describe('activity thread status groups for waits', () => {
  it.each(['waiting', 'blocked'] as const)(
    'moves a retained %s question out of the attention groups when its pane has ended',
    (state) => {
      const retained = makeRetainedDoneEntry(makeTab())
      retained.entry = { ...retained.entry, state }
      const threads = makeThreads(makeActivityResult({ retained: { [PANE_KEY]: retained } }))

      expect(buildActivityThreadGroups(threads, 'status').map((group) => group.key)).toEqual([
        'done'
      ])
    }
  )

  it.each(['waiting', 'blocked'] as const)(
    'keeps an unanswered %s question in its attention group however old',
    (state) => {
      const threads = makeThreads(
        makeActivityResult({
          entries: { [PANE_KEY]: { ...makeWorkingEntryWithoutHistory(), state } },
          now: 3_000 + 18 * 60 * 60_000
        })
      )

      expect(buildActivityThreadGroups(threads, 'status').map((group) => group.key)).toEqual([
        state
      ])
    }
  )

  it('does not revive an answered question when its later working status becomes stale', () => {
    const threads = makeThreads(
      makeActivityResult({
        entries: {
          [PANE_KEY]: {
            ...makeWorkingEntryWithoutHistory(),
            stateHistory: [{ state: 'waiting', prompt: 'Continue?', startedAt: 1_000 }]
          }
        },
        now: 3_000 + AGENT_STATUS_STALE_AFTER_MS + 1
      })
    )

    expect(buildActivityThreadGroups(threads, 'status').map((group) => group.key)).toEqual(['done'])
  })
})
