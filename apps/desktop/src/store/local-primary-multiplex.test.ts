import { describe, expect, it } from 'vitest'

import { clearLocalPrimaryMultiplexCache, profileRidesLocalPrimary } from './local-primary-multiplex'

const localFacts = {
  connectionId: 'local' as string | null,
  primaryConnectionId: 'local',
  primaryMode: 'local' as const,
  primaryOpen: true,
  primaryProfile: 'default',
  profile: 'frodo'
}

describe('profileRidesLocalPrimary', () => {
  it('rides the warm local primary for a named local profile', async () => {
    clearLocalPrimaryMultiplexCache()

    await expect(profileRidesLocalPrimary(localFacts)).resolves.toBe(true)
  })

  it('does not ride when the primary is the profile itself', async () => {
    await expect(profileRidesLocalPrimary({ ...localFacts, profile: 'default' })).resolves.toBe(false)
  })

  it('does not ride a remote primary, and a not-yet-open local primary still must not spawn a child', async () => {
    await expect(profileRidesLocalPrimary({ ...localFacts, primaryOpen: false })).resolves.toBe(true)
    await expect(profileRidesLocalPrimary({ ...localFacts, primaryMode: 'remote' })).resolves.toBe(false)
  })

  it('rides the primary before primaryMode is published, once the local source is up', async () => {
    clearLocalPrimaryMultiplexCache()

    await expect(
      profileRidesLocalPrimary({
        ...localFacts,
        connectionId: null,
        primaryConnectionId: 'local',
        primaryMode: null,
        primaryOpen: true
      })
    ).resolves.toBe(true)

    await expect(
      profileRidesLocalPrimary({ ...localFacts, primaryMode: null, primaryConnectionId: null, connectionId: null })
    ).resolves.toBe(false)
  })

  it('does not ride a per-profile remote override', async () => {
    clearLocalPrimaryMultiplexCache()
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      getConnectionConfig: async () => ({ mode: 'ssh' })
    }

    await expect(profileRidesLocalPrimary(localFacts)).resolves.toBe(false)

    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
    clearLocalPrimaryMultiplexCache()
  })
})
