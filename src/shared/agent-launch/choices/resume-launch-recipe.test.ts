import { describe, expect, it } from 'vitest'
import { resolveResumeLaunchRecipe } from './resume-launch-recipe'
import type { AgentLaunchProfileSettings } from './tui-agent-launch-defaults'

const session = { key: 'session_id', id: 'abc' } as const

describe('resolveResumeLaunchRecipe without a recorded launch', () => {
  it('resumes a Claude that reported bypass with the bypass flag', () => {
    expect(
      resolveResumeLaunchRecipe(undefined, 'claude', {
        ...session,
        permissionMode: 'bypassPermissions'
      })
    ).toEqual({ agentArgs: '--dangerously-skip-permissions', agentEnv: {} })
  })

  it('resumes bare when the session reported another mode or none', () => {
    for (const permissionMode of ['default', undefined]) {
      expect(
        resolveResumeLaunchRecipe(undefined, 'claude', {
          ...session,
          ...(permissionMode ? { permissionMode } : {})
        })
      ).toEqual({ agentArgs: '', agentEnv: {} })
    }
  })
})

describe('resolveResumeLaunchRecipe with Settings defaults for an unrecorded launch', () => {
  const defaults = (settings: AgentLaunchProfileSettings) => ({
    settings,
    platform: 'darwin' as const
  })

  it('resumes with the configured Arguments, permission and env', () => {
    const recipe = resolveResumeLaunchRecipe(
      undefined,
      'claude',
      session,
      defaults({
        agentDefaultArgs: { claude: '--verbose' },
        agentDefaultEnv: { claude: { CLAUDE_DEFAULT_ONLY: '1' } },
        agentPermissionDefault: 'full-access'
      })
    )
    expect(recipe.agentArgs).toContain('--verbose')
    expect(recipe.agentArgs).toContain('--dangerously-skip-permissions')
    expect(recipe.agentEnv.CLAUDE_DEFAULT_ONLY).toBe('1')
  })

  it('keeps a reported bypass when Settings ask for permission', () => {
    const recipe = resolveResumeLaunchRecipe(
      undefined,
      'claude',
      { ...session, permissionMode: 'bypassPermissions' },
      defaults({
        agentDefaultArgs: { claude: '--verbose' },
        agentDefaultEnv: { claude: { CLAUDE_DEFAULT_ONLY: '1' } },
        agentPermissionDefault: 'ask'
      })
    )
    expect(recipe.agentArgs).toContain('--verbose')
    expect(recipe.agentArgs).toContain('--dangerously-skip-permissions')
    expect(recipe.agentEnv.CLAUDE_DEFAULT_ONLY).toBe('1')
  })

  it('still replays a recorded launch unchanged', () => {
    expect(
      resolveResumeLaunchRecipe(
        { agentArgs: '--model opus', agentEnv: { RECORDED: '1' } },
        'claude',
        session,
        defaults({
          agentDefaultArgs: { claude: '--verbose' },
          agentPermissionDefault: 'full-access'
        })
      )
    ).toEqual({ agentArgs: '--model opus', agentEnv: { RECORDED: '1' } })
  })
})
