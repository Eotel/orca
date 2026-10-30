import { describe, expect, it, vi } from 'vitest'
import { committingSpawn } from '../bind-first-pane.test-fixture'
import { OrcaRuntimeService } from '../orca-runtime-test-mocks.spec'
import { TEST_WORKTREE_PATH, store, syncSinglePty } from '../orca-runtime-test-fixtures.spec'

describe('terminal agent presence', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps native Claude identity across inventory refreshes',
    async () => {
      let foreground = '2.1.312'
      const confirmForegroundProcess = vi.fn(async () => 'claude')
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => foreground,
        confirmForegroundProcess
      })
      syncSinglePty(runtime, 'pty-1', { paneTitle: 'worker' })

      for (const name of ['2.1.312', '2.1.312', 'claude', '2.1.312']) {
        foreground = name
        await runtime.refreshPtyForegroundAgentFromController('pty-1')
        expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBe('claude')
      }
      expect(confirmForegroundProcess).toHaveBeenCalledOnce()
      foreground = 'zsh'
      await runtime.refreshPtyForegroundAgentFromController('pty-1')
      expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBeUndefined()
      confirmForegroundProcess.mockResolvedValue('vim')
      foreground = '2.1.312'
      await runtime.refreshPtyForegroundAgentFromController('pty-1')
      expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBeUndefined()
    }
  )
  it.skipIf(process.platform === 'win32')(
    'keeps native Claude identity when an old daemon cannot confirm its version name',
    async () => {
      let foreground = 'claude'
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => foreground,
        confirmForegroundProcess: async () => null
      })
      syncSinglePty(runtime, 'pty-1', { paneTitle: 'worker' })

      for (const name of ['claude', '2.1.295', 'claude', '2.1.295', '2.1.295']) {
        foreground = name
        await runtime.refreshPtyForegroundAgentFromController('pty-1')
        expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBe('claude')
      }

      foreground = 'zsh'
      await runtime.refreshPtyForegroundAgentFromController('pty-1')
      expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBeUndefined()
      foreground = '2.1.295'
      await runtime.refreshPtyForegroundAgentFromController('pty-1')
      expect((await runtime.listTerminals()).terminals[0].agentIdentity).toBeUndefined()
    }
  )
  it('finds an idle Claude by a fresh read when p_comm is its version directory', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-claude' })
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: committingSpawn(runtime, spawn),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => '2.1.310',
      confirmForegroundProcess: async () => 'claude'
    })
    const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
      command: 'claude',
      title: 'worker'
    })
    // Claude answered over OSC 7501 paints no title glyph.
    runtime.onPtyData('pty-claude', '\x1b]0;Orca worker dispatch task ok\x07', 1)

    await expect(runtime.isTerminalRunningAgent(handle)).resolves.toBe(true)
  })
})
