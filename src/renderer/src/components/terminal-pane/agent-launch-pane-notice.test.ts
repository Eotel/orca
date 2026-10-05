import { describe, expect, it, vi } from 'vitest'
import {
  formatAgentLaunchPaneRefusal,
  parseAgentLaunchPaneRefusal
} from '../../../../shared/agent-launch-pane-verdict'

const CATALOG: Record<string, string> = {
  'auto.components.terminal.pane.AgentLaunchPaneNotice.notStarted': '智能体无法启动。',
  'auto.components.terminal.pane.AgentLaunchPaneNotice.unconfirmed': '无法确认智能体已启动。',
  'auto.components.terminal.pane.AgentLaunchPaneNotice.exitedDuringStart': '它在启动时退出了。'
}
vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string) => CATALOG[key] ?? fallback
}))

const { agentLaunchPaneNoticeText, shownAgentLaunchPaneRefusal } =
  await import('./agent-launch-pane-notice-text')

/** The pane's error as it arrives: IPC-wrapped around what main threw. */
function arrived(refusal: Parameters<typeof formatAgentLaunchPaneRefusal>[0]) {
  const parsed = parseAgentLaunchPaneRefusal(
    `Error invoking remote method 'pty:spawn': Error: ${formatAgentLaunchPaneRefusal(refusal)}`
  )
  if (!parsed || parsed.kind === 'withdrawn') {
    throw new Error('not a shown refusal')
  }
  return parsed
}

describe("the pane of a launch whose agent isn't running", () => {
  it("says it couldn't start, in the viewer's language, with a reason they can act on", () => {
    expect(
      agentLaunchPaneNoticeText(
        arrived({ kind: 'not-started', code: 'agent_session_exited_during_start' })
      )
    ).toBe('智能体无法启动。 它在启动时退出了。')
  })

  it('never shows a host error code', () => {
    const text = agentLaunchPaneNoticeText(
      arrived({ kind: 'not-started', code: 'agent_launch_pane_already_live' })
    )
    expect(text).toBe('智能体无法启动。')
  })

  it("says it can't confirm, never that it failed, when nobody knows", () => {
    expect(agentLaunchPaneNoticeText(arrived({ kind: 'unconfirmed' }))).toBe(
      '无法确认智能体已启动。'
    )
  })
})

describe('which surface shows a pane error', () => {
  it('gives a launch verdict to the notice and everything else to the error toast', () => {
    const wrapped = (message: string) =>
      `Error invoking remote method 'pty:spawn': Error: ${message}`
    expect(shownAgentLaunchPaneRefusal(wrapped('[agent-launch-pane] unconfirmed'))).toEqual({
      kind: 'unconfirmed'
    })
    expect(shownAgentLaunchPaneRefusal(wrapped('spawn zsh ENOENT'))).toBeNull()
    // A withdrawn launch closes its tab; it is neither notice nor toast.
    expect(shownAgentLaunchPaneRefusal(wrapped('[agent-launch-pane] withdrawn'))).toBeNull()
    expect(shownAgentLaunchPaneRefusal(null)).toBeNull()
  })
})
