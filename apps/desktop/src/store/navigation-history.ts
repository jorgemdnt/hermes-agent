import { NavigationHistory } from '@hermes/shared'
import { atom } from 'nanostores'

import type { WorkspaceMode, WorkspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'
import type { RightRailTabId } from '@/store/layout'

export interface NavigationEntry {
  browserOpen: boolean
  route: string
  pane: string | null
  session: string | null
  profile: string
  mode: WorkspaceMode
  owner: string | null
  newSessionTarget: WorkspaceNewSessionTarget | null
  browser?: { tabId: RightRailTabId; url: string }
}

export const navigationEntryKey = (entry: NavigationEntry) =>
  JSON.stringify([
    entry.route,
    entry.pane,
    entry.session,
    entry.profile,
    entry.mode,
    entry.owner,
    entry.browser?.tabId,
    entry.browser?.url
  ])
export const navigationHistory = new NavigationHistory<NavigationEntry>(navigationEntryKey)
export const $navigationAvailability = atom({ back: false, forward: false })
let replay: ((entry: NavigationEntry) => void) | null = null
export let navigationReplayKey: string | null = null

export function bindNavigationReplay(handler: (entry: NavigationEntry) => void): () => void {
  replay = handler

  return () => {
    if (replay === handler) {
      replay = null
    }
  }
}

export function publishNavigationAvailability(): void {
  $navigationAvailability.set({ back: navigationHistory.canGoBack, forward: navigationHistory.canGoForward })
}

export function travelNavigation(direction: -1 | 1): void {
  const entry = navigationHistory.move(direction)

  if (!entry || !replay) {
    return
  }
  navigationReplayKey = navigationEntryKey(entry)
  publishNavigationAvailability()
  replay(entry)
}

export function recordNavigation(entry: NavigationEntry): void {
  if (navigationReplayKey !== null) {
    if (navigationEntryKey(entry) === navigationReplayKey) {
      navigationReplayKey = null
    }

    return
  }

  navigationHistory.record(entry)
  publishNavigationAvailability()
}

export function resetNavigationHistory(): void {
  navigationHistory.clear()
  navigationReplayKey = null
  publishNavigationAvailability()
}
