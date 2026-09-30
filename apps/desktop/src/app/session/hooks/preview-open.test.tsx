import type { GatewayEvent } from '@hermes/shared'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantTextPart, type ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $rightRailActiveTabId } from '@/store/layout'
import {
  $browserPages,
  $previewTabs,
  $previewTabsBySession,
  $previewTarget,
  applyPreviewFocus,
  closeRightRail,
  markBrowserTabPopped,
  newBrowserTab,
  noteBrowserPage,
  openPreview,
  type PreviewTarget
} from '@/store/preview'
import { $activeSessionId, $currentCwd, $messages, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import { pruneOffscreenSessionPreviews, usePreviewRouting } from './use-preview-routing'

const RUNTIME_SESSION_ID = '20260727_140707_edec2d'

function assistantMessage(id: string, text: string): ChatMessage {
  return { id, parts: [assistantTextPart(text)], role: 'assistant' }
}

function fileTarget(path: string): PreviewTarget {
  return { kind: 'file', label: path, path, previewKind: 'html', source: path, url: `file://${path}` }
}

function urlTarget(url: string) {
  return { kind: 'url', label: url, source: url, url } satisfies PreviewTarget
}

let handleEvent: (event: GatewayEvent) => void = () => undefined

function Harness() {
  const routing = usePreviewRouting({
    baseHandleGatewayEvent: vi.fn(),
    currentCwd: '/work',
    requestGateway: vi.fn()
  })

  useEffect(() => {
    handleEvent = routing.handleDesktopGatewayEvent
  }, [routing.handleDesktopGatewayEvent])

  return null
}

async function emitPreviewOpen(url = '/tmp/artifact-test.html', sessionId = RUNTIME_SESSION_ID) {
  await act(async () => {
    handleEvent({
      payload: { label: 'hi bestie', url },
      session_id: sessionId,
      type: 'preview.open'
    } as unknown as GatewayEvent)
  })
}

async function emitPreviewClose(url?: string, sessionId = RUNTIME_SESSION_ID) {
  await act(async () => {
    handleEvent({
      payload: url === undefined ? {} : { url },
      session_id: sessionId,
      type: 'preview.close'
    } as unknown as GatewayEvent)
  })
}

describe('preview routing', () => {
  beforeEach(() => {
    // A live session always has a runtime id; only the STORED id lags.
    $activeSessionId.set(RUNTIME_SESSION_ID)
    $currentCwd.set('/work')
    $messages.set([])
    $browserPages.set({})
    $selectedStoredSessionId.set(null)
    $sessionTiles.set([])
    $previewTabsBySession.set({ activeBySession: {}, tabs: {} })
    applyPreviewFocus({ runtimeId: RUNTIME_SESSION_ID, storedId: null })
    closeRightRail()
    window.localStorage.clear()

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        normalizePreviewTarget: vi.fn(async (target: string) =>
          /^https?:\/\//.test(target) ? urlTarget(target) : fileTarget(target)
        )
      }
    })
  })

  afterEach(() => {
    cleanup()
    $messages.set([])
    $browserPages.set({})
    closeRightRail()
    $activeSessionId.set(null)
    $selectedStoredSessionId.set(null)
    $sessionTiles.set([])
    $previewTabsBySession.set({ activeBySession: {}, tabs: {} })
    applyPreviewFocus({ runtimeId: null, storedId: null })
    closeRightRail()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('open_preview', () => {
    // The rail used to hold a session-keyed singleton alongside its tabs, written
    // under one session-id rule and reconciled under another. A live session with
    // no stored id yet resolved to '' on the write side, so the target was set and
    // then immediately reconciled back to null — the pane flashed and vanished.
    it('opens a tab for a session that has no stored id yet', async () => {
      $selectedStoredSessionId.set(null)
      render(<Harness />)

      await emitPreviewOpen()

      await waitFor(() => expect($previewTarget.get()?.path).toBe('/tmp/artifact-test.html'))
      expect($previewTabs.get()).toHaveLength(1)
    })

    it('keeps the tab when the stored session id arrives afterwards', async () => {
      $selectedStoredSessionId.set(null)
      render(<Harness />)

      await emitPreviewOpen()
      await waitFor(() => expect($previewTarget.get()?.path).toBe('/tmp/artifact-test.html'))

      await act(async () => {
        $selectedStoredSessionId.set('stored-1')
      })

      expect($previewTarget.get()?.path).toBe('/tmp/artifact-test.html')
    })

    it('does not show an open from a session that is not the one on screen', async () => {
      $selectedStoredSessionId.set('stored-main')
      render(<Harness />)

      await act(async () => {
        handleEvent({
          payload: { url: '/tmp/other.html' },
          session_id: 'some-other-session',
          type: 'preview.open'
        } as unknown as GatewayEvent)
      })

      await waitFor(() => expect($previewTabsBySession.get().tabs['some-other-session']?.length).toBe(1))
      expect($previewTabs.get().some(tab => tab.target.path === '/tmp/other.html')).toBe(false)
    })

    // A tile's agent opening a preview must not land on the focused chat.
    it('keeps a tile session open off the focused chat', async () => {
      $selectedStoredSessionId.set('stored-main')
      const tiles = $sessionTiles.get()

      $sessionTiles.set([{ dir: 'right', runtimeId: 'tile-runtime', storedSessionId: 'stored-tile' }])
      render(<Harness />)

      try {
        await emitPreviewOpen('/tmp/from-tile.html', 'tile-runtime')

        await waitFor(() => expect($previewTabsBySession.get().tabs['stored-tile']?.length).toBe(1))
        expect($previewTabs.get().some(tab => tab.target.path === '/tmp/from-tile.html')).toBe(false)
      } finally {
        $sessionTiles.set(tiles)
      }
    })

    it('opens a second target as its own tab rather than replacing the first', async () => {
      render(<Harness />)

      await emitPreviewOpen('/tmp/one.html')
      await waitFor(() => expect($previewTabs.get()).toHaveLength(1))

      await emitPreviewOpen('/tmp/two.html')
      await waitFor(() => expect($previewTabs.get()).toHaveLength(2))

      expect($previewTarget.get()?.path).toBe('/tmp/two.html')
    })

    it('re-fronts the existing tab when the same target opens twice', async () => {
      render(<Harness />)

      await emitPreviewOpen('/tmp/one.html')
      await emitPreviewOpen('/tmp/one.html')

      await waitFor(() => expect($previewTabs.get()).toHaveLength(1))
    })

    it('renders a tool-opened html file rather than showing its source', async () => {
      render(<Harness />)

      await emitPreviewOpen()

      await waitFor(() => expect($previewTarget.get()?.renderMode).toBe('preview'))
    })

    // Offer, don't hijack: only an explicit open_preview call opens the rail.
    it('does not infer a preview from assistant prose', async () => {
      render(<Harness />)

      await act(async () => {
        $messages.set([
          assistantMessage('a1', 'Preview: http://localhost:5173/'),
          assistantMessage('a2', 'Open /work/demo.html')
        ])
      })

      expect($previewTabs.get()).toHaveLength(0)
      expect(window.hermesDesktop.normalizePreviewTarget).not.toHaveBeenCalled()
    })

    it('does not open a preview off the back of a tool result', async () => {
      render(<Harness />)

      await act(async () => {
        handleEvent({
          payload: { inline_diff: 'a/preview-demo.html -> b/preview-demo.html\n' },
          session_id: RUNTIME_SESSION_ID,
          type: 'tool.complete'
        } as unknown as GatewayEvent)
        handleEvent({
          payload: { path: './dist/index.html' },
          session_id: RUNTIME_SESSION_ID,
          type: 'tool.complete'
        } as unknown as GatewayEvent)
      })

      expect($previewTabs.get()).toHaveLength(0)
    })
  })

  describe('close_preview', () => {
    it('closes the whole pane when no url is given', async () => {
      render(<Harness />)

      await emitPreviewOpen('/tmp/one.html')
      await emitPreviewOpen('/tmp/two.html')
      await waitFor(() => expect($previewTabs.get()).toHaveLength(2))

      await emitPreviewClose('')

      expect($previewTabs.get()).toHaveLength(0)
      expect($previewTarget.get()).toBeNull()
    })

    it('closes only the matching tab when a url is given', async () => {
      render(<Harness />)

      await emitPreviewOpen('/tmp/keep.html')
      await emitPreviewOpen('/tmp/drop.html')
      await waitFor(() => expect($previewTabs.get()).toHaveLength(2))

      await emitPreviewClose('/tmp/drop.html')

      await waitFor(() => expect($previewTabs.get()).toHaveLength(1))
      expect($previewTarget.get()?.path).toBe('/tmp/keep.html')
    })

    it('closes a Browser tab by the page it navigated to', async () => {
      render(<Harness />)
      openPreview(urlTarget('https://example.com/start'))
      const tabId = $previewTabs.get()[0].id

      noteBrowserPage(tabId, {
        title: 'Dashboard',
        url: 'https://example.com/dashboard'
      })

      await emitPreviewClose('https://example.com/dashboard')

      expect($previewTabs.get()).toHaveLength(0)
      expect($browserPages.get()[tabId]).toBeUndefined()
      const persisted = JSON.parse(window.localStorage.getItem('hermes.desktop.previewTabs.v3') ?? '{}')
      expect(Object.values(persisted.tabs ?? {}).flat()).toEqual([])
    })

    it.each(['https://example.com/start', 'https://example.com/dashboard', undefined])(
      'does not remove a popped Browser tab when closing %s',
      async target => {
        render(<Harness />)
        openPreview(urlTarget('https://example.com/start'))
        const tabId = $previewTabs.get()[0].id

        noteBrowserPage(tabId, {
          title: 'Dashboard',
          url: 'https://example.com/dashboard'
        })
        markBrowserTabPopped(tabId, true)

        try {
          await emitPreviewClose(target)

          expect($previewTabs.get().map(tab => tab.id)).toEqual([tabId])
          expect($browserPages.get()[tabId]?.url).toBe('https://example.com/dashboard')
        } finally {
          markBrowserTabPopped(tabId, false)
        }
      }
    )

    it('prefers a live URL match over an earlier tab opened at that URL', async () => {
      render(<Harness />)
      const url = 'https://example.com/dashboard'
      openPreview(urlTarget(url))
      const first = $previewTabs.get()[0].id
      noteBrowserPage(first, { title: 'Elsewhere', url: 'https://elsewhere.example/' })
      newBrowserTab()
      openPreview(urlTarget('https://example.com/start'))
      const second = $previewTabs.get()[1].id
      noteBrowserPage(second, { title: 'Dashboard', url })

      await emitPreviewClose(url)

      await waitFor(() => expect($previewTabs.get().map(tab => tab.id)).toEqual([first]))
      expect($browserPages.get()[first]?.url).toBe('https://elsewhere.example/')
      expect($browserPages.get()[second]).toBeUndefined()
      expect($previewTabsBySession.get().activeBySession.__draft__).toBe(first)
    })

    it('ignores a close from a session that is not the one on screen', async () => {
      render(<Harness />)

      await emitPreviewOpen('/tmp/stay.html')
      await waitFor(() => expect($previewTabs.get()).toHaveLength(1))

      await emitPreviewClose('/tmp/stay.html', 'some-other-session')

      expect($previewTabs.get()).toHaveLength(1)
    })

    it.each(['/tmp/from-tile.html', undefined])(
      'honors a tile close of %s without changing the focused chat',
      async target => {
        $selectedStoredSessionId.set('stored-main')
        const tiles = $sessionTiles.get()

        $sessionTiles.set([{ dir: 'right', runtimeId: 'tile-runtime', storedSessionId: 'stored-tile' }])
        render(<Harness />)

        try {
          await emitPreviewOpen('/tmp/from-tile.html')
          await emitPreviewOpen('/tmp/from-tile.html', 'tile-runtime')
          await waitFor(() => expect($previewTabsBySession.get().tabs['stored-tile']?.length).toBe(1))

          const focusedTab = $rightRailActiveTabId.get()
          await emitPreviewClose(target, 'tile-runtime')

          await waitFor(() => expect($previewTabsBySession.get().tabs['stored-tile']?.length ?? 0).toBe(0))
          expect($previewTabs.get().map(tab => tab.target.path)).toEqual(['/tmp/from-tile.html'])
          expect($rightRailActiveTabId.get()).toBe(focusedTab)
        } finally {
          $sessionTiles.set(tiles)
        }
      }
    )

    it.each(['https://example.com/dashboard', undefined])(
      'closes only the primary session after tile focus changes during close of %s',
      async target => {
        const states = $sessionStates.get()
        $selectedStoredSessionId.set('stored-main')
        $sessionStates.set({
          ...states,
          [RUNTIME_SESSION_ID]: createClientSessionState('stored-main')
        })
        $sessionTiles.set([{ dir: 'right', runtimeId: 'tile-runtime', storedSessionId: 'stored-tile' }])
        render(<Harness />)
        const url = 'https://example.com/dashboard'
        openPreview(urlTarget('https://example.com/start'), 'tool-result', RUNTIME_SESSION_ID)
        const primaryId = $previewTabs.get()[0].id
        noteBrowserPage(primaryId, { title: 'Dashboard', url })
        openPreview(urlTarget('https://example.com/start'), 'tool-result', 'tile-runtime')
        const tileId = $previewTabsBySession.get().tabs['stored-tile'][0].id
        noteBrowserPage(tileId, { title: 'Dashboard', url })
        let resolve: (value: ReturnType<typeof urlTarget>) => void = () => undefined
        const pending = new Promise<ReturnType<typeof urlTarget>>(done => {
          resolve = done
        })
        vi.mocked(window.hermesDesktop.normalizePreviewTarget).mockReturnValueOnce(pending)

        try {
          if (target) {
            await emitPreviewClose(target)
            applyPreviewFocus({ runtimeId: 'tile-runtime', storedId: 'stored-tile' })
            await act(async () => {
              resolve(urlTarget(target))
            })
          } else {
            applyPreviewFocus({ runtimeId: 'tile-runtime', storedId: 'stored-tile' })
            await emitPreviewClose()
          }

          await waitFor(() => expect($previewTabsBySession.get().tabs['stored-main']).toEqual([]))
          expect($previewTabs.get().map(tab => tab.id)).toEqual([tileId])
          expect($rightRailActiveTabId.get()).toBe(tileId)
          expect($browserPages.get()[primaryId]).toBeUndefined()
          expect($browserPages.get()[tileId]?.url).toBe(url)
        } finally {
          $sessionStates.set(states)
        }
      }
    )
  })

  describe('session-owned tool-result tabs', () => {
    it('keeps tagged tabs when its session leaves the screen (hide, do not close)', () => {
      openPreview(fileTarget('/work/owned.html'), 'tool-result', RUNTIME_SESSION_ID)
      openPreview(fileTarget('/work/browsed.html'), 'file-browser')
      expect($previewTabs.get()).toHaveLength(2)

      $activeSessionId.set('other-session')
      $sessionTiles.set([])
      pruneOffscreenSessionPreviews()

      expect($previewTabs.get().map(tab => tab.target.path)).toEqual(['/work/owned.html', '/work/browsed.html'])
    })
  })
})
