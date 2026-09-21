// Regression: the right rail's tabs were persisted under ONE global key
// (`hermes.desktop.previewTabs.v2` holding a bare array), so a preview opened in
// one agent's chat appeared in every other agent's chat — Tess's model showed up
// in VEXA's rail and vice versa.
//
// Contract under test: the rail follows THE CHAT ON SCREEN (stored session id).
// session-states pushes that owner via applyPreviewFocus after
// `$focusedStoredSessionId` exists — preview must not import session-states.
import { beforeEach, describe, expect, it } from 'vitest'

import { $selectedStoredSessionId } from './session'
import {
  $allDockedPreviewTabs,
  $previewTabs,
  $previewTabsBySession,
  applyPreviewFocus,
  openPreview,
  type PreviewTarget
} from './preview'

function fileTarget(path: string): PreviewTarget {
  return {
    kind: 'file',
    label: path.split('/').pop() ?? path,
    path,
    source: path,
    url: `file://${path}`
  }
}

const paths = () => $previewTabs.get().map(tab => tab.target.path)

describe('right rail follows the chat on screen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $selectedStoredSessionId.set(null)
    $previewTabsBySession.set({ activeBySession: {}, tabs: {} })
    applyPreviewFocus({ runtimeId: null, storedId: null })
    $previewTabs.set([])
  })

  it('does not show one thread the tabs another thread opened', () => {
    applyPreviewFocus({ runtimeId: null, storedId: 'sess-tess' })
    openPreview(fileTarget('/work/tess-model.html'))

    expect(paths()).toEqual(['/work/tess-model.html'])

    applyPreviewFocus({ runtimeId: null, storedId: 'sess-default' })

    expect($previewTabs.get()).toEqual([])

    applyPreviewFocus({ runtimeId: null, storedId: 'sess-tess' })

    expect(paths()).toEqual(['/work/tess-model.html'])
    expect(Object.keys($previewTabsBySession.get().tabs)).toContain('sess-tess')
  })

  it('keeps the docked-tab list identity when the session map is rewritten with the same tabs', () => {
    applyPreviewFocus({ runtimeId: null, storedId: 'sess-tess' })
    openPreview(fileTarget('/work/tess-model.html'))

    const first = $allDockedPreviewTabs.get()
    const state = $previewTabsBySession.get()

    $previewTabsBySession.set({
      activeBySession: { ...state.activeBySession },
      tabs: { ...state.tabs }
    })

    expect($allDockedPreviewTabs.get()).toBe(first)
  })
})
