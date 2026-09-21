/**
 * A local named profile rides the already-warm primary `hermes serve` with a
 * `profile` argument. That process multiplexes homes (`@_profile_scoped`,
 * `set_multiplex_active`). Dialing `getConnection` / `getConnectionFor` for
 * the same profile cold-starts a pooled child and, once the pool is full,
 * SIGTERMs whoever the user just left.
 *
 * A per-profile remote override still needs its own backend. That answer
 * comes from `getConnectionConfig` (a config read). Never from `getConnection`,
 * which is the spawn.
 */

export interface LocalPrimaryMultiplexFacts {
  connectionId: null | string
  primaryConnectionId: null | string
  primaryMode: 'local' | 'remote' | null
  primaryOpen: boolean
  primaryProfile: string
  profile: string
}

const remoteOverrideCache = new Map<string, boolean>()

export function clearLocalPrimaryMultiplexCache(): void {
  remoteOverrideCache.clear()
}

function norm(profile: string): string {
  return profile.trim() || 'default'
}

function connectionIsLocalPrimary(facts: LocalPrimaryMultiplexFacts): boolean {
  if (facts.primaryMode === 'remote') {
    return false
  }

  const id = String(facts.connectionId ?? '').trim()
  const primaryId = String(facts.primaryConnectionId ?? '').trim()

  // Mode already published as local: a profile-only dial and the local source
  // ride. A not-yet-open socket still must not spawn a child.
  if (facts.primaryMode === 'local') {
    if (!id || id === 'local') {
      return true
    }

    return Boolean(primaryId) && id === primaryId
  }

  // Mode not published yet. An unset id is not evidence the primary is local —
  // that is the fallthrough that used to call getConnection and spawn. Ride
  // only when boot has already published the local source and the socket is up.
  if (!facts.primaryOpen || primaryId !== 'local') {
    return false
  }

  return !id || id === 'local' || id === primaryId
}

async function hasRemoteOverride(profile: string): Promise<boolean> {
  const key = norm(profile)
  const cached = remoteOverrideCache.get(key)

  if (cached !== undefined) {
    return cached
  }

  const read = window.hermesDesktop?.getConnectionConfig

  if (!read) {
    return false
  }

  try {
    const config = await read(key)
    const remote = config.mode !== 'local'
    remoteOverrideCache.set(key, remote)

    return remote
  } catch {
    // A failed config read must not become a spawn. The primary can scope
    // this home; a later successful read can still mark an override.
    return false
  }
}

/** True when chat RPCs for this profile must use the primary socket and a
 *  `profile` param, and must not open a pooled backend. */
export async function profileRidesLocalPrimary(facts: LocalPrimaryMultiplexFacts): Promise<boolean> {
  if (!connectionIsLocalPrimary(facts)) {
    return false
  }

  const profile = norm(facts.profile)

  if (profile === norm(facts.primaryProfile)) {
    return false
  }

  return !(await hasRemoteOverride(profile))
}
