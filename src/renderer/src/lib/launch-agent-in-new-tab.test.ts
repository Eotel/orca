import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { MAX_LINE_PROMPT_BYTES } from '../../../shared/launch-prompt-file'

const mockCreateTab = vi.fn()
const mockQueueTabStartupCommand = vi.fn()
const mockSetActiveTabType = vi.fn()
const mockSetTabViewMode = vi.fn()
const mockSetTabBarOrder = vi.fn()
const mockSetAgentStatus = vi.fn()
const mockPasteDraftWhenAgentReady = vi.fn()
const mockSeedNativeChatLaunchPrompt = vi.fn()
const mockSeedNativeChatLaunchDraft = vi.fn()
const mockMarkNativeChatLaunchPromptFailed = vi.fn()
const mockTrack = vi.fn()
const mockToastMessage = vi.fn()
const mockWaitForAgentReady = vi.fn()
/** A launch the host delivers waits on its reply; most tests read only what was sent. */
const mockCallRuntimeRpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mockCallRuntimeRpc,
  RuntimeRpcCallError: Error
}))

function hostRequest(): Record<string, unknown> | undefined {
  return mockCallRuntimeRpc.mock.calls.find(([, method]) => method === 'agent.launchReplay')?.[2]
}

function hostReceipt(outcome: 'handed-to-terminal' | 'not-delivered') {
  return {
    outcome: { kind: 'terminal', handle: 'term_1', paneKey: 'tab:leaf' },
    worktreeId: 'wt-1',
    receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'x' },
    prompt: { delivery: 'submit', outcome }
  }
}

const store = {
  activeRepoId: 'repo-1',
  activeWorktreeId: 'wt-1',
  settings: {
    agentCmdOverrides: {},
    agentDefaultArgs: {} as Record<string, string>,
    agentDefaultEnv: {} as Record<string, Record<string, string>>,
    activeRuntimeEnvironmentId: null as string | null
  } as {
    agentCmdOverrides: Record<string, string>
    agentDefaultArgs: Record<string, string>
    agentDefaultEnv: Record<string, Record<string, string>>
    activeRuntimeEnvironmentId: string | null
    terminalWindowsShell?: string
    experimentalNativeChat?: boolean
    experimentalStructuredNativeChat?: boolean
    openAgentTabsInChatByDefault?: boolean
    nativeChatSessionOptions?: Record<
      string,
      { model?: string; valuesByModel?: Record<string, Record<string, string | boolean>> }
    >
  },
  projects: [
    {
      id: 'repo-1',
      localWindowsRuntimePreference: { kind: 'inherit-global' as const }
    }
  ] as {
    id: string
    localWindowsRuntimePreference:
      | { kind: 'inherit-global' }
      | { kind: 'windows-host' }
      | { kind: 'wsl'; distro: string | null }
  }[],
  repos: [{ id: 'repo-1', connectionId: null as string | null, path: '/repo' }],
  sshConnectionStates: new Map([['ssh-a', { status: 'connected' }]]),
  transientClearedAgentStatusConnectionIds: {} as Record<string, true>,
  worktreesByRepo: {
    'repo-1': [
      {
        id: 'wt-1',
        repoId: 'repo-1',
        projectId: 'repo-1',
        path: '/repo/worktree',
        displayName: 'main'
      }
    ]
  },
  allWorktrees: vi.fn(() => store.worktreesByRepo['repo-1']),
  tabsByWorktree: {
    'wt-1': [{ id: 'tab-1' }]
  },
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  terminalLayoutsByTabId: {} as Record<
    string,
    { activeLeafId: string | null; ptyIdsByLeafId?: Record<string, string> }
  >,
  ptyIdsByTabId: {} as Record<string, string[]>,
  createTab: mockCreateTab,
  closeTab: vi.fn(),
  queueTabStartupCommand: mockQueueTabStartupCommand,
  setActiveTabType: mockSetActiveTabType,
  setTabViewMode: mockSetTabViewMode,
  setTabBarOrder: mockSetTabBarOrder,
  setAgentStatus: mockSetAgentStatus,
  seedNativeChatLaunchPrompt: mockSeedNativeChatLaunchPrompt,
  seedNativeChatLaunchDraft: mockSeedNativeChatLaunchDraft,
  markNativeChatLaunchPromptFailed: mockMarkNativeChatLaunchPromptFailed
}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => store
  }
}))

const mockToastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { message: mockToastMessage, error: mockToastError }
}))

vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: vi.fn(
    (_stored, termIds: string[], editorIds: string[], browserIds: string[]) => [
      ...termIds,
      ...editorIds,
      ...browserIds
    ]
  )
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  pasteDraftWhenAgentReady: mockPasteDraftWhenAgentReady
}))

vi.mock('@/lib/agent-ready-wait', () => ({
  waitForAgentReady: mockWaitForAgentReady
}))

vi.mock('@/lib/telemetry', () => ({
  track: mockTrack,
  tuiAgentToAgentKind: (agent: string) => agent
}))

const mockCreateWebRuntimeSessionTerminal = vi.fn()
const mockCreateWebRuntimeAgentSessionTerminalWithLaunchDraft = vi.fn()
const mockIsWebRuntimeSessionActive = vi.fn(() => false)

vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionTerminal: mockCreateWebRuntimeSessionTerminal,
  createWebRuntimeAgentSessionTerminalWithLaunchDraft:
    mockCreateWebRuntimeAgentSessionTerminalWithLaunchDraft,
  isWebRuntimeSessionActive: mockIsWebRuntimeSessionActive,
  isWebTerminalSurfaceTabId: vi.fn(() => false)
}))

/** One click that launches Command Code in wt-1, a terminal-route agent. */
const COMMAND_CODE_CLICK = {
  requestId: 'command-code-click',
  agent: 'command-code',
  worktreeId: 'wt-1'
} as const

const CODEX_CLICK = { requestId: 'codex-click', agent: 'codex', worktreeId: 'wt-1' } as const
const CLAUDE_CLICK = { requestId: 'claude-click', agent: 'claude', worktreeId: 'wt-1' } as const

