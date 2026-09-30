import { render } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'

import type { NavigationEntry } from '@/store/navigation-history'
import type { ThreadScrollState } from '@/store/thread-scroll'

import { restoreNavigationScroll } from './navigation-scroll'
import { useNavigationScrollRestore } from './use-navigation-scroll-restore'

it('restores a late-mounted cached transcript, then hands intent to its live controller', () => {
  const scrollRef = createRef<HTMLElement>()
  const restoreRef = createRef<(target?: ThreadScrollState) => void>()
  const stopScroll = vi.fn(() => scrollRef.current?.scrollTop)
  function Owner() {
    useNavigationScrollRestore(scrollRef, restoreRef, stopScroll, true)
    return null
  }
  const view = render(<Owner />)
  const surface = document.createElement('div')
  surface.dataset.sessionAnchor = 'session-tile:chat'
  const element = document.createElement('div')
  element.dataset.slot = 'aui_thread-viewport'
  Object.defineProperty(element, 'checkVisibility', { value: () => true })
  Object.defineProperty(element, 'clientHeight', { value: 200 })
  Object.defineProperty(element, 'scrollHeight', { value: 1000 })
  surface.append(element)
  document.body.append(surface)
  scrollRef.current = element
  const entry: NavigationEntry = {
    route: '/',
    pane: 'session-tile:chat',
    session: 'chat',
    profile: 'default',
    mode: 'bots',
    owner: 'default',
    newSessionTarget: null,
    browserOpen: false,
    scrollTop: 123
  }
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  try {
    element.scrollTop = 500
    restoreNavigationScroll(entry, vi.fn())
    while (frames.length) frames.shift()!(0)
    expect(element.scrollTop).toBe(123)
    expect(stopScroll.mock.results[0].value).toBe(500)
    const coldStops = stopScroll.mock.calls.length

    const liveRestore = vi.fn((target?: ThreadScrollState) => {
      if (target?.kind === 'offset') element.scrollTop = element.scrollHeight - element.clientHeight - target.fromBottom
    })
    restoreRef.current = liveRestore
    element.scrollTop = 500
    entry.scrollTop = 222
    restoreNavigationScroll(entry, vi.fn())
    while (frames.length) frames.shift()!(0)
    expect(liveRestore).toHaveBeenCalled()
    expect(element.scrollTop).toBe(222)
    expect(stopScroll.mock.calls.length).toBe(coldStops)
  } finally {
    view.unmount()
    surface.remove()
    vi.unstubAllGlobals()
  }
})
