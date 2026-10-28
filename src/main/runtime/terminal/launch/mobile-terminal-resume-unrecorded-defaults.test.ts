import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { TerminalWorkspaceLaunchScope } from '../../orchestration/terminal-authority/structured-sessions/runtime-legacy-worker-terminal-recovery-types'
import type { ResumableAgentSessionSource } from './mobile-terminal-startup'

const WORKSPACE: TerminalWorkspaceLaunchScope = {
  id: 'repo-1::/repo',
  path: '/repo',
  connectionId: null,
  repo: null,
  folderWorkspace: null
}

function resumeCommand(launchConfig: ResumableAgentSessionSource['launchConfig']): string {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resume command reads only Settings from the store.
  const store = {
    getSettings: () => ({
      ...getDefaultSettings('/home/dev'),
      agentDefaultArgs: { claude: '--dangerously-skip-permissions' }
    })
  } as unknown as RuntimeStore
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the protected resume command a windowless host's pane open goes through; no public seam exists.
  const runtime = new OrcaRuntimeService(store) as unknown as {
    resolveMobileSessionResumeCommand: (
      workspace: TerminalWorkspaceLaunchScope,
      record: ResumableAgentSessionSource
    ) => { command?: string } | null
  }
  return (
    runtime.resolveMobileSessionResumeCommand(WORKSPACE, {
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'provider-session-1' },
      launchConfig
    })?.command ?? ''
  )
}

describe.skipIf(process.platform === 'win32')('resuming a pane on a host with no window', () => {
  it('resumes an unrecorded launch with Settings defaults', () => {
    const command = resumeCommand(undefined)
    expect(command).toContain('--resume')
    expect(command).toContain('provider-session-1')
    expect(command).toContain('--dangerously-skip-permissions')
  })

  it('keeps a recorded launch config over Settings defaults', () => {
    const command = resumeCommand({ agentArgs: '--model opus', agentEnv: {} })
    expect(command).toContain('--model')
    expect(command).not.toContain('--dangerously-skip-permissions')
  })
})
