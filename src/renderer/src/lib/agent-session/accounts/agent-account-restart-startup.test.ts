import { acceptedAgentStatuses } from '@/store/slices/agent-status/status-ownership/accepted-agent-statuses'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/index'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import { buildPaneAccountRestartStartup } from './agent-account-restart-startup'
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { ProjectExecutionRuntimeResolution } from '../../../../../shared/execution-host/project-execution-runtime'
import type * as localPreflightContext from '@/runtime/hosts/preflight/local-preflight-context'

let projectRuntimeContext: ProjectExecutionRuntimeResolution | undefined

vi.mock('@/runtime/hosts/preflight/local-preflight-context', async (importOriginal) => ({
  ...(await importOriginal<typeof localPreflightContext>()),
  getLocalProjectExecutionRuntimeContext: () => projectRuntimeContext
}))

const TAB_ID = 'tab-1'
const LEAF_ID = '0195f2ce-1111-4000-8000-000000000001'
const WORKTREE_ID = 'wt1'
const SESSION_ID = '01a006a6-1d07-70a1-bad5-f9110d5845c0'

function seedAgentStatus(entry: Partial<AgentStatusEntry> | null): void {
  const paneKey = makePaneKey(TAB_ID, LEAF_ID)
  useAppStore.setState({
    agentStatusByPaneKey: acceptedAgentStatuses(
      Object.entries(
        entry
          ? {
              [paneKey]: {
                paneKey,
                tabId: TAB_ID,
                state: 'done',
                prompt: '',
                updatedAt: 1,
                stateStartedAt: 1,
                stateHistory: [],
                ...entry
              }
            }
          : {}
      )
    ),
    agentLaunchConfigByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {}
  })
}

describe('buildPaneAccountRestartStartup for Claude', () => {
  const pane = { tabId: TAB_ID, leafId: LEAF_ID, worktreeId: WORKTREE_ID }

  beforeEach(() => {
    seedAgentStatus(null)
    projectRuntimeContext = undefined
    useAppStore.setState({
      tabsByWorktree: {},
      worktreesByRepo: {},
      settings: getDefaultSettings('/home/dev')
    })
  })

  it('resumes a hand-started Claude with the configured default arguments and environment', () => {
    seedAgentStatus({
      agentType: 'claude',
      state: 'done',
      providerSession: { key: 'session_id', id: SESSION_ID }
    })
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/home/dev'),
        agentDefaultArgs: { claude: '--dangerously-skip-permissions' },
        agentDefaultEnv: { claude: { CLAUDE_DEFAULT_ONLY: '1' } }
      }
    })

    const startup = buildPaneAccountRestartStartup('claude', pane)
    expect(startup?.command).toContain(SESSION_ID)
    expect(startup?.command).toContain('--dangerously-skip-permissions')
    expect(startup?.env?.CLAUDE_DEFAULT_ONLY).toBe('1')
  })

  it('keeps a recorded Claude launch config on resume', () => {
    seedAgentStatus({
      agentType: 'claude',
      state: 'done',
      providerSession: { key: 'session_id', id: SESSION_ID }
    })
    useAppStore.getState().registerAgentLaunchConfig(makePaneKey(TAB_ID, LEAF_ID), {
      agentArgs: '--model opus',
      agentEnv: { CLAUDE_RECORDED_ONLY: '1' }
    })

    const startup = buildPaneAccountRestartStartup('claude', pane)
    expect(startup?.command).toContain('--model')
    expect(startup?.command).not.toContain('--dangerously-skip-permissions')
    expect(startup?.env?.CLAUDE_RECORDED_ONLY).toBe('1')
  })
})
