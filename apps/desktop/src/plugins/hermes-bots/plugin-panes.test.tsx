/**
 * Bot Mode's pane layout contract, asserted by running the real `register()`
 * against a recording plugin context:
 *
 *  - the Bots pane center-stacks into the sessions zone (a SESSIONS | BOTS tab
 *    strip), never splits below it, and carries the ENFORCED dock invariant so
 *    every boot re-homes a stacked install. No heal token, no user-placed
 *    exemption — the retired one-shot heal burned its token even when its
 *    guards skipped the move, so exactly the users who had dragged their panes
 *    stayed stacked forever;
 *  - the Scheduled jobs (internally `routines`) pane is never registered.
 *    Jobs stay on ⌘K (`nav.cron`). A leftover tile is stripped from persisted
 *    trees because its `placement: 'main'` made the right column count as chat.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import type { PluginContext } from '@hermes/plugin-sdk'
import { atom } from 'nanostores'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The app provider the plugin's tab label renders under; a plugin test may reach it.
// eslint-disable-next-line no-restricted-imports
import { I18nProvider } from '@/i18n'

import type * as DataModule from './data'
import type * as RoutingModule from './routing'

const mocks = vi.hoisted(() => ({
  botChatOwnsWorkspace: vi.fn(() => false),
  focusedId: 'sess-sessions',
  openBotCanonicalChat: vi.fn(),
  openSession: vi.fn(),
  newChat: vi.fn(),
  request: vi.fn(async () => ({ sessions: [{ id: 'sess-sessions' }] })),
  paneVisibility: vi.fn(),
  pinChatToLatest: vi.fn(),
  selectedRosterBot: vi.fn(() => null),
  sessionOwnsWorkspace: vi.fn(() => false),
  setWorkspaceScope: vi.fn(),
  undismissPane: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof HermesSdk>()

  return {
    ...original,
    host: {
      ...original.host,
      onEvent: undefined,
      openSession: mocks.openSession,
      newChat: mocks.newChat,
      request: mocks.request,
      paneVisibility: mocks.paneVisibility,
      setWorkspaceScope: mocks.setWorkspaceScope,
      undismissPane: mocks.undismissPane,
      state: {
        ...original.host.state,
        focusedStoredSessionId: {
          get: () => mocks.focusedId,
          listen: () => () => undefined
        }
      }
    }
  }
})

// Everything below is a boundary this test does not exercise: clocks, sockets,
// storage sweeps and the panes' own render trees.
vi.mock('./avatar', () => ({ startFaceClock: vi.fn(), stopFaceClock: vi.fn() }))
vi.mock('./relay', () => ({ startBotRelay: vi.fn(), stopBotRelay: vi.fn() }))
vi.mock('./session-sweep', () => ({ startHideSweepScheduler: vi.fn() }))
vi.mock('./canonical-chat', () => ({
  CANONICAL_CHAT_TITLE: 'Bot Chat',
  openBotCanonicalChat: mocks.openBotCanonicalChat,
  prepareBotSource: async () => undefined,
  notifyBotOpenFailure: vi.fn()
}))
vi.mock('./chat-empty', () => ({ BotChatEmpty: () => null }))
vi.mock('./hygiene', () => ({ annotateOrphanedGroupChatMembers: () => ({ changed: false, rooms: {} }) }))
vi.mock('./cron', () => ({ bindProfileSync: () => () => undefined, RoutinesPane: () => null }))
vi.mock('./roster-pane', () => ({
  botChatOwnsWorkspace: mocks.botChatOwnsWorkspace,
  BotsPane: () => null,
  releaseStaleOpenBotChat: vi.fn(),
  selectedRosterBot: mocks.selectedRosterBot,
  sessionOwnsWorkspace: mocks.sessionOwnsWorkspace
}))
vi.mock('./group-chat', async () => {
  const { atom: nanoAtom } = await import('nanostores')

  return {
    $groupChats: nanoAtom({}),
    $groupChatWorkspace: nanoAtom(null),
    assignLegacyThreads: (log: unknown[]) => log,
    handleSessionsGatewayTransition: vi.fn(),
    pullGroupChatServerState: async () => false,
    scheduleGroupChatServerSync: vi.fn(),
    setGroupChatSyncDisposed: vi.fn(),
    stopGroupChatServerSync: vi.fn(),
    sweepGroupChatMembersForRemovedConnection: vi.fn(),
    updateGroupChat: vi.fn()
  }
})
vi.mock('./data', async importOriginal => {
  const original = await importOriginal<typeof DataModule>()

  return { ...original, migrateBotMeta: async () => undefined }
})
vi.mock('./routing', async importOriginal => {
  const original = await importOriginal<typeof RoutingModule>()

  return { ...original, setBotsWorkspaceOwner: vi.fn() }
})
vi.mock('@/store/thread-scroll', async importOriginal => {
  const original = await importOriginal<typeof import('@/store/thread-scroll')>()

  return { ...original, pinChatToLatest: mocks.pinChatToLatest }
})

const plugin = (await import('./plugin')).default

interface Registration {
  area: string
  data?: Record<string, unknown>
  id: string
}

/** A recording `PluginContext`: registrations, their disposers, teardown. */
function recordingContext() {
  const disposers: (() => void)[] = []
  const registrations: Registration[] = []
  const unregisters = new Map<string, () => void>()

  const ctx = {
    i18n: { register: () => () => undefined, t: (key: string) => key },
    onDispose: (fn: () => void) => disposers.push(fn),
    register: (registration: Registration) => {
      registrations.push(registration)

      const unregister = vi.fn(() => {
        registrations.splice(registrations.indexOf(registration), 1)
      })

      unregisters.set(registration.id, unregister)

      return unregister
    },
    storage: { get: async () => undefined, set: async () => undefined }
  }

  return {
    ctx: ctx as unknown as PluginContext,
    dispose: () => disposers.forEach(fn => fn()),
    find: (id: string) => registrations.find(registration => registration.id === id),
    unregisters
  }
}

