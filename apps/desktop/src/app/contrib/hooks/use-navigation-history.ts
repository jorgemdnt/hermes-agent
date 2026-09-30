import { bindHistoryMouseNavigation, historyKeyDirection } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useEffect, useEffectEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { isWorkspacePageRoute } from '@/app/routes'
import { isPaneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import {
  $workspaceMode,
  $workspaceNewSessionTarget,
  $workspaceOwnerKey,
  setWorkspaceScope
} from '@/components/pane-shell/workspace-scope'
import { $activeConnectionId } from '@/store/connections'
import { captureNavigationScroll, restoreNavigationScroll } from '@/lib/navigation-scroll'
import { $fileBrowserOpen, $rightRailActiveTabId, selectRightRailTab, setFileBrowserOpen } from '@/store/layout'
import {
  bindNavigationReplay,
  navigationHistory,
  navigationReplayKey,
  type NavigationEntry,
  recordNavigation,
  resetNavigationHistory,
  travelNavigation
} from '@/store/navigation-history'
import { $browserPages, $previewTabs, commitBrowserTabLocation } from '@/store/preview'
import { $activeProfile, switchProfile } from '@/store/profile'
import { $focusedTreePaneId } from '@/store/session-focus'
import { $focusedStoredSessionId, focusedSessionWorkspaceScope } from '@/store/session-states'

/** Pane focus and guest locations join router navigation, including Bot tabs. */
export function useNavigationHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const connection = useStore($activeConnectionId)
  const profile = useStore($activeProfile)
  const pane = useStore($focusedTreePaneId) ?? null
  const session = useStore($focusedStoredSessionId)
  const sessionScope = session ? focusedSessionWorkspaceScope() : undefined
  const mode = useStore($workspaceMode)
  const owner = useStore($workspaceOwnerKey)
  const newSessionTarget = useStore($workspaceNewSessionTarget)
  const pages = useStore($browserPages)
  const tabs = useStore($previewTabs)
  const tabId = useStore($rightRailActiveTabId)
  const browserOpen = useStore($fileBrowserOpen)
  const tab = tabs.find(item => item.id === tabId && item.target.kind === 'url')

  const browserTabId =
    !isWorkspacePageRoute(location.pathname) && browserOpen && tab && isPaneVisible(`preview-tile:${tab.id}`)
      ? tab.id
      : undefined
  const browserUrl = tab ? pages[tab.id]?.url || tab.target.url || '' : ''

  const route = `${location.pathname}${location.search}`

  const applyEntry = useEffectEvent((entry: NavigationEntry) => {
    setWorkspaceScope(entry.mode, entry.owner, entry.newSessionTarget)
    navigate(entry.route, { replace: true })

    if (entry.session && !isWorkspacePageRoute(entry.route.split('?')[0])) {
      openSession(entry.session, navigate, 'in-place', entry.sessionScope)
    }

    if (entry.browser) {
      commitBrowserTabLocation(entry.browser.tabId, entry.browser.url)
      selectRightRailTab(entry.browser.tabId)
      setFileBrowserOpen(true)
      revealTreePane(`preview-tile:${entry.browser.tabId}`)
    } else {
      setFileBrowserOpen(entry.browserOpen)

      if (entry.pane) {
        revealTreePane(entry.pane)
      }
    }
  })

  useEffect(() => {
    resetNavigationHistory()
  }, [connection])
  useEffect(() => {
    let cancelScroll = () => {}
    let restoring = false
    let generation = 0
    const capture = () => {
      const entry = navigationHistory.current

      if (!entry || restoring || navigationReplayKey !== null || isWorkspacePageRoute(entry.route.split('?')[0])) {
        return
      }
      // A layout commit precedes recordNavigation's effect. Its resize events
      // belong to the destination, never the chat entry we just left.
      if (
        entry.route !== (window.location.hash.slice(1) || '/') ||
        entry.profile !== $activeProfile.get() ||
        entry.session !== $focusedStoredSessionId.get() ||
        entry.browserOpen !== $fileBrowserOpen.get()
      ) {
        return
      }
      const scrollTop = captureNavigationScroll(entry)

      if (scrollTop !== undefined) {
        navigationHistory.update({ ...entry, scrollTop })
      }
    }
    const stopRestore = () => {
      cancelScroll()
      restoring = false
    }
    const unbind = bindNavigationReplay(entry => {
      stopRestore()
      restoring = true
      const token = ++generation
      void (async () => {
        if (entry.profile !== $activeProfile.get()) {
          await switchProfile(entry.profile)
        }
        if (token !== generation) {
          return
        }
        applyEntry(entry)
        cancelScroll = restoreNavigationScroll(entry, () => {
          restoring = false
        })
      })()
    })
    document.addEventListener('scroll', capture, true)
    document.addEventListener('pointerdown', capture, true)
    document.addEventListener('wheel', stopRestore, true)

    return () => {
      generation += 1
      stopRestore()
      unbind()
      document.removeEventListener('scroll', capture, true)
      document.removeEventListener('pointerdown', capture, true)
      document.removeEventListener('wheel', stopRestore, true)
    }
    // Declarative Router's navigate changes with the path. Rebinding here
    // would cancel the very restoration whose route change we just applied.
  }, [connection])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const browser = browserTabId ? { tabId: browserTabId, url: browserUrl } : undefined
      recordNavigation({
        route,
        pane,
        session,
        sessionScope,
        profile,
        mode,
        owner,
        newSessionTarget,
        browser,
        browserOpen
      })
    }, 0)

    return () => clearTimeout(timer)
  }, [
    route,
    pane,
    session,
    sessionScope,
    profile,
    mode,
    owner,
    newSessionTarget,
    browserTabId,
    browserUrl,
    browserOpen
  ])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const direction = historyKeyDirection(event)

      if (direction === null) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      travelNavigation(direction)
    }

    window.addEventListener('keydown', key, true)
    const unbindMouse = bindHistoryMouseNavigation(window, travelNavigation)

    return () => {
      window.removeEventListener('keydown', key, true)
      unbindMouse()
    }
  }, [])
}
