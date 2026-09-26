// A profile renamed outside this window (`hermes profile rename frodo gandalf`) left its Bot
// Chat with two owner hints, local::frodo and local::gandalf. Two hints make the focused owner
// ambiguous (null), so the Bots row never highlighted the chat it had just opened.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileInfo } from '@/types/hermes'

const BOT_CHAT = '20260921_152831_599116'

function profile(name: string, previous_names?: string[]): ProfileInfo {
  return {
    has_env: false,
    is_default: name === 'default',
    model: null,
    name,
    path: `/h/${name}`,
    provider: null,
    skill_count: 0,
    ...(previous_names ? { previous_names } : {})
  }
}

describe('profile rename reconcile', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  async function setup() {
    const storage = await import('@/lib/storage')
    // The live window's persisted state: the pre-rename hint plus the one written on reopen.
    storage.writeJson('hermes.desktop.sessionOwnerHints.v1', [
      [BOT_CHAT, { connectionId: 'local', mode: 'local', profile: 'frodo', targetProfile: 'frodo' }],
      [BOT_CHAT, { connectionId: 'local', mode: 'local', profile: 'gandalf', targetProfile: 'gandalf' }]
    ])

    const { host } = await import('@/sdk/index')
    const session = await import('@/store/session')
    const { $profiles } = await import('@/store/profile')
    const reconcile = await import('./profile-rename-reconcile')

    session.setConnection({ connectionId: 'local', mode: 'local' } as never)
    session.$selectedStoredSessionId.set(BOT_CHAT)

    return { $profiles, host, reconcile, session }
  }

  it('re-homes a renamed profile so its open Bot Chat has one owner again', async () => {
    const { $profiles, host, reconcile, session } = await setup()

    expect(host.state.focusedSessionOwner.get()).toBeNull()

    const stop = reconcile.bindProfileRenameReconcile()
    $profiles.set([profile('default'), profile('gandalf', ['frodo']), profile('gimli')])

    expect(session.getSessionOwnerHints(BOT_CHAT)).toEqual([
      { connectionId: 'local', mode: 'local', profile: 'gandalf', targetProfile: 'gandalf' }
    ])
    expect(host.state.focusedSessionOwner.get()).toEqual({ connectionId: 'local', profile: 'gandalf' })
    stop()
  })

  it('does not re-home an old name that is a live profile again', async () => {
    const { reconcile } = await setup()

    expect(reconcile.pendingProfileRenames([profile('gandalf', ['frodo']), profile('frodo')])).toEqual([])
  })

  it('does not apply a remote profile list to local state', async () => {
    const { $profiles, reconcile, session } = await setup()
    session.setConnection({ connectionId: 'box', mode: 'remote' } as never)
    const stop = reconcile.bindProfileRenameReconcile()
    $profiles.set([profile('gandalf', ['frodo'])])

    expect(session.getSessionOwnerHints(BOT_CHAT)).toHaveLength(2)
    stop()
  })
})
