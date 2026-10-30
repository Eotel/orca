import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { createTestStore } from '@/store/testing/app-store-test-fixture'
import { describe, expect, it, vi } from 'vitest'
import {
  buildDashboardSnapshot,
  type DashboardSnapshotInput,
  type DashboardSnapshotState
} from './build-dashboard-snapshot'
import { buildDashboardBucketCounts } from '../bucket-counts/build-dashboard-bucket-counts'

import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'

import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status/contracts/agent-status-freshness'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalTab } from '../../../../../shared/workspace-layout/terminal-tab-types'
import type { Worktree } from '../../../../../shared/worktree/types'

import '../../sidebar/workspace-card/activity/worktree-agent-row-selectors'

const NOW = 1_000_000_000
const TAB_ID = 'tab1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'

const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)

function projectState(state: DashboardSnapshotState, now: number) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    const { runtimeStatusByEnvironmentId, ...appState } = state
    const store = createTestStore()
    store.setState(appState)
    return { ...store.getState(), runtimeStatusByEnvironmentId }
  } finally {
    clock.mockRestore()
  }
}

function entry(overrides: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    state: 'working',
    prompt: 'do the thing',
    updatedAt: NOW,
    stateStartedAt: NOW - 5000,
    stateHistory: [],
    agentType: 'claude',
    tabId: TAB_ID,
    worktreeId: 'w1',
    ...overrides
  }
}

function tab(id = TAB_ID, worktreeId = 'w1'): TerminalTab {
  return {
    id,
    ptyId: 'pty1',
    worktreeId,
    title: 'agent',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: NOW
  }
}

function worktree(id = 'w1', displayName = 'wt-one'): Worktree {
  return {
    id,
    repoId: 'r1',
    path: `/r1/${id}`,
    head: 'abc123',
    branch: 'main',
    isBare: false,
    isMainWorktree: false,
    displayName,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: NOW
  }
}

function baseState(overrides: Partial<DashboardSnapshotInput>): DashboardSnapshotInput {
  return {
    chatNames: new Map(),
    repos: [{ id: 'r1', path: '/r1', displayName: 'Repo One', badgeColor: '#000', addedAt: NOW }],
    worktreesByRepo: { r1: [worktree()] },
    tabsByWorktree: { w1: [tab()] },
    agentStatusByPaneKey: acceptedAgentStatuses(Object.entries({})),
    migrationUnsupportedByPtyId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: 'pty1' }
      }
    },
    ptyIdsByTabId: { [TAB_ID]: ['pty1'] },
    runtimePaneTitlesByTabId: {},
    acknowledgedAgentsByPaneKey: {},
    settings: null,
    ...overrides
  }
}

describe('buildDashboardSnapshot', () => {
  it('keeps an unanswered question waiting however old while a silent working turn decays', () => {
    for (const state of ['working', 'waiting'] as const) {
      const now = NOW + AGENT_STATUS_STALE_AFTER_MS + 1000
      const input = baseState({
        agentStatusByPaneKey: acceptedAgentStatuses([
          [
            PANE_KEY,
            entry({
              state,
              mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: NOW - 1000 }
            })
          ]
        ])
      })
      const aged = buildDashboardSnapshot(
        { ...projectState(input, now), chatNames: input.chatNames },
        now
      )
      expect(aged.cards[0].dotState).toBe(state === 'working' ? 'idle' : 'waiting')
    }
  })

  it('counts unanswered questions as attention however old', () => {
    const otherPaneKey = makePaneKey('tab2', LEAF_ID)
    const state = baseState({
      worktreesByRepo: { r1: [worktree(), worktree('w2', 'wt-two')] },
      tabsByWorktree: { w1: [tab()], w2: [{ ...tab('tab2', 'w2'), ptyId: 'pty2' }] },
      terminalLayoutsByTabId: {
        [TAB_ID]: {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty1' }
        },
        tab2: {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty2' }
        }
      },
      ptyIdsByTabId: { [TAB_ID]: ['pty1'], tab2: ['pty2'] },
      agentStatusByPaneKey: acceptedAgentStatuses([
        [PANE_KEY, entry({ state: 'waiting' })],
        [
          otherPaneKey,
          entry({ paneKey: otherPaneKey, tabId: 'tab2', worktreeId: 'w2', state: 'blocked' })
        ]
      ])
    })

    const now = NOW + 18 * 60 * 60_000
    expect(buildDashboardBucketCounts(projectState(state, now), now).attention).toBe(2)
  })
})
