/**
 * ⌃1–9 and the profile rail call selectProfile. For a local bot that must
 * open the Bot Chat, not a blank draft and not a pooled `hermes serve`.
 */

import { registerBotProfileOpen } from '@/store/profile'

import { $lastRoster, cachedUnionRoster } from './data'
import { openRosterBot } from './roster-actions'
import type { RosterRow } from './types'

function rosterRows(): RosterRow[] {
  const live = $lastRoster.get()

  if (live.length) {
    return live
  }

  const cached = cachedUnionRoster()

  return Array.isArray(cached?.profiles) ? cached.profiles : []
}

function isRemoteRow(row: RosterRow): boolean {
  return Boolean(row.remoteSource || row.connectionKind === 'ssh' || row.route?.mode === 'remote')
}

function syntheticLocalBot(name: string): RosterRow {
  return {
    name,
    connectionId: 'local',
    connectionKind: 'local',
    sourceScoped: true,
    route: { connectionId: 'local', mode: 'local', profile: name, targetProfile: name }
  } as RosterRow
}

function botForProfileSwitch(name: string): RosterRow | null {
  if (!name || name === 'default') {
    return null
  }

  const rows = rosterRows().filter(row => row.name === name)

  if (rows.length > 0 && rows.every(isRemoteRow)) {
    return null
  }

  return rows.find(row => !isRemoteRow(row)) ?? syntheticLocalBot(name)
}

/** Returns a disposer. Claims every non-default local profile switch. */
export function installBotProfileSwitch(): () => void {
  registerBotProfileOpen(name => {
    const bot = botForProfileSwitch(name)

    if (!bot) {
      return false
    }

    void openRosterBot(bot)

    return true
  })

  return () => registerBotProfileOpen(null)
}
