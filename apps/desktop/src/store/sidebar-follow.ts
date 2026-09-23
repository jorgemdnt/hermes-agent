import { revealTreePane } from '@/components/pane-shell/tree/store'
import type { WorkspaceMode } from '@/contrib/types'

const SESSIONS_PANE_ID = 'sessions'

/** Set while a notification click is fronting the Sessions tab. The Bots-hide
 *  listener runs inside that reveal and would otherwise reopen the chat
 *  remembered from the last time Bots was shown. */
let followingOpen = false

export function armSessionsFollowOpen(): void {
  followingOpen = true
}

export function consumeSessionsFollowOpen(): boolean {
  const value = followingOpen

  followingOpen = false

  return value
}

/** Front the sidebar tab that lists this conversation. Bot chats already live
 *  on the Bots tab the click came from, or on a tile the open path fronts;
 *  revealing Bots from here re-runs the roster open and can replace that tile. */
export function revealThreadSidebar(mode: WorkspaceMode): void {
  if (mode === 'bots') {
    return
  }

  armSessionsFollowOpen()
  revealTreePane(SESSIONS_PANE_ID)
  // Listener runs inside the reveal. If the pane was already fronted, drop
  // the flag so a later Sessions click still restores.
  followingOpen = false
}
