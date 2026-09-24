/**
 * Landing for a click that should open the conversation that caused a notice.
 * Native OS notifications and in-app toasts both come through here so a toast
 * body click and a notification click open the same tab, with the same runtime
 * → stored id translation. Bot activity does not use this — that click is
 * `openRosterBot`, not a stored session id.
 */
import { openSession, type OpenSessionNavigate } from '@/app/open-session'
import { appViewForPath, isOverlayView, sessionRoute } from '@/app/routes'
import { storedSessionIdForNotification } from '@/lib/session-ids'
import { $selectedStoredSessionId } from '@/store/session'
import { $botChatScopes, $sessionTiles, storedSessionIdForRuntimeId } from '@/store/session-states'
import { revealThreadSidebar } from '@/store/sidebar-follow'

export interface NotifiedSessionFocus {
  navigate: OpenSessionNavigate
  locationPathname: string
  /** Read at click time — the wiring cache mutates the map in place. */
  runtimeMap: () => ReadonlyMap<string, string>
}

let bound: NotifiedSessionFocus | null = null

export function bindNotifiedSessionFocus(ctx: NotifiedSessionFocus): () => void {
  bound = ctx

  return () => {
    if (bound === ctx) {
      bound = null
    }
  }
}

function hashNavigate(to: string, options?: { replace?: boolean }) {
  const target = to.startsWith('#') ? to : `#${to}`

  if (options?.replace) {
    window.location.replace(target)
  } else {
    window.location.hash = target
  }
}

function currentHashPathname(): string {
  if (typeof window === 'undefined') {
    return '/'
  }

  const hash = window.location.hash.replace(/^#/, '')
  const cut = hash.search(/[?#]/)

  return (cut === -1 ? hash : hash.slice(0, cut)) || '/'
}

function focusContext(): NotifiedSessionFocus {
  return (
    bound ?? {
      locationPathname: currentHashPathname(),
      navigate: hashNavigate,
      runtimeMap: () => new Map()
    }
  )
}

export function focusNotifiedSession(sessionId: string): void {
  if (!sessionId) {
    return
  }

  const ctx = focusContext()
  const viaLocalMap = storedSessionIdForNotification(sessionId, ctx.runtimeMap())
  const storedId = viaLocalMap !== sessionId ? viaLocalMap : (storedSessionIdForRuntimeId(sessionId) ?? sessionId)

  const scope =
    $sessionTiles.get().find(tile => tile.storedSessionId === storedId) ?? $botChatScopes.get()[storedId]

  const workspaceScope = scope && { ...scope, workspaceMode: scope.workspaceMode ?? 'sessions' }

  if (isOverlayView(appViewForPath(ctx.locationPathname))) {
    ctx.navigate(sessionRoute($selectedStoredSessionId.get() ?? ''), { replace: true })
  }

  openSession(storedId, ctx.navigate, 'stack', workspaceScope)
  revealThreadSidebar(scope?.workspaceMode ?? 'sessions')
}
