import { historyKeyDirection } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
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
import { $fileBrowserOpen, $rightRailActiveTabId, selectRightRailTab, setFileBrowserOpen } from '@/store/layout'
import {
  bindNavigationReplay,
  recordNavigation,
  resetNavigationHistory,
  travelNavigation
} from '@/store/navigation-history'
import { $browserPages, $previewTabs, commitBrowserTabLocation } from '@/store/preview'
import { $activeProfile, switchProfile } from '@/store/profile'
import { $focusedTreePaneId } from '@/store/session-focus'
import { $focusedStoredSessionId } from '@/store/session-states'

/** Pane focus and guest locations join router navigation, including Bot tabs. */
export function useNavigationHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const connection = useStore($activeConnectionId)
  const profile = useStore($activeProfile)
  const pane = useStore($focusedTreePaneId) ?? null
  const session = useStore($focusedStoredSessionId)
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

  useEffect(() => {
    resetNavigationHistory()
  }, [connection])
  useEffect(
    () =>
      bindNavigationReplay(entry => {
        void (async () => {
          if (entry.profile !== $activeProfile.get()) {
            await switchProfile(entry.profile)
          }
          setWorkspaceScope(entry.mode, entry.owner, entry.newSessionTarget)
          navigate(entry.route, { replace: true })

          if (entry.session && !isWorkspacePageRoute(entry.route.split('?')[0])) {
            openSession(entry.session, navigate, 'in-place', {
              workspaceMode: entry.mode,
              workspaceOwnerKey: entry.owner ?? undefined
            })
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
        })()
      }),
    [navigate]
  )
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const browser = browserTabId ? { tabId: browserTabId, url: browserUrl } : undefined
      recordNavigation({ route, pane, session, profile, mode, owner, newSessionTarget, browser, browserOpen })
    }, 0)

    return () => clearTimeout(timer)
  }, [route, pane, session, profile, mode, owner, newSessionTarget, browserTabId, browserUrl, browserOpen])
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

    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      travelNavigation(event.button === 3 ? -1 : 1)
    }

    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', mouse, true)

    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mousedown', mouse, true)
    }
  }, [])
}
