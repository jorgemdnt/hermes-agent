import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { bindNotifiedSessionFocus } from '@/app/focus-notified-session'
import { group, split } from '@/components/pane-shell/tree/model'
import * as tree from '@/components/pane-shell/tree/store'
import { I18nProvider } from '@/i18n'
import { $notifications, clearNotifications, notify, notifyError } from '@/store/notifications'
import { $poolLimitsSettingsRequest } from '@/store/pool-limits'
import { $selectedStoredSessionId } from '@/store/session'
import { $sessionTiles, discardSessionTile } from '@/store/session-states'
import { stubResizeObserver } from '@/test/jsdom'

import { NotificationStack } from './notifications'

beforeAll(stubResizeObserver)

describe('toast titles', () => {
  beforeEach(() => {
    clearNotifications()
    $poolLimitsSettingsRequest.set(0)
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
    $poolLimitsSettingsRequest.set(0)
  })

  it.each(['default', 'bottom-right'] as const)(
    'caps the %s toast stack at one back edge and keeps older notifications reachable',
    async placement => {
      for (let index = 0; index < 7; index++) {
        notify({ id: `notice-${index}`, message: `Notice ${index}`, placement, durationMs: 0 })
      }

      render(<NotificationStack />)
      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(document.querySelectorAll('[data-slot="card-stack-edge"]')).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: /Show.*6/ }))
      expect(screen.getByText('Notice 0')).toBeTruthy()
      expect(screen.getAllByRole('status')).toHaveLength(7)
      fireEvent.click(screen.getAllByRole('button', { name: /Dismiss/ })[0])
      await waitFor(() => expect(screen.queryByText('Notice 6')).toBeNull())
    }
  )

  it('makes a local pool-slot timeout actionable without changing ordinary errors', () => {
    notifyError(
      new Error(
        `Error invoking remote method 'hermes:connection': Error: Local backend start for "research" timed out while waiting for a free slot.`
      ),
      'Failed to switch to profile "research"'
    )

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    expect(screen.getByText(/Too many bots are running at once/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open Advanced Settings' }))

    expect($poolLimitsSettingsRequest.get()).toBe(1)
    expect($notifications.get()).toHaveLength(0)

    notifyError(new Error('gateway unavailable'), 'Failed to switch profile')
    expect($notifications.get()[0]?.action).toBeUndefined()
  })

  it('keeps background pool-slot timeouts quiet if they reach the renderer', () => {
    notifyError(
      new Error('Local backend start for "background" timed out while waiting for a free slot. (background)'),
      'Background profile warm-up failed'
    )

    expect($notifications.get()[0]?.action).toBeUndefined()
  })
})

describe('toast body click', () => {
  let unbind: () => void
  const runtimeMap = new Map<string, string>([['stored-1', 'runtime-1']])

  beforeEach(() => {
    clearNotifications()
    window.localStorage.clear()

    for (const tile of $sessionTiles.get()) {
      discardSessionTile(tile.storedSessionId)
    }

    $selectedStoredSessionId.set('main-chat')
    tree.declareDefaultTree(group(['workspace'], { active: 'workspace', id: 'main' }))
    tree.$layoutTree.set(
      split('row', [
        group(['sessions', 'hermes-bots:pane'], { active: 'hermes-bots:pane', id: 'sidebar' }),
        group(['workspace'], { active: 'workspace', id: 'main' })
      ])
    )
    unbind = bindNotifiedSessionFocus({
      locationPathname: '/',
      navigate: () => undefined,
      runtimeMap: () => runtimeMap
    })
  })

  afterEach(() => {
    unbind()
    cleanup()
    clearNotifications()

    for (const tile of $sessionTiles.get()) {
      discardSessionTile(tile.storedSessionId)
    }

    $selectedStoredSessionId.set(null)
  })

  function opened(storedSessionId: string) {
    return $sessionTiles.get().some(tile => tile.storedSessionId === storedSessionId)
  }

  it('opens the session on a card click, and neither a session-less toast nor dismiss navigates', () => {
    notify({ durationMs: 0, id: 'saved', message: 'Settings saved' })
    render(<NotificationStack />)
    fireEvent.click(screen.getByText('Settings saved'))

    expect(opened('stored-1')).toBe(false)
    expect(tree.isPaneVisible('sessions')).toBe(false)

    act(() => {
      notify({ durationMs: 0, id: 'dismiss-me', kind: 'error', message: 'Also failed', sessionId: 'runtime-1' })
    })
    const dismissCard = screen.getByText('Also failed').closest('[data-slot="alert"]')

    if (!(dismissCard instanceof HTMLElement)) {
      throw new Error('dismiss toast did not render')
    }

    fireEvent.click(within(dismissCard).getByRole('button', { name: /Dismiss/ }))

    expect(opened('stored-1')).toBe(false)
    expect(tree.isPaneVisible('sessions')).toBe(false)

    act(() => {
      notify({ durationMs: 0, id: 'open-me', kind: 'error', message: 'Turn failed', sessionId: 'runtime-1' })
    })
    fireEvent.click(screen.getByText('Turn failed'))

    expect(opened('stored-1')).toBe(true)
    expect(opened('runtime-1')).toBe(false)
    expect(tree.isPaneVisible('sessions')).toBe(true)
  })

  it('runs an action button without opening the session', () => {
    let openedKeys = false

    notify({
      action: {
        label: 'Open Keys',
        onClick: () => {
          openedKeys = true
        }
      },
      durationMs: 0,
      kind: 'error',
      message: 'Need a key',
      sessionId: 'chat-keys'
    })
    render(<NotificationStack />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Keys' }))

    expect(openedKeys).toBe(true)
    expect(opened('chat-keys')).toBe(false)
    expect(tree.isPaneVisible('sessions')).toBe(false)
  })

  it('opens a bot chat from the roster callback instead of a stored session id', () => {
    let openedBot = false

    notify({
      durationMs: 0,
      message: 'Bot moved',
      onOpen: () => {
        openedBot = true
      }
    })
    render(<NotificationStack />)
    fireEvent.click(screen.getByText('Bot moved'))

    expect(openedBot).toBe(true)
    expect(opened('stored-1')).toBe(false)
    expect(tree.isPaneVisible('sessions')).toBe(false)
  })
})
