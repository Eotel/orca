import { describe, expect, it, vi } from 'vitest'
import { formatAgentLaunchPaneFailure } from '../../../../shared/agent-launch-pane-failure'

vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string) =>
    key === 'auto.components.terminal.pane.TerminalErrorToast.agentLaunchNotStarted'
      ? '智能体无法启动。'
      : fallback
}))

import { humanizeTerminalError } from './TerminalErrorToast'

describe('a launch-owned pane whose agent did not start', () => {
  it("leads with the viewer's own copy and keeps the host's reason", () => {
    expect(humanizeTerminalError(formatAgentLaunchPaneFailure('spawn claude ENOENT'))).toBe(
      '智能体无法启动。 spawn claude ENOENT'
    )
  })
})
