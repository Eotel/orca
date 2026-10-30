import '../../orca-runtime-tests/orca-runtime-test-lifecycle.spec'
import { describe, expect, it, vi } from 'vitest'

import '../../orca-runtime-tests/runtime-test-module-registration.spec'
import { OrcaRuntimeService } from '../../orca-runtime'
import { store, syncSinglePty } from '../../orca-runtime-tests/orca-runtime-test-fixtures.spec'

describe('native Claude foreground identity', () => {
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
})
