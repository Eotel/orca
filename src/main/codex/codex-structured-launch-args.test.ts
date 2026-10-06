import { describe, expect, it } from 'vitest'
import { codexStructuredLaunchArgs } from './codex-structured-launch-args'

describe('codexStructuredLaunchArgs', () => {
  it('preserves root config and feature option order', () => {
    expect(
      codexStructuredLaunchArgs([
        '-c',
        'model_reasoning_effort=high',
        '--enable',
        'unified_exec',
        '--config=web_search="live"',
        '--disable=some_feature',
        '-m',
        'gpt-5.6-sol'
      ])
    ).toEqual([
      '-c',
      'model_reasoning_effort=high',
      '--enable',
      'unified_exec',
      '--config=web_search="live"',
      '--disable=some_feature',
      '-m',
      'gpt-5.6-sol'
    ])
  })

  it('drops permission options and config overrides owned by Orca', () => {
    expect(
      codexStructuredLaunchArgs([
        '--dangerously-bypass-approvals-and-sandbox',
        '-a',
        'never',
        '--sandbox=danger-full-access',
        '--approve-for-me',
        '-c',
        'approval_policy="never"',
        '--config=sandbox_mode="danger-full-access"',
        '-c',
        'sandbox_workspace_write.writable_roots=["/tmp"]',
        '-c',
        '"sandbox_workspace_write".writable_roots=["/tmp"]',
        '-c',
        '\'approval_policy\'="never"',
        '-c',
        'model_reasoning_effort=high'
      ])
    ).toEqual(['-c', 'model_reasoning_effort=high'])
  })

  it('drops a profile and TUI-only path options without leaving their values as prompts', () => {
    expect(
      codexStructuredLaunchArgs([
        '--profile',
        'review',
        '-pother',
        '--cd',
        '/another/repo',
        '--worktree',
        '-c',
        'model_reasoning_effort=high'
      ])
    ).toEqual(['-c', 'model_reasoning_effort=high'])
  })

  it('discards operands after the option terminator', () => {
    expect(
      codexStructuredLaunchArgs(['-c', 'model_reasoning_effort=high', '--', 'a prompt'])
    ).toEqual(['-c', 'model_reasoning_effort=high'])
  })

  it.each([
    { tokens: ['a prompt'] },
    { tokens: ['app-server'] },
    { tokens: ['--remote', 'wss://host'] },
    { tokens: ['--remote=wss://host'] },
    { tokens: ['--remote-auth-token-env', 'TOKEN'] },
    { tokens: ['--unknown-flag'] },
    { tokens: ['--enable'] }
  ])('rejects unsafe or incomplete arguments: %j', ({ tokens }) => {
    expect(() => codexStructuredLaunchArgs(tokens)).toThrow()
  })
})
