import { beforeEach, expect, it, vi } from 'vitest'

import {
  bindNavigationReplay,
  type NavigationEntry,
  navigationHistory,
  recordNavigation,
  resetNavigationHistory,
  travelNavigation
} from './navigation-history'

const entry = (route: string, browser?: NavigationEntry['browser']): NavigationEntry => ({
  route,
  pane: browser ? `preview-tile:${browser.tabId}` : 'session-tile:chat',
  session: 'chat',
  profile: 'default',
  mode: 'bots',
  owner: 'local/default',
  newSessionTarget: null,
  browserOpen: !!browser,
  browser
})

beforeEach(resetNavigationHistory)

it('replays exact bot/card/browser destinations without adding the replay to history', () => {
  const replay = vi.fn()
  const unbind = bindNavigationReplay(replay)

  const chat = entry('/bots'),
    card = entry('/kanban?task=t_1234abcd&board=team'),
    pr = entry('/bots', { tabId: 'url:qa-pr', url: 'https://github.com/org/repo/pull/12' })

  recordNavigation(chat)
  recordNavigation(card)
  recordNavigation(pr)
  travelNavigation(-1)
  expect(replay).toHaveBeenLastCalledWith(card)
  recordNavigation(entry('/bots'))
  recordNavigation(card)
  expect(navigationHistory.canGoForward).toBe(true)
  travelNavigation(-1)
  expect(replay).toHaveBeenLastCalledWith(chat)
  recordNavigation(chat)
  travelNavigation(1)
  expect(replay).toHaveBeenLastCalledWith(card)
  recordNavigation(card)
  travelNavigation(1)
  expect(replay).toHaveBeenLastCalledWith(pr)
  recordNavigation(pr)
  expect(navigationHistory.canGoForward).toBe(false)
  unbind()
})
