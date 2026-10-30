import { describe, expect, it } from 'vitest'
import { RuntimePtyForegroundAgent } from './runtime-pty-foreground-agent'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type { RuntimePtyWorktreeRecord } from '../records/runtime-terminal-state-records'

describe.skipIf(process.platform === 'win32')('native Claude foreground identity', () => {
  it('keeps native Claude identity when an old daemon cannot confirm its version name', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: RuntimePtyForegroundAgent reads only these fields of the record.
    const pty = {
      ptyId: 'pty-1',
      connected: true,
      launchAgent: null,
      foregroundAgent: null
    } as unknown as RuntimePtyWorktreeRecord
    let foregroundName = 'claude'
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the foreground agent calls only these two controller methods.
    const controller = {
      getForegroundProcess: async () => foregroundName,
      confirmForegroundProcess: async () => null
    } as unknown as RuntimePtyController
    const foreground = new RuntimePtyForegroundAgent({
      getController: () => controller,
      getPty: () => pty,
      touchSnapshot: () => {},
      finishDelayedSnapshot: () => {},
      pendingAttach: () => undefined
    })

    for (const name of ['claude', '2.1.295', 'claude', '2.1.295', '2.1.295']) {
      foregroundName = name
      await foreground.refresh('pty-1')
      expect(pty.foregroundAgent).toBe('claude')
    }

    foregroundName = 'zsh'
    await foreground.refresh('pty-1')
    expect(pty.foregroundAgent).toBeNull()
    foregroundName = '2.1.295'
    await foreground.refresh('pty-1')
    expect(pty.foregroundAgent).toBeNull()
  })
})
