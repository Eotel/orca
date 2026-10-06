import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { RuntimeRepositoryRefQueries } from './runtime-repository-ref-queries'

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../providers/ssh-git-dispatch', () => ({ getSshGitProvider: getProvider }))

const repo: Repo = {
  id: 'remote-repo',
  path: '/repo',
  displayName: 'remote',
  badgeColor: 'blue',
  addedAt: 1,
  connectionId: 'ssh-1'
}

describe('qualified refs in repository searches', () => {
  it.each(['feature', 'origin/feature'])(
    'fills legacy pages before the limit for query %s',
    async (query) => {
      const exec = vi.fn(async (argv: string[]) => ({
        stdout:
          argv[0] === 'remote'
            ? 'origin\n'
            : [
                'refs/heads/feature/加\0feature/�',
                'refs/remotes/origin/feature/加\0origin/feature/�',
                'refs/heads/feature/one\0feature/one',
                'refs/heads/feature/two\0feature/two',
                'refs/heads/feature/three\0feature/three'
              ].join('\n'),
        stderr: ''
      }))
      getProvider.mockReturnValue({ exec })
      const queries = new RuntimeRepositoryRefQueries({ resolveRepo: async () => repo })
      expect(await queries.search('id:remote-repo', query, 2, false)).toEqual({
        refs: ['feature/one', 'feature/two'],
        refDetails: [
          { refName: 'feature/one', localBranchName: 'feature/one' },
          { refName: 'feature/two', localBranchName: 'feature/two' }
        ],
        truncated: true
      })
      expect(await queries.search('id:remote-repo', query, 2)).toMatchObject({
        refs: ['refs/heads/feature/加', 'refs/remotes/origin/feature/加'],
        truncated: true
      })
      expect(exec).toHaveBeenCalledWith(expect.arrayContaining(['--count=12']), '/repo')
    }
  )

  it('keeps folder workspaces outside Git searches', async () => {
    vi.mocked(getSshGitProvider).mockClear()
    const queries = new RuntimeRepositoryRefQueries({
      resolveRepo: async () => ({ ...repo, kind: 'folder' })
    })
    expect(await queries.search('id:remote-repo', 'feature', 2, false)).toEqual({
      refs: [],
      truncated: false
    })
    expect(getSshGitProvider).not.toHaveBeenCalled()
  })
})
