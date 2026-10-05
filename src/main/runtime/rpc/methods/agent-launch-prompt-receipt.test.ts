/**
 * What a launch's receipt says about its prompt, by host and caller, with no caller-supplied
 * delivery class: one rule from host facts. A caller that reads `unconfirmed` (the desktop, the CLI)
 * gets proof where the host can give it, so its follow-up never runs before the agent is ready; a
 * Windows host, which can never see the agent in front, reports the prompt as handed over, as main
 * ran the desktop's follow-up after its paste; the phone keeps the answer it always had.
 */

import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import type { LaunchHost } from '../../../../shared/launch-host'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import type { RpcContext } from '../core'
import {
  CAPABLE_CLIENT,
  methodNamed,
  rpcContext,
  runtimeStub,
  type AgentLaunchRuntimeStub
} from './agent-launch.test-fixture'

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')

const DESKTOP: Partial<RpcContext> = {
  clientKind: 'runtime',
  caller: DESKTOP_RPC_CALLER,
  clientCapabilities: [...DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES]
}
const LAUNCH = {
  agent: 'claude',
  target: { kind: 'existing', worktree: 'id:wt-7' },
  prompt: { text: 'resolve these threads', delivery: 'submit' }
}
const WINDOWS_POWERSHELL: LaunchHost = {
  paired: false,
  provesAgentInFront: false,
  takesLaunchFile: true,
  windowsPaneShell: 'pwsh.exe'
}
const WINDOWS_GIT_BASH: LaunchHost = { ...WINDOWS_POWERSHELL, windowsPaneShell: 'git-bash' }

function withPane(
  runtime: AgentLaunchRuntimeStub,
  pane: {
    foreground?: 'launched-agent' | 'other' | 'shell' | 'unknown'
    readyAt?: number
    shellAlone?: 'shell' | 'unknown'
  } = {}
) {
  const ready = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ satisfied: true, status: 'ready' }), pane.readyAt ?? 0)
    )
  const sendTerminalAgentPrompt = vi.fn(
    async (
      _handle: string,
      _text: string,
      options: { beforeWrite?: (ptyId: string) => Promise<void> }
    ) => {
      await options.beforeWrite?.('pty-1')
      return { handle: 'term_1', accepted: true, bytesWritten: 1 }
    }
  )
  return {
    runtime: Object.assign(runtime, {
      sendTerminalAgentPrompt,
      waitForTerminal: vi.fn(ready),
      waitForFreshWorkerComposer: vi.fn(ready),
      // Hooks off: the turn proof never arrives, so only the agent in front can prove the prompt.
      observeTerminalLaunchTurnStart: vi.fn(async () => 'unobserved'),
      getTerminalPromptRequestBinding: vi.fn(() => ({
        ptyId: 'pty-1',
        processIncarnation: 'i',
        generation: 1
      })),
      readTerminalForegroundVerdict: vi.fn(async () => pane.foreground ?? 'launched-agent'),
      readLaunchedAgentForeground: vi.fn(async () => pane.shellAlone ?? 'unknown'),
      launchedAgentHostProvesAgent: vi.fn(() => false),
      subscribeToTerminalData: vi.fn(() => () => {})
    }),
    sendTerminalAgentPrompt
  }
}

async function launch(runtime: AgentLaunchRuntimeStub, context = DESKTOP) {
  const parsed = AGENT_LAUNCH.params.safeParse(LAUNCH)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid')
  }
  return AGENT_LAUNCH.handler(parsed.data, rpcContext(runtime, context))
}

describe('a prompt the launch command carried', () => {
  it('is handed over on a POSIX host only once the launched agent is ready', async () => {
    const { runtime } = withPane(runtimeStub({ settings: {} }), { readyAt: 250 })
    const started = Date.now()

    const result = await launch(runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
    // The desktop runs its follow-up on this answer, so it never comes before the agent is ready.
    expect(Date.now() - started).toBeGreaterThanOrEqual(240)
  })

  it('is not delivered on a POSIX host whose agent exited at startup', async () => {
    let reads = 0
    const { runtime } = withPane(runtimeStub({ settings: {} }), { readyAt: 60_000 })
    Object.assign(runtime, {
      readTerminalForegroundVerdict: vi.fn(async () => (reads++ < 1 ? 'launched-agent' : 'shell'))
    })

    const result = await launch(runtime)

    expect(result.prompt).toEqual({
      delivery: 'submit',
      outcome: 'not-delivered',
      reason: 'agent-exited'
    })
  })

  it('is handed over on a Windows host at once, as main ran the follow-up after its paste', async () => {
    const { runtime } = withPane(runtimeStub({ settings: {}, launchHost: WINDOWS_POWERSHELL }), {
      foreground: 'unknown',
      readyAt: 60_000
    })

    const result = await launch(runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
    expect(runtime.readTerminalForegroundVerdict).not.toHaveBeenCalled()
  })

  it('keeps the phone’s answer: handed over at creation', async () => {
    const { runtime } = withPane(runtimeStub({ settings: {} }), { readyAt: 60_000 })

    const result = await launch(runtime, CAPABLE_CLIENT)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
    expect(runtime.readTerminalForegroundVerdict).not.toHaveBeenCalled()
  })
})

describe('a prompt the host pastes on a Windows pane', () => {
  it('is pasted on PowerShell unless its shell is proven in front, and handed over', async () => {
    const { runtime, sendTerminalAgentPrompt } = withPane(
      runtimeStub({ settings: {}, lineCarriesPrompt: false, launchHost: WINDOWS_POWERSHELL })
    )

    const result = await launch(runtime)

    expect(sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'handed-to-terminal' })
  })

  it('types nothing into a PowerShell its agent left at startup', async () => {
    const { runtime } = withPane(
      runtimeStub({ settings: {}, lineCarriesPrompt: false, launchHost: WINDOWS_POWERSHELL }),
      { shellAlone: 'shell' }
    )

    const result = await launch(runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'not-delivered' })
  })

  // Why: Git Bash keeps other processes in its shell's job, so a shell there is never proven alone.
  it('is refused on Git Bash, where nothing proves the agent in front', async () => {
    const { runtime } = withPane(
      runtimeStub({ settings: {}, lineCarriesPrompt: false, launchHost: WINDOWS_GIT_BASH })
    )

    const result = await launch(runtime)

    expect(result.prompt).toEqual({ delivery: 'submit', outcome: 'not-delivered' })
  })
})
