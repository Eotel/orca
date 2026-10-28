import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { RuntimeMobileSessionTerminalTab } from '../../../../shared/runtime-mobile-session-tab-contracts'
import { buildRuntimeMobileAgentStatus } from './runtime-mobile-agent-status-builder'

const PROVIDER_SESSION = { key: 'session_id' as const, id: 'session-1' }
const TAB_ID = 'tab-1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const LEAF_TAB: RuntimeMobileSessionTerminalTab = {
  type: 'terminal',
  id: `${TAB_ID}::${LEAF_ID}`,
  title: 'Terminal 1',
  parentTabId: TAB_ID,
  leafId: LEAF_ID,
  isActive: true
}

describe('mobile agent status builder', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the provider-session agent type when an idle pane hook is older than 30 minutes', () => {
    vi.useFakeTimers()
    const completedAt = 1_700_000_000_000
    vi.setSystemTime(completedAt + 31 * 60_000)
    const row: AgentStatusIpcPayload = {
      paneKey: PANE_KEY,
      state: 'done',
      prompt: '',
      agentType: 'claude',
      providerSession: PROVIDER_SESSION,
      connectionId: null,
      receivedAt: completedAt,
      stateStartedAt: completedAt
    }

    const result = buildRuntimeMobileAgentStatus(null, LEAF_TAB, null, null, () => [row], {
      getPaneKey: () => PANE_KEY,
      getLeaf: () => null,
      getTrackedTitle: () => null
    })

    expect(result.agentStatus).toEqual(
      expect.objectContaining({ state: 'done', agentType: 'claude', stateStartedAt: completedAt })
    )
  })
})