describe('launchAgentInNewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallRuntimeRpc.mockReturnValue(new Promise(() => {}))
    mockIsWebRuntimeSessionActive.mockReturnValue(false)
    mockCreateWebRuntimeSessionTerminal.mockResolvedValue({ status: 'created' })
    mockCreateWebRuntimeAgentSessionTerminalWithLaunchDraft.mockResolvedValue({ status: 'created' })
    store.activeRepoId = 'repo-1'
    store.activeWorktreeId = 'wt-1'
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null
    }
    store.projects = [
      {
        id: 'repo-1',
        localWindowsRuntimePreference: { kind: 'inherit-global' }
      }
    ]
    store.repos = [{ id: 'repo-1', connectionId: null, path: '/repo' }]
    store.sshConnectionStates = new Map([['ssh-a', { status: 'connected' }]])
    store.transientClearedAgentStatusConnectionIds = {}
    store.worktreesByRepo = {
      'repo-1': [
        {
          id: 'wt-1',
          repoId: 'repo-1',
          projectId: 'repo-1',
          path: '/repo/worktree',
          displayName: 'main'
        }
      ]
    }
    store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    store.openFiles = []
    store.browserTabsByWorktree = {}
    store.tabBarOrderByWorktree = {}
    store.terminalLayoutsByTabId = {}
    store.ptyIdsByTabId = {}
    mockCreateTab.mockReturnValue({ id: 'tab-1' })
    mockPasteDraftWhenAgentReady.mockResolvedValue(true)
    mockWaitForAgentReady.mockResolvedValue({ ready: true, reason: 'foreground-match' })
  })

  it('stamps the launched agent on the new tab for immediate provider icon bootstrap', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ requestId: 'request-1', agent: 'codex', worktreeId: 'wt-1' })

    expect(mockCreateTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'codex'
    })
  })
  it('keeps Floating Workspace authority on native Windows beside an active WSL project', async () => {
    store.projects = [
      {
        id: 'repo-1',
        localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu' }
      }
    ]
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-2',
      agent: 'codex',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      launchPlatform: 'win32'
    })

    expect(result).not.toBeNull()
    expect(mockIsWebRuntimeSessionActive).toHaveBeenLastCalledWith(null)
    expect(mockCreateWebRuntimeSessionTerminal).not.toHaveBeenCalled()
    expect(mockCreateTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      undefined,
      undefined,
      { launchAgent: 'codex' }
    )
  })

  // Why the host's tab: with chat the default, only the host can say whether this ends as a chat,
  // which would name its tab by the launch's pane; the window makes none it might have to take back.
  it('hands a prompted Codex launch to the host, which shows its tab when chat is the default', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-3',
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: 'large generated prompt',
      promptDelivery: 'submit-after-ready'
    })

    expect(result?.surface).toEqual({ kind: 'host-published' })
    expect(mockCreateTab).not.toHaveBeenCalled()
    expect(hostRequest()?.prompt).toEqual({
      text: 'large generated prompt',
      delivery: 'submit'
    })
    expect(mockQueueTabStartupCommand).not.toHaveBeenCalled()
    expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
  })

  it('opens the tab at the click and seeds its chat copy when a terminal is the default', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-4',
      agent: 'grok',
      worktreeId: 'wt-1',
      prompt: 'large generated prompt',
      promptDelivery: 'submit-after-ready'
    })

    const tabId = result?.surface.kind === 'local-terminal' ? result.surface.tabId : undefined
    expect(mockCreateTab).toHaveBeenCalledWith(
      'wt-1',
      undefined,
      undefined,
      expect.objectContaining({ id: tabId, launchAgent: 'grok', viewMode: 'chat' })
    )
    expect(mockSeedNativeChatLaunchPrompt).toHaveBeenCalledWith({
      tabId,
      agent: 'grok',
      text: 'large generated prompt',
      createdAt: expect.any(Number)
    })
    expect(mockSetTabViewMode).not.toHaveBeenCalled()
  })
  it('seeds no chat copy of a typed prompt, which the host may put in a launch file', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const prompt = 'y'.repeat(MAX_LINE_PROMPT_BYTES + 1)

    launchAgentInNewTab({ ...CODEX_CLICK, prompt, promptDelivery: 'auto-submit' })

    // Only its pointer would reach the transcript, so a copy here could never be pruned.
    expect(hostRequest()?.prompt).toEqual({ text: prompt, delivery: 'submit' })
    expect(mockSeedNativeChatLaunchPrompt).not.toHaveBeenCalled()
  })

  it('keeps Model-A SSH Grok launches in terminal mode', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    store.repos = [{ id: 'repo-1', connectionId: 'ssh-target-1', path: '/repo' }]
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ requestId: 'request-5', agent: 'grok', worktreeId: 'wt-1' })

    expect(mockCreateTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'grok',
      quickCommandLabel: undefined
    })
  })

  it('mirrors an argv-prefill draft into chat and opens the tab there', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-6',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: 'https://github.com/o/r/issues/12',
      promptDelivery: 'draft'
    })

    // Claude's --prefill launch seeds the draft without a paste callback.
    expect(result?.pasteDraftAfterLaunch).toBe(false)
    expect(mockSeedNativeChatLaunchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'tab-1',
        agent: 'claude',
        text: 'https://github.com/o/r/issues/12'
      })
    )
    expect(mockCreateTab.mock.calls[0]?.[3]).toHaveProperty('viewMode', 'chat')
  })

  it('mirrors a multi-line draft into chat and opens the tab there', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const prompt = 'Reproduce first\n\nhttps://github.com/o/r/issues/12'
    launchAgentInNewTab({
      requestId: 'request-7',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt,
      promptDelivery: 'draft'
    })

    expect(mockSeedNativeChatLaunchDraft).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 'tab-1', agent: 'claude', text: prompt })
    )
    expect(mockCreateTab.mock.calls[0]?.[3]).toHaveProperty('viewMode', 'chat')
  })

  it('passes quick command labels only to locally-created agent tabs', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-8',
      agent: 'codex',
      worktreeId: 'wt-1',
      quickCommandLabel: 'Review'
    })

    expect(mockCreateTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'codex',
      quickCommandLabel: 'Review'
    })
  })

  it('does not inject native-chat model preferences into terminal Quick Commands', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: { codex: '--profile team' },
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: false,
      nativeChatSessionOptions: {
        codex: {
          model: 'gpt-5.2-codex',
          valuesByModel: { 'gpt-5.2-codex': { effort: 'medium' } }
        }
      }
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-9',
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: 'Review this diff',
      launchSource: 'quick_command',
      quickCommandLabel: 'Review'
    })

    // The host applies the stored arguments itself; no chat model rides a terminal Quick Command.
    expect(hostRequest()).not.toHaveProperty('sessionOptions')
    expect(hostRequest()).not.toHaveProperty('agentArgs')
    expect(hostRequest()?.launchSource).toBe('quick_command')
  })

  it('applies native-chat model preferences to Quick Commands opened in chat', async () => {
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null,
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true,
      nativeChatSessionOptions: {
        codex: {
          model: 'gpt-5.2-codex',
          valuesByModel: { 'gpt-5.2-codex': { effort: 'medium' } }
        }
      }
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-10',
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: 'Review this diff',
      launchSource: 'quick_command',
      quickCommandLabel: 'Review'
    })

    expect(hostRequest()?.sessionOptions).toEqual({ model: 'gpt-5.2-codex', effort: 'medium' })
    expect(mockSetTabViewMode).not.toHaveBeenCalled()
  })

  it('preserves paired-host draft delivery and supported launch preferences', async () => {
    mockIsWebRuntimeSessionActive.mockReturnValue(true)
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: 'web-runtime',
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true,
      nativeChatSessionOptions: {
        claude: {
          model: 'opus',
          valuesByModel: { opus: { effort: 'high', fastMode: true } }
        }
      }
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      requestId: 'request-11',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: 'review before sending',
      promptDelivery: 'draft',
      agentArgs: '--permission-mode plan'
    })

    expect(result?.surface).toEqual({ kind: 'host-published' })
    expect(result?.pasteDraftAfterLaunch).toBe(false)
    expect(mockCreateWebRuntimeAgentSessionTerminalWithLaunchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        launchAgent: 'claude',
        prompt: 'review before sending',
        promptDelivery: 'draft',
        agentArgs: '--permission-mode plan',
        launchPreferences: { model: 'opus', effort: 'high' },
        agent: 'claude',
        launchDraft: 'review before sending'
      })
    )
    expect(mockCreateWebRuntimeSessionTerminal).not.toHaveBeenCalled()
    expect(mockCreateTab).not.toHaveBeenCalled()
  })

  it('propagates the default chat mode to paired web runtime launches', async () => {
    mockIsWebRuntimeSessionActive.mockReturnValue(true)
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: 'web-runtime',
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ requestId: 'request-12', agent: 'codex', worktreeId: 'wt-1' })

    expect(mockCreateWebRuntimeSessionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        environmentId: 'web-runtime',
        agentSessionKind: 'fresh',
        agent: 'codex',
        viewMode: 'chat'
      })
    )
  })

  it('propagates the resolved terminal mode to paired web runtime launches', async () => {
    mockIsWebRuntimeSessionActive.mockReturnValue(true)
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: 'web-runtime',
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: false
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ requestId: 'request-13', agent: 'codex', worktreeId: 'wt-1' })

    expect(mockCreateWebRuntimeSessionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        environmentId: 'web-runtime',
        agentSessionKind: 'fresh',
        agent: 'codex',
        viewMode: 'terminal'
      })
    )
  })

  it('surfaces a toast when host agent launch fails in paired web clients', async () => {
    mockIsWebRuntimeSessionActive.mockReturnValue(true)
    mockCreateWebRuntimeSessionTerminal.mockResolvedValue({
      status: 'failed',
      message: 'Upgrade the remote Orca host before starting or resuming agent sessions.'
    })
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: 'web-runtime'
    }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ requestId: 'request-14', agent: 'claude', worktreeId: 'wt-1' })

    await Promise.resolve()
    expect(mockToastError).toHaveBeenCalledWith(
      'Upgrade the remote Orca host before starting or resuming agent sessions.'
    )
    expect(mockSetActiveTabType).not.toHaveBeenCalled()
  })

  it('hands a Command Code prompt to the host, which reports working from the agent', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      ...COMMAND_CODE_CLICK,
      prompt: 'fix the spinner'
    })

    // Why no seeded row: the window no longer types the line, so it cannot vouch for the turn.
    expect(mockQueueTabStartupCommand).not.toHaveBeenCalled()
    expect(hostRequest()).toMatchObject({
      agent: 'command-code',
      prompt: { text: 'fix the spinner', delivery: 'submit' }
    })
  })

  it('does not track prompt-sent for draft launches', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-16',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: 'review this before sending',
      promptDelivery: 'draft'
    })

    expect(mockTrack).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it('falls back to post-ready draft paste when a Windows inline draft would be too large', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const prompt = 'x'.repeat(25_000)

    const result = launchAgentInNewTab({
      requestId: 'request-17',
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt,
      promptDelivery: 'draft',
      launchPlatform: 'win32'
    })

    expect(result).not.toHaveProperty('promptDeliveryResult')
    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        command: "claude '--dangerously-skip-permissions'"
      })
    )
    expect(mockPasteDraftWhenAgentReady).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'tab-1',
        content: prompt,
        agent: 'claude',
        submit: false,
        forcePaste: true
      })
    )
  })

  it('logs rejected non-deferred prompt delivery without exposing it to callers', async () => {
    const error = new Error('paste failed')
    const originalConsole = console
    const consoleError = vi.fn()
    vi.stubGlobal('console', { ...originalConsole, error: consoleError })
    mockPasteDraftWhenAgentReady.mockRejectedValue(error)
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const prompt = 'x'.repeat(25_000)

    try {
      const result = launchAgentInNewTab({
        requestId: 'request-18',
        agent: 'claude',
        worktreeId: 'wt-1',
        prompt,
        promptDelivery: 'draft',
        launchPlatform: 'win32'
      })

      expect(result).not.toHaveProperty('promptDeliveryResult')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(consoleError).toHaveBeenCalledWith('Prompt delivery failed after launch', error)
    } finally {
      vi.stubGlobal('console', originalConsole)
    }
  })

  it('hands a typed prompt past the argv ceiling to the host, which picks its launch file', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const prompt = `Session context:\n${'x'.repeat(MAX_LINE_PROMPT_BYTES)}`

    launchAgentInNewTab({ ...CODEX_CLICK, prompt, promptDelivery: 'auto-submit' })

    expect(mockPasteDraftWhenAgentReady).not.toHaveBeenCalled()
    expect(mockQueueTabStartupCommand).not.toHaveBeenCalled()
    expect(hostRequest()?.prompt).toEqual({ text: prompt, delivery: 'submit' })
  })

  it('reports a prompt the host did not deliver as undelivered', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    mockCallRuntimeRpc.mockResolvedValue(hostReceipt('not-delivered'))
    const onPromptDelivered = vi.fn()

    const result = launchAgentInNewTab({
      ...CLAUDE_CLICK,
      prompt: 'resolve these threads',
      promptDelivery: 'submit-after-ready',
      onPromptDelivered
    })

    await expect(result?.promptDeliveryResult).resolves.toMatchObject({ delivered: false })
    expect(onPromptDelivered).not.toHaveBeenCalled()
  })

  it("hands per-launch CLI arguments to the host with the caller's prompt", async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      requestId: 'request-26',
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: 'large generated prompt',
      agentArgs: '--model gpt-5.5',
      promptDelivery: 'submit-after-ready'
    })

    expect(hostRequest()).toMatchObject({
      agentArgs: '--model gpt-5.5',
      prompt: { text: 'large generated prompt', delivery: 'submit' }
    })
  })
})
