import { describe, expect, it } from 'vitest'
import { claudeStructuredExtraArgs } from './claude-structured-launch-args'

describe('Claude structured launch arguments', () => {
  it('translates long flags, equals values, and the model short flag', () => {
    expect(
      claudeStructuredExtraArgs([
        '--model',
        'opus',
        '--effort=high',
        '-m',
        'sonnet',
        '--chrome',
        '--add-dir',
        '/repo/other'
      ])
    ).toEqual({ model: 'sonnet', effort: 'high', chrome: null, 'add-dir': '/repo/other' })
  })

  it('removes SDK transport, permission, and lifecycle flags with their values', () => {
    expect(
      claudeStructuredExtraArgs([
        '-p',
        '--input-format',
        'text',
        '--output-format=json',
        '--json-schema',
        '{}',
        '--verbose',
        '-r',
        'other-session',
        '-c',
        '--session-id=other-session',
        '--fork-session',
        '--permission-mode',
        'bypassPermissions',
        '--dangerously-skip-permissions',
        '--allow-dangerously-skip-permissions',
        '--permission-prompt-tool',
        'other',
        '--replay-user-messages',
        '--include-partial-messages',
        '--setting-sources',
        'none',
        '--system-prompt',
        'replacement',
        '--append-system-prompt-file=other.txt',
        '--model',
        'opus'
      ])
    ).toEqual({ model: 'opus' })
  })

  it('ignores positional prompts and tokens after --', () => {
    expect(
      claudeStructuredExtraArgs(['prompt', '--model', 'opus', '--', '--effort', 'high'])
    ).toEqual({
      model: 'opus'
    })
  })
})