/** Nanostore stand-ins for the SDK's per-pane visibility stores. */
function paneStores() {
  const stores = new Map<string, ReturnType<typeof atom<boolean>>>()

  mocks.paneVisibility.mockImplementation((id: string) => {
    if (!stores.has(id)) {
      stores.set(id, atom(false))
    }

    return stores.get(id)
  })

  return (id: string) => {
    mocks.paneVisibility(id)

    return stores.get(id)!
  }
}

/** The plugin defers one reconcile to a macrotask so it never re-enters the
 *  tree store mid-mutation. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.botChatOwnsWorkspace.mockReturnValue(false)
  mocks.sessionOwnsWorkspace.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Bots pane dock', () => {
  it('center-stacks into the sessions zone as a standing invariant', () => {
    paneStores()

    const harness = recordingContext()

    plugin.register(harness.ctx)

    const data = harness.find('pane')!.data!

    expect(data.dock).toEqual({ enforce: true, pane: 'sessions', pos: 'center' })
    // A 'bottom' split was the old workaround for the lone-pane auto-hide trap.
    expect((data.dock as { pos: string }).pos).not.toBe('bottom')
    // No heal token: the invariant runs at every adoption, unconditionally.
    expect(data).not.toHaveProperty('heal')

    harness.dispose()
  })

  it('renders its tab label from the live locale, not the register-time string', () => {
    paneStores()

    const harness = recordingContext()

    // Registration runs at module import, before the app has loaded
    // `display.language`: the string `title` is English here no matter what.
    plugin.register(harness.ctx)

    const tabTitle = harness.find('pane')!.data!.tabTitle as () => ReactNode
    const inLocale = (locale: string) =>
      renderToStaticMarkup(
        <I18nProvider configClient={null} initialLocale={locale}>
          {tabTitle()}
        </I18nProvider>
      )

    expect(inLocale('ru')).toBe('Боты')
    expect(inLocale('en')).toBe('Bots')

    harness.dispose()
  })
})

describe('the Scheduled jobs pane', () => {
  it('is never registered — scheduled jobs stay on ⌘K', async () => {
    const store = paneStores()
    const harness = recordingContext()

    mocks.botChatOwnsWorkspace.mockReturnValue(true)
    plugin.register(harness.ctx)
    await settle()
    store(`hermes-bots:pane`).set(true)
    await settle()

    expect(harness.find('routines')).toBeUndefined()

    harness.dispose()
  })
})

describe('a desktop without host.paneVisibility', () => {
  it('still does not register Scheduled jobs', async () => {
    const { host } = await import('@hermes/plugin-sdk')
    const restore = host.paneVisibility

    // @ts-expect-error modelling an older SDK that lacks the export entirely
    host.paneVisibility = undefined

    const harness = recordingContext()

    plugin.register(harness.ctx)

    expect(harness.find('routines')).toBeUndefined()

    harness.dispose()
    host.paneVisibility = restore
  })
})

describe('Sessions | Bots tab focus', () => {
  it('opens the selected bot chat when the Bots tab is shown', async () => {
    const bot = { name: 'coder', canonical_session: { id: 'bot-chat' } }
    mocks.selectedRosterBot.mockReturnValue(bot)
    const store = paneStores()
    const harness = recordingContext()

    plugin.register(harness.ctx)
    await settle()
    store('hermes-bots:pane').set(true)
    await settle()

    expect(mocks.openBotCanonicalChat.mock.calls[0]?.[0]).toEqual(bot)
    expect(mocks.pinChatToLatest).toHaveBeenCalledWith('bot-chat')

    harness.dispose()
  })

  it('reopens the Sessions chat when leaving Bots', async () => {
    mocks.focusedId = 'sess-sessions'
    mocks.selectedRosterBot.mockReturnValue({ name: 'coder' })
    const store = paneStores()
    const harness = recordingContext()

    plugin.register(harness.ctx)
    await settle()
    store('hermes-bots:pane').set(true)
    await settle()
    store('hermes-bots:pane').set(false)
    await settle()

    expect(mocks.setWorkspaceScope).toHaveBeenCalledWith('sessions')
    expect(mocks.openSession).toHaveBeenCalledWith('sess-sessions')
    expect(mocks.pinChatToLatest).toHaveBeenCalledWith('sess-sessions')
    expect(mocks.newChat).not.toHaveBeenCalled()

    harness.dispose()
  })

  it('opens a new chat when every Sessions row is archived', async () => {
    const { $freshSessionRequest, $newChatProfile } = await import('@/store/profile')
    const drafts = $freshSessionRequest.get()
    mocks.focusedId = 'archived-sess'
    mocks.request.mockResolvedValue({ sessions: [] })
    mocks.selectedRosterBot.mockReturnValue({ name: 'coder' })
    const store = paneStores()
    const harness = recordingContext()

    plugin.register(harness.ctx)
    await settle()
    store('hermes-bots:pane').set(true)
    await settle()
    store('hermes-bots:pane').set(false)
    await settle()

    expect(mocks.setWorkspaceScope).toHaveBeenCalledWith('sessions')
    expect(mocks.openSession).not.toHaveBeenCalled()
    expect(mocks.newChat).not.toHaveBeenCalled()
    expect($newChatProfile.get()).toBeNull()
    expect($freshSessionRequest.get()).toBe(drafts + 1)

    harness.dispose()
  })
})
