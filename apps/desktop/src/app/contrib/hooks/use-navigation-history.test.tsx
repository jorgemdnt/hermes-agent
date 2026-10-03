import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { HashRouter, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { openSession } from '@/app/open-session'
import { subscribeNavigationScrollRestore } from '@/lib/navigation-scroll'
import { navigationHistory, travelNavigation } from '@/store/navigation-history'
import { focusedSessionWorkspaceScope } from '@/store/session-states'

import { useNavigationHistory } from './use-navigation-history'

vi.mock('@/app/open-session', () => ({ openSession: vi.fn() }))
vi.mock('@/app/routes', () => ({ isWorkspacePageRoute: (path: string) => path.startsWith('/kanban') }))
vi.mock('@/components/pane-shell/tree/store', () => ({ isPaneVisible: () => true, revealTreePane: vi.fn() }))
vi.mock('@/components/pane-shell/workspace-scope', async () => {
  const { atom } = await import('nanostores')
  return {
    $workspaceMode: atom('bots'),
    $workspaceOwnerKey: atom(null),
    $workspaceNewSessionTarget: atom(null),
    setWorkspaceScope: vi.fn()
  }
})
vi.mock('@/store/connections', async () => ({ $activeConnectionId: (await import('nanostores')).atom('local') }))
vi.mock('@/store/profile', async () => ({
  $activeProfile: (await import('nanostores')).atom('default'),
  switchProfile: vi.fn()
}))
vi.mock('@/store/session-focus', async () => ({
  $focusedTreePaneId: (await import('nanostores')).atom('workspace'),
  $focusedStoredSessionId: (await import('nanostores')).atom('qa-session')
}))
vi.mock('@/store/session-states', async () => ({
  focusedSessionWorkspaceScope: () => ({
    ownerRoute: { connectionId: 'owner-connection', profile: 'owner-profile' },
    workspaceMode: 'bots',
    workspaceOwnerKey: 'bot:default',
    workspaceTabTitle: 'Bot Chat'
  })
}))
vi.mock('@/store/layout', async () => {
  const { atom } = await import('nanostores')
  return {
    $fileBrowserOpen: atom(false),
    $rightRailActiveTabId: atom('browser'),
    selectRightRailTab: vi.fn(),
    setFileBrowserOpen: vi.fn()
  }
})
vi.mock('@/store/preview', async () => {
  const { atom } = await import('nanostores')
  return { $browserPages: atom({}), $previewTabs: atom([]), commitBrowserTabLocation: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps the pending restore alive when HashRouter changes navigate identity during replay', async () => {
  vi.useFakeTimers()
  window.location.hash = '#/'
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  function Host() {
    useNavigationHistory()
    const navigate = useNavigate()
    return <button onClick={() => navigate('/kanban?task=t_12345678')}>Open card</button>
  }
  const surface = document.createElement('div')
  surface.dataset.sessionAnchor = 'workspace'
  const element = document.createElement('div')
  element.dataset.slot = 'aui_thread-viewport'
  Object.defineProperty(element, 'checkVisibility', { value: () => true })
  Object.defineProperty(element, 'clientHeight', { value: 200 })
  Object.defineProperty(element, 'scrollHeight', { value: 1000 })
  surface.append(element)
  document.body.append(surface)
  const restore = vi.fn((top: number) => {
    element.scrollTop = top
  })
  const unsubscribe = subscribeNavigationScrollRestore(() => element, restore)
  try {
    const view = render(
      <HashRouter>
        <Host />
      </HashRouter>
    )
    await act(() => vi.advanceTimersByTimeAsync(0))
    navigationHistory.update({ ...navigationHistory.current!, scrollTop: 123 })
    fireEvent.click(view.getByRole('button', { name: 'Open card' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(navigationHistory.current?.route).toContain('/kanban')
    element.scrollTop = 500
    await act(() => travelNavigation(-1))
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => {
      while (frames.size) {
        const [frame, callback] = frames.entries().next().value!
        frames.delete(frame)
        callback(0)
      }
    })
    expect(window.location.hash).toBe('#/')
    expect(restore).toHaveBeenCalledWith(123, element)
    expect(element.scrollTop).toBe(123)
    expect(openSession).toHaveBeenLastCalledWith(
      'qa-session',
      expect.any(Function),
      'in-place',
      focusedSessionWorkspaceScope()
    )

    const focusPane = vi.fn()
    element.addEventListener('pointerdown', focusPane)
    const forward = new MouseEvent('pointerdown', { button: 4, bubbles: true, cancelable: true })
    await act(() => element.dispatchEvent(forward))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(focusPane).not.toHaveBeenCalled()
    expect(forward.defaultPrevented).toBe(true)
    expect(window.location.hash).toContain('/kanban')
    for (const type of ['pointerup', 'mouseup', 'auxclick']) {
      const release = new MouseEvent(type, { button: 4, bubbles: true, cancelable: true })
      await act(() => element.dispatchEvent(release))
      expect(release.defaultPrevented).toBe(true)
    }
    expect(window.location.hash).toContain('/kanban')
  } finally {
    unsubscribe()
    surface.remove()
  }
})
