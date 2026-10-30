import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { buildActivityEvents } from './events/activity-event-builder'
import { buildAgentPaneThreads } from './threads/activity-thread-builder'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
export const PANE_KEY = makePaneKey('tab-1', LEAF_ID)

function makeRepo(): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 1
  }
}

function makeWorktree(): Worktree {
  return {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo/wt-1',
    head: 'abc123',
    branch: 'feature',
    isBare: false,
    isMainWorktree: false,
    displayName: 'feature',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  }
}

function makeTab(): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

export function makeWorkingEntryWithoutHistory(): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'New run',
    updatedAt: 3_000,
    stateStartedAt: 3_000,
    paneKey: PANE_KEY,
    terminalTitle: 'Claude',
    stateHistory: [],
    agentType: 'claude'
  }
}

export function makeActivityResult(args: {
  entries?: Record<string, AgentStatusEntry>
  tab?: TerminalTab
  tabs?: TerminalTab[]
  ptyIdsByTabId?: Record<string, string[]>
  now?: number
}): ReturnType<typeof buildActivityEvents> {
  const repo = makeRepo()
  const worktree = makeWorktree()
  const tab = args.tab ?? makeTab()

  return buildActivityEvents({
    chatNames: new Map(),
    agentStatusByPaneKey: acceptedAgentStatuses(Object.entries(args.entries ?? {})),
    tabsByWorktree: {
      [worktree.id]: args.tabs ?? [tab]
    },
    ptyIdsByTabId: args.ptyIdsByTabId,
    worktreeMap: new Map([[worktree.id, worktree]]),
    repoMap: new Map([[repo.id, repo]]),
    acknowledgedAgentsByPaneKey: {},
    now: args.now ?? 3_000
  })
}

export function makeThreads(result: ReturnType<typeof buildActivityEvents>) {
  return buildAgentPaneThreads({
    events: result.events,
    liveAgentByPaneKey: result.liveAgentByPaneKey,
    paneEntryByPaneKey: result.paneEntryByPaneKey
  })
}
