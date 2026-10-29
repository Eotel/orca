import { describe, expect, it } from 'vitest'
import { createRuntime, syncSinglePty } from './orca-runtime-tests/orca-runtime-test-fixtures.spec'

describe('hidden-output recovery after provider reattach', () => {
  it('shows a Codex wait from the current adopted provider screen', async () => {
    const runtime = createRuntime()
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => 'codex',
      serializeProviderBuffer: async () => ({
        data: '\x1b[?1049hDo you trust this workspace directory?\r\n1. Yes\r\n2. No',
        cols: 80,
        rows: 24,
        seq: 1000,
        source: 'headless',
        alternateScreen: true
      })
    })
    syncSinglePty(runtime, 'pty-1', { paneTitle: 'Codex' })
    runtime.synchronizePtyOutputSequenceFromProvider('pty-1', {
      value: 1000,
      generation: 'continued'
    })
    await runtime.refreshPtyForegroundAgentFromController('pty-1')
    const [terminal] = (await runtime.listTerminals()).terminals

    await expect(runtime.showTerminal(terminal.handle)).resolves.toMatchObject({
      agentWait: { reason: 'agent-trust-workspace' }
    })
  })

  it('does not use a renderer frame superseded by live output', async () => {
    const runtime = createRuntime()
    syncSinglePty(runtime, 'pty-1')
    runtime.onPtyData('pty-1', '\n'.repeat(3000), 100)
    runtime.synchronizePtyOutputSequenceFromProvider('pty-1', {
      value: 1000,
      generation: 'continued'
    })
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      serializeProviderBuffer: async () => ({
        data: '\x1b[?1049hOld provider frame',
        cols: 80,
        rows: 24,
        seq: 1000,
        source: 'headless',
        alternateScreen: true
      }),
      hasRendererSerializer: () => true,
      serializeBuffer: async () => ({ data: 'Old renderer frame', cols: 80, rows: 24, seq: 900 })
    })
    const [terminal] = (await runtime.listTerminals()).terminals

    const read = await runtime.readTerminal(terminal.handle)
    expect(read.tail.join('\n')).not.toContain('Old renderer frame')
  })

  it('reads a quiet adopted shell after an older provider frame was rejected', async () => {
    const runtime = createRuntime()
    let sequence = 990
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      serializeProviderBuffer: async () => ({
        data: 'shell prompt$ ',
        cols: 80,
        rows: 24,
        seq: sequence,
        source: 'headless',
        alternateScreen: false
      })
    })
    syncSinglePty(runtime, 'pty-1')
    runtime.synchronizePtyOutputSequenceFromProvider('pty-1', {
      value: 1000,
      generation: 'continued'
    })
    const [terminal] = (await runtime.listTerminals()).terminals

    await expect(runtime.readTerminal(terminal.handle, { screen: true })).resolves.toMatchObject({
      source: 'screen-unavailable'
    })
    sequence = 1000
    await expect(runtime.readTerminal(terminal.handle, { screen: true })).resolves.toMatchObject({
      source: 'screen',
      tail: ['shell prompt$']
    })
  })

  it('reads the full provider screen when the adopted shell model has only a live suffix', async () => {
    const runtime = createRuntime()
    syncSinglePty(runtime, 'pty-1')
    runtime.onPtyData('pty-1', 'suffix', 100)
    runtime.synchronizePtyOutputSequenceFromProvider('pty-1', {
      value: 1000,
      generation: 'continued'
    })
    let sequence = 1000
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      serializeProviderBuffer: async () => ({
        data: 'full screen with suffix',
        cols: 80,
        rows: 24,
        seq: sequence,
        source: 'headless',
        alternateScreen: false
      })
    })
    const [terminal] = (await runtime.listTerminals()).terminals
    await runtime.readTerminal(terminal.handle, { screen: true })
    sequence = 1006
    await expect(runtime.readTerminal(terminal.handle, { screen: true })).resolves.toMatchObject({
      source: 'screen',
      tail: ['full screen with suffix']
    })
  })
})
