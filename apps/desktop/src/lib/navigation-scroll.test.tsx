import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { NavigationEntry } from '@/store/navigation-history'

import { captureNavigationScroll, restoreNavigationScroll, subscribeNavigationScrollRestore } from './navigation-scroll'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('restores the selected chat offset after browser relayout, not another mounted chat', () => {
  const entry: NavigationEntry = {
    route: '/',
    pane: 'session-tile:chat',
    session: 'chat',
    profile: 'default',
    mode: 'bots',
    owner: 'default',
    newSessionTarget: null,
    browserOpen: false
  }
  const { container } = render(
    <>
      <div data-session-anchor="workspace">
        <div data-slot="aui_thread-viewport" />
      </div>
      <div data-session-anchor="session-tile:chat">
        <div data-slot="aui_thread-viewport" />
      </div>
    </>
  )
  const viewports = container.querySelectorAll<HTMLElement>('[data-slot="aui_thread-viewport"]')
  const selected = viewports[1]
  Object.defineProperty(selected, 'checkVisibility', { value: () => true })
  Object.defineProperty(selected, 'clientHeight', { value: 200 })
  Object.defineProperty(selected, 'scrollHeight', { value: 1000 })
  selected.scrollTop = 123
  entry.scrollTop = captureNavigationScroll(entry)
  expect(entry.scrollTop).toBe(123)

  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  const cancel = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const settled = vi.fn()
  const restoreOwner = vi.fn((top: number) => {
    selected.scrollTop = top
  })
  const unsubscribe = subscribeNavigationScrollRestore(selected, restoreOwner)
  const stop = restoreNavigationScroll(entry, settled)
  selected.scrollTop = 500
  while (frames.length) frames.shift()!(0)
  expect(selected.scrollTop).toBe(123)
  expect(viewports[0].scrollTop).toBe(0)
  expect(settled).toHaveBeenCalledOnce()
  expect(restoreOwner).toHaveBeenCalledWith(123)
  unsubscribe()
  stop()
  expect(cancel).toHaveBeenCalledOnce()
})
