/**
 * Paint a local bot's cached Bot Chat in the click's synchronous turn.
 * The reconcile (session.list / session.resume on the primary) happens
 * after this returns. No gateway dial lives here.
 */

import { $selectedStoredSessionId, requestSessionResume, setMessages } from '@/store/session'
import { loadTranscriptTail } from '@/store/transcript-tail-cache'

import { resolveBotConnectionRoute } from './routing'
import type { RosterRow } from './types'

export function paintCachedLocalBotChat(bot: RosterRow): boolean {
  const resolved = resolveBotConnectionRoute(bot)

  if (resolved.status !== 'resolved' || !resolved.route || resolved.route.mode !== 'local') {
    return false
  }

  const storedId = String(bot.canonical_session?.resolved_id || bot.canonical_session?.id || '')

  if (!storedId) {
    return false
  }

  const profile = resolved.route.targetProfile || resolved.route.profile

  // Pin Frodo's route before the open. Do not move the hash: the occupied
  // pane will not yield to a miss, and that is the dead click from Gandalf.
  requestSessionResume(storedId, {
    connectionId: resolved.route.connectionId,
    mode: 'local',
    profile: resolved.route.profile,
    ...(resolved.route.targetProfile ? { targetProfile: resolved.route.targetProfile } : {})
  })

  const tail = loadTranscriptTail(storedId, { connectionId: resolved.route.connectionId, profile })

  if (tail?.length) {
    setMessages(tail)
  }

  $selectedStoredSessionId.set(storedId)

  // Do not move the hash here. The occupied pane (Gandalf, Hermes) will not
  // yield to a miss, so a premature navigate looks like a dead click. The
  // open path fronts Frodo's own tab; this turn only pins his route and
  // paints the cache.

  return Boolean(tail?.length)
}
