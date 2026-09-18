import type { RosterRow } from './types'

/** Which rows to paint. `live` is null while `profiles.list` is in flight. */
export function rosterPaintSource(live: null | readonly RosterRow[], lastRoster: readonly RosterRow[]): RosterRow[] {
  return live ? [...live] : [...lastRoster]
}
