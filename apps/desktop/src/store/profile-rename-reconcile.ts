import { LOCAL_CONNECTION_ID } from '@hermes/shared'

import type { HermesConnection } from '@/global'
import type { ProfileInfo } from '@/types/hermes'

import { $profiles, normalizeProfileKey } from './profile'
import { $connection } from './session'
import { migrateTilesForProfile } from './session-states'

// Renames made outside this window (`hermes profile rename`, another window,
// the dashboard) never run the rename dialog's migrateTilesForProfile, so
// renderer state keyed by the old name stays behind. The worst case is a
// second owner hint for the same session: `local::<old>` next to
// `local::<new>` makes the focused owner ambiguous, and the Bots row stops
// highlighting its own open chat. The backend records every rename in
// profile.yaml `previous_names`, so the local profile list is enough to
// re-run the same migration here.

function isLocalSource(connection: HermesConnection | null): boolean {
  return (
    Boolean(connection) &&
    connection?.mode !== 'remote' &&
    (connection?.connectionId ?? LOCAL_CONNECTION_ID) === LOCAL_CONNECTION_ID
  )
}

/** The old → new renames a local profile list still implies. An old name
 *  that is a live profile again belongs to that profile, not the renamed one. */
export function pendingProfileRenames(profiles: readonly ProfileInfo[]): Array<[string, string]> {
  const live = new Set(profiles.map(profile => normalizeProfileKey(profile.name)))
  const renames: Array<[string, string]> = []

  for (const profile of profiles) {
    const to = normalizeProfileKey(profile.name)

    for (const previous of profile.previous_names ?? []) {
      const from = normalizeProfileKey(previous)

      if (from !== 'default' && from !== to && !live.has(from)) {
        renames.push([from, to])
      }
    }
  }

  return renames
}

export function bindProfileRenameReconcile(): () => void {
  const done = new Set<string>()

  return $profiles.subscribe(profiles => {
    if (!isLocalSource($connection.get())) {
      return
    }

    for (const [from, to] of pendingProfileRenames(profiles)) {
      const key = JSON.stringify([from, to])

      if (!done.has(key)) {
        done.add(key)
        migrateTilesForProfile(from, to)
      }
    }
  })
}
