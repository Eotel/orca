import { describe, expect, it } from 'vitest'
import { isAgentLaunchResult } from './agent-launch-intent'

function result(prompt: unknown) {
  return {
    outcome: { kind: 'terminal', handle: 'term_1', paneKey: 'tab:leaf' },
    worktreeId: 'wt-1',
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'x' },
    prompt
  }
}

describe('reading a launch result whose prompt was not delivered', () => {
  it('reads one with no reason, and one the agent exited before reading', () => {
    expect(isAgentLaunchResult(result({ delivery: 'submit', outcome: 'not-delivered' }))).toBe(true)
    expect(
      isAgentLaunchResult(
        result({ delivery: 'submit', outcome: 'not-delivered', reason: 'agent-exited' })
      )
    ).toBe(true)
  })

  // Why: a newer host may name a reason this build never heard of; the outcome already says not to
  // resend, so rejecting the whole result would only lose the agent's surface.
  it('reads a reason this build does not know as not delivered, never as a bad result', () => {
    expect(
      isAgentLaunchResult(
        result({ delivery: 'submit', outcome: 'not-delivered', reason: 'a-reason-added-later' })
      )
    ).toBe(true)
    expect(
      isAgentLaunchResult(result({ delivery: 'submit', outcome: 'not-delivered', reason: 7 }))
    ).toBe(false)
  })
})
