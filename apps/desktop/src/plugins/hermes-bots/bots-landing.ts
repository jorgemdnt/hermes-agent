import type { RosterRow } from './types'

/** Center page while the bots tab is up and the roster has not answered. */
export const BOTS_LOADING_ROUTE = '/bots-loading'

export const BOTS_PANE_ID = 'hermes-bots:pane'

const WORKSPACE_PAGE_PREFIXES = ['/capabilities', '/messaging', '/artifacts']

/** Hash or path. A restored skills page is `/capabilities`, with or without a query. */
export function centerIsWorkspacePage(hashOrPath: string): boolean {
  const raw = hashOrPath.replace(/^#/, '')
  const path = raw.split(/[?#]/)[0] || '/'

  return WORKSPACE_PAGE_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

/** Last selected row, else the first roster row. Null when the roster is empty. */
export function firstOpenableBot(
  roster: readonly RosterRow[],
  selected: RosterRow | null
): RosterRow | null {
  return selected || roster.find(Boolean) || null
}

export type BotsLanding = 'leave' | 'loading' | 'open' | 'clear'

/**
 * What the center should do when the bots tab is the home.
 *
 * A cold start does not fire the pane-visibility listener (the tab is already
 * showing), and last-route restore paints `/capabilities`. While the roster
 * has not answered, that page is replaced with a loading route. Once a row
 * exists, open it. An empty answer leaves the skills page too.
 */
export function botsLandingAction(input: {
  paneVisible: boolean
  groupOpen: boolean
  rosterHydrated: boolean
  hasBot: boolean
  centerIsWorkspacePage: boolean
}): BotsLanding {
  if (!input.paneVisible || input.groupOpen) {
    return 'leave'
  }

  if (!input.rosterHydrated) {
    return input.centerIsWorkspacePage ? 'loading' : 'leave'
  }

  if (input.hasBot) {
    return 'open'
  }

  return input.centerIsWorkspacePage ? 'clear' : 'leave'
}
