import {
  buildDashboardSnapshotFixture as buildDashboardSnapshot,
  buildDashboardBucketCountsFixture as buildDashboardBucketCounts
} from './dashboard-snapshot.test-fixture'
import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshotInput as DashboardSnapshotState } from './build-dashboard-snapshot'

import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'

import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status/contracts/agent-status-freshness'
import { folderWorkspaceKey } from '../../../../../shared/workspace/identity/workspace-scope'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalTab } from '../../../../../shared/workspace-layout/terminal-tab-types'
import type { Worktree } from '../../../../../shared/worktree/types'

import '../../sidebar/workspace-card/activity/worktree-agent-row-selectors'

import type * as DashboardSnapshotWorkspacesModule from './dashboard-snapshot-workspaces'
import type * as AgentRowLineageModule from '../rows/agent-row-lineage'

const mapMetadataCalls = vi.hoisted(() => ({
  hostKind: vi.fn(),
  parentPaneKey: vi.fn()
}))

vi.mock('./dashboard-snapshot-workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardSnapshotWorkspacesModule>()
  return {
    ...actual,
    dashboardCardMapWorkspaceMetadata: (
      ...args: Parameters<typeof actual.dashboardCardMapWorkspaceMetadata>
    ) => {
      mapMetadataCalls.hostKind()
      return actual.dashboardCardMapWorkspaceMetadata(...args)
    }
  }
})

vi.mock('../rows/agent-row-lineage', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentRowLineageModule>()
  return {
    ...actual,
    dashboardCardParentPaneKey: (...args: Parameters<typeof actual.dashboardCardParentPaneKey>) => {
      mapMetadataCalls.parentPaneKey()
      return actual.dashboardCardParentPaneKey(...args)
    }
  }
})

const NOW = 1_000_000_000
const TAB_ID = 'tab1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'

const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)

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

function baseState(overrides: Partial<DashboardSnapshotState>): DashboardSnapshotState {
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
      const aged = buildDashboardSnapshot(
        baseState({
          agentStatusByPaneKey: acceptedAgentStatuses([
            [
              PANE_KEY,
              entry({
                state,
                mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: NOW - 1000 }
              })
            ]
          ])
        }),
        NOW + AGENT_STATUS_STALE_AFTER_MS + 1000
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

    expect(buildDashboardBucketCounts(state, NOW + 18 * 60 * 60_000).attention).toBe(2)
  })

  it('counts a remote row in its host workspace when a local tab ID collides', () => {
    const workspaceId = folderWorkspaceKey('folder-1')
    const state = baseState({
      repos: [],
      worktreesByRepo: {},
      folderWorkspaces: [
        {
          id: 'folder-1',
          projectGroupId: 'group-1',
          name: 'Docs workspace',
          folderPath: '/workspace/docs',
          connectionId: 'ssh-1',
          linkedTask: null,
          comment: '',
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: NOW,
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      projectGroups: [
        {
          id: 'group-1',
          name: 'Documentation',
          parentPath: '/workspace',
          connectionId: 'ssh-1',
          parentGroupId: null,
          createdFrom: 'folder-scan',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      tabsByWorktree: { local: [tab(TAB_ID, 'local')] },
      agentStatusByPaneKey: acceptedAgentStatuses([
        [PANE_KEY, entry({ connectionId: 'ssh-1', worktreeId: workspaceId })]
      ])
    })
    expect(buildDashboardSnapshot(state, NOW).cards.map((card) => card.worktreeId)).toEqual([
      workspaceId
    ])
    expect(buildDashboardBucketCounts(state, NOW)).toEqual({
      attention: 0,
      working: 1,
      done: 0,
      idle: 0
    })
  })

  it('nulls ptyId when the layout entry points at a dead pty', () => {
    const snapshot = buildDashboardSnapshot(
      baseState({
        agentStatusByPaneKey: acceptedAgentStatuses(Object.entries({ [PANE_KEY]: entry({}) })),
        // Layouts retain old PTY IDs after restart; only the live set proves preview availability.
        ptyIdsByTabId: { [TAB_ID]: [] }
      }),
      NOW
    )
    expect(snapshot.cards[0].ptyId).toBeNull()
  })
})
