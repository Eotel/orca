import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/orca-profiles/constants'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import type { ClaudeManagedAccount } from '../../shared/agent-accounts/managed-account-types'

import type { ClaudeCommandConfig, ClaudeCommandOptions } from './sign-in/claude-command-process'

import type { ClaudeAccountSelectionTarget } from './selection/runtime-selection'
import { ClaudeAccountService } from './service'

const spawnProcess = vi.hoisted(() => vi.fn())
vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnProcess
}))
vi.mock('../codex-cli/command', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveClaudeCommand: () => 'claude'
}))

// Selection checks must never reach the real Keychain.
vi.mock('../macos-keychain/generic-password', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readKeychainPassword: async () => null
}))

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function account(id: string, extra: Partial<ClaudeManagedAccount> = {}): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.test`,
    managedAuthPath: '',
    managedAuthRuntime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...extra
  }
}

function fixture(
  accounts: ClaudeManagedAccount[] = [account('a'), account('b')],
  options: { spawnClaude?: boolean; settings?: Partial<GlobalSettings> } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'claude-accounts-'))
  roots.push(root)
  const home = (id: string) => join(root, id, 'home')
  const signIn = (
    id: string,
    email: string,
    organizationUuid?: string,
    organizationName?: string
  ) => {
    mkdirSync(home(id), { recursive: true })
    writeFileSync(
      join(home(id), '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: email, organizationUuid, organizationName } })
    )
  }
  const covered = new Set<string>()
  let settings: GlobalSettings = {
    ...getDefaultSettings('/tmp'),
    claudeManagedAccounts: accounts,
    activeClaudeManagedAccountId: 'a',
    activeClaudeManagedAccountIdsByRuntime: { host: 'a', wsl: {} },
    ...options.settings
  }
  const runtimeAuth = {
    router: {
      accountHome: home,
      userConfigDir: () => join(root, 'personal'),
      systemDefaultHome: () => join(root, 'personal'),
      copiedLoginIntoSystemDefault: () => existsSync(join(root, 'claude-runtime-auth')),
      coveredBySystemDefault: (id: string) => covered.has(id)
    },
    syncForCurrentSelection: vi.fn(async (_target?: ClaudeAccountSelectionTarget) => {}),
    publishAll: vi.fn(async () => {}),
    prepareAccountFolder: vi.fn(async (id: string) => {
      mkdirSync(home(id), { recursive: true })
      return { configDir: home(id), readPath: home(id) }
    }),
    removeAccountFolder: vi.fn(async (id: string) => rmSync(join(root, id), { recursive: true })),
    getRuntimeConfigDir: () => '/unused'
  }
  const runLogin = vi.fn<
    (
      args: string[],
      config: ClaudeCommandConfig,
      timeoutMs: number,
      options?: ClaudeCommandOptions
    ) => Promise<string>
  >(async () => '')
  const service = new ClaudeAccountService(
    {
      getSettings: () => settings,
      updateSettings: (patch) => {
        settings = { ...settings, ...patch }
      }
    },
    {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn().mockResolvedValue(undefined)
    },
    runtimeAuth,
    options.spawnClaude ? undefined : runLogin
  )
  return { root, home, service, runtimeAuth, runLogin, signIn, covered, settings: () => settings }
}

describe('ClaudeAccountService', () => {
  it('names the login an account was added with once its folder signs in to another one', () => {
    const f = fixture([account('a', { organizationName: 'Work' }), account('b')])
    f.signIn('a', 'other@example.test')
    f.signIn('b', 'b@example.test')
    const listed = f.service.listAccounts().accounts
    expect(listed.find((entry) => entry.id === 'a')).toMatchObject({
      email: 'other@example.test',
      addedAs: { email: 'a@example.test', organizationName: 'Work' }
    })
    expect(listed.find((entry) => entry.id === 'b')?.addedAs).toBeUndefined()
  })
})
