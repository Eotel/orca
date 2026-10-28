import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import { resetAgentCompletionCoordinatorIdentitiesForTest } from './agent-completion-identity-store'

describe('agent completion coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    resetAgentCompletionCoordinatorIdentitiesForTest()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('suppresses done replays when the optional agent type alternates', () => {
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      inspectProcess: vi.fn(),
      dispatchCompletion,
      isLive: () => true
    })

    for (const agentType of ['claude', undefined, 'claude', undefined]) {
      coordinator.observeHookStatus({
        state: 'done',
        prompt: '',
        ...(agentType ? { agentType } : {}),
        stateStartedAt: 1_700_000_000_000
      })
      vi.advanceTimersByTime(8_000)
    }

    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
  })
})
