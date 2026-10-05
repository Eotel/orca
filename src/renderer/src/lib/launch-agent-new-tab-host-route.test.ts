import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostAgentLaunchDelivery } from './agent-launch-through-host'

const TAB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const store: {
  tabsByWorktree: Record<string, { id: string }[]>
  markNativeChatLaunchPromptFailed: ReturnType<typeof vi.fn>
} = {
  tabsByWorktree: { 'wt-1': [{ id: TAB }] },
  markNativeChatLaunchPromptFailed: vi.fn()
}
vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))

const launchAgentThroughHost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/agent-launch-through-host', () => ({ launchAgentThroughHost }))
const notices = vi.hoisted(() => ({
  showAgentLaunchExitedNotice: vi.fn(),
  showAgentLaunchOutcomeNotice: vi.fn(),
  showAgentLaunchPromptNotDeliveredNotice: vi.fn(),
  showAgentLaunchPromptUnconfirmedNotice: vi.fn()
}))
vi.mock('@/lib/agent-launch-prompt-not-delivered-notice', () => notices)
const seedNativeChatLaunchPromptForAgentTab = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/agent-launch-prompt-delivery', () => ({ seedNativeChatLaunchPromptForAgentTab }))

const { launchNewTabPromptThroughHost, newTabPromptLaunchesThroughHost } =
  await import('./launch-agent-new-tab-host-route')

function launch(
  delivery: HostAgentLaunchDelivery,
  promptDelivery: 'auto-submit' | 'submit-after-ready' = 'submit-after-ready',
  onPromptDelivered = vi.fn()
) {
  launchAgentThroughHost.mockReturnValue({ tabId: TAB, delivery: Promise.resolve(delivery) })
  return launchNewTabPromptThroughHost({
    agent: 'claude',
    worktreeId: 'wt-1',
    prompt: 'resolve these threads',
    promptDelivery,
    onPromptDelivered
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.tabsByWorktree = { 'wt-1': [{ id: TAB }] }
})

describe('which new-tab prompts the host delivers', () => {
  it('sends a submitted prompt, and keeps a draft or an unsent after-start prompt', () => {
    const route = (
      agent: 'claude' | 'amp',
      promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
    ) => newTabPromptLaunchesThroughHost({ agent, prompt: 'p', promptDelivery })
    expect(route('claude', 'submit-after-ready')).toBe(true)
    expect(route('claude', 'auto-submit')).toBe(true)
    expect(route('amp', 'submit-after-ready')).toBe(true)
    expect(route('claude', 'draft')).toBe(false)
    expect(route('amp', 'auto-submit')).toBe(false)
    expect(
      newTabPromptLaunchesThroughHost({
        agent: 'claude',
        prompt: '',
        promptDelivery: 'auto-submit'
      })
    ).toBe(false)
  })
})

describe('a new-tab prompt the host delivers', () => {
  it('asks for a result the host can prove only when the caller acts on it', () => {
    launch({ kind: 'delivered' })
    expect(launchAgentThroughHost.mock.calls[0]?.[0]).toMatchObject({ confirmation: 'required' })
    launch({ kind: 'delivered' }, 'auto-submit')
    expect(launchAgentThroughHost.mock.calls[1]?.[0]).toMatchObject({ confirmation: 'best-effort' })
  })

  it('runs the follow-up only on a delivered prompt', async () => {
    const onPromptDelivered = vi.fn()
    await expect(
      launch({ kind: 'delivered' }, 'submit-after-ready', onPromptDelivered).promptDeliveryResult
    ).resolves.toEqual({ delivered: true, failureNotified: false })
    expect(onPromptDelivered).toHaveBeenCalledOnce()
  })

  it('hands back the prompt to copy when the agent started without it', async () => {
    const onPromptDelivered = vi.fn()
    await expect(
      launch({ kind: 'not-delivered', agentExited: false }, 'submit-after-ready', onPromptDelivered)
        .promptDeliveryResult
    ).resolves.toEqual({ delivered: false, failureNotified: true })
    expect(notices.showAgentLaunchPromptNotDeliveredNotice).toHaveBeenCalledOnce()
    expect(onPromptDelivered).not.toHaveBeenCalled()
    // The chat's optimistic copy is marked, so it never reads as sent.
    expect(store.markNativeChatLaunchPromptFailed).toHaveBeenCalledWith(TAB)
  })

  it('says the agent exited at startup, not that the prompt is owed a paste', async () => {
    await launch({ kind: 'not-delivered', agentExited: true }).promptDeliveryResult
    expect(notices.showAgentLaunchExitedNotice).toHaveBeenCalledOnce()
    expect(notices.showAgentLaunchPromptNotDeliveredNotice).not.toHaveBeenCalled()
  })

  it('warns against a second send when it cannot confirm, only to a caller that acts', async () => {
    await expect(launch({ kind: 'unconfirmed' }).promptDeliveryResult).resolves.toEqual({
      delivered: false,
      failureNotified: true
    })
    expect(notices.showAgentLaunchPromptUnconfirmedNotice).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    launch({ kind: 'unconfirmed' }, 'auto-submit')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notices.showAgentLaunchPromptUnconfirmedNotice).not.toHaveBeenCalled()
  })

  it('leaves a launch its pane explains to the pane alone', async () => {
    await expect(launch({ kind: 'pane-says' }).promptDeliveryResult).resolves.toEqual({
      delivered: false,
      failureNotified: true
    })
    for (const notice of Object.values(notices)) {
      expect(notice).not.toHaveBeenCalled()
    }
  })

  it("puts the pane's words in a notice when the tab had to go", async () => {
    await launch({ kind: 'not-started', unconfirmed: false, code: 'worktree_not_found' })
      .promptDeliveryResult
    expect(notices.showAgentLaunchOutcomeNotice).toHaveBeenCalledWith({
      outcome: { kind: 'not-started', code: 'worktree_not_found' },
      prompt: 'resolve these threads'
    })
  })

  it('tells nothing after the user closed the tab, and its agent with it', async () => {
    store.tabsByWorktree = { 'wt-1': [] }
    await expect(
      launch({ kind: 'not-delivered', agentExited: false }).promptDeliveryResult
    ).resolves.toEqual({ delivered: false, failureNotified: true })
    expect(notices.showAgentLaunchPromptNotDeliveredNotice).not.toHaveBeenCalled()
  })

  it("seeds the chat's copy only for a prompt the host never puts in a launch file", () => {
    launch({ kind: 'delivered' })
    expect(seedNativeChatLaunchPromptForAgentTab).toHaveBeenCalledWith({
      tabId: TAB,
      agent: 'claude',
      text: 'resolve these threads'
    })
    vi.clearAllMocks()
    launch({ kind: 'delivered' }, 'auto-submit')
    expect(seedNativeChatLaunchPromptForAgentTab).not.toHaveBeenCalled()
  })
})
