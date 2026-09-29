import { graftRefreshedTailOntoBackfill } from '@/app/chat/transcript-backfill'
import { getLatestSessionMessages, type ProfileScope } from '@/hermes'
import { type ChatMessage, preserveLocalAssistantErrors, toChatMessages } from '@/lib/chat-messages'
import { knownSessionOwner, ownerLookupSessionRows } from '@/store/session'
import type { SessionOwnerScope } from '@/store/session-request-router'

/** REST scope for a session owner. Undefined when the owner is unknown. */
export function profileScopeForSessionOwner(owner: SessionOwnerScope): ProfileScope {
  if (!owner) {
    return undefined
  }

  if (typeof owner === 'string') {
    return owner
  }

  return {
    connectionId: owner.connectionId,
    profile: owner.targetProfile ?? owner.profile
  }
}

function lastDurableIndex(messages: ChatMessage[], atMostRowId = Number.POSITIVE_INFINITY): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rowId = messages[index].rowId

    if (rowId !== undefined && rowId <= atMostRowId) {
      return index
    }
  }

  return -1
}

/**
 * True when the remote page carries more messages after this window's newest
 * stored row than this window holds unstored (the turn it streamed itself).
 * Messages before that row are ignored: the store releases paged-through
 * history (#77311), so the window is routinely shorter than the latest page
 * without being behind it. Null when either side has no stored row to anchor.
 */
function aheadOfNewestDurableRow(localMessages: ChatMessage[], remoteChat: ChatMessage[]): boolean | null {
  const localIndex = lastDurableIndex(localMessages)

  if (localIndex < 0) {
    return null
  }

  const localNewest = localMessages[localIndex].rowId as number
  const remoteIndex = lastDurableIndex(remoteChat, localNewest)

  // The whole page is newer than anything this window holds.
  if (remoteIndex < 0) {
    return lastDurableIndex(remoteChat) >= 0 ? authoredMessageCount(remoteChat) > 0 : null
  }

  return authoredMessageCount(remoteChat.slice(remoteIndex + 1)) > authoredMessageCount(localMessages.slice(localIndex + 1))
}

/**
 * Transcript content a view actually authored. Backend-written notices
 * (`ChatMessage.systemNotice`) render on the timeline but belong to no view, so
 * counting them reports a second window that does not exist: an in-place model
 * switch alone refused every send with "this window was behind another view of
 * the same chat".
 */
function authoredMessageCount(messages: ChatMessage[]): number {
  return messages.reduce((count, message) => (message.systemNotice ? count : count + 1), 0)
}

/**
 * Highest durable row address a bubble carries: its own `rowId` plus any text
 * part's `sourceRowId`. A folded tool-turn bubble spans many stored rows, and
 * the two paths that build it bind different ends — live settle stamps the
 * turn's final row (use-message-stream's withPersistedIdentity) while
 * hydration keeps the folded bubble's first row — so the tip must read every
 * address the bubble owns (#125975).
 */
function bubbleTipRowId(message: ChatMessage): number | undefined {
  let tip = message.rowId

  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.sourceRowId === 'number') {
      tip = tip === undefined ? part.sourceRowId : Math.max(tip, part.sourceRowId)
    }
  }

  return tip
}

/**
 * Latest persisted backend row the view carries. Retention only ever releases
 * the head (rows older than the window plus its budget — see
 * app/chat/transcript-retention.ts), so the last durable row is always the
 * live tail; unpersisted rows (optimistic prompts, live streams) sit past it.
 */
function lastDurableRowId(messages: readonly ChatMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rowId = bubbleTipRowId(messages[index])

    if (typeof rowId === 'number') {
      return rowId
    }
  }

  return undefined
}

/**
 * Chat messages to install when the authoritative latest page is ahead of the
 * local view. Null when the local view is current.
 *
 * Compare authored content after the newest shared durable row: a trimmed
 * local history is not stale just because its head is shorter, and backend
 * notices do not count as another view's turn. Unstored local stream rows
 * count against newer remote rows. Keep the backfilled prefix on refresh.
 */
export function messagesIfTranscriptBehind(
  localMessages: ChatMessage[],
  remoteChat: ChatMessage[]
): ChatMessage[] | null {
  if (remoteChat.length === 0) {
    return null
  }

  if (localMessages.length === 0) {
    return remoteChat
  }

  const localTip = lastDurableRowId(localMessages)
  const remoteTip = lastDurableRowId(remoteChat)
  if (localTip !== undefined && localTip === remoteTip) {
    return null
  }

  const grafted = graftRefreshedTailOntoBackfill(remoteChat, localMessages)
  const ahead = aheadOfNewestDurableRow(localMessages, remoteChat)
  return (ahead ?? authoredMessageCount(grafted) > authoredMessageCount(localMessages)) ? grafted : null
}

/**
 * Read the authoritative latest page and return a refreshed transcript when
 * this view is behind. Null when current or the read fails — a missing
 * profile or a down backend must not soft-lock send.
 */
export async function refreshIfTranscriptStale(
  storedSessionId: string,
  localMessages: ChatMessage[],
  options?: { excludeMessageId?: string; profile?: ProfileScope }
): Promise<ChatMessage[] | null> {
  const baseline = options?.excludeMessageId
    ? localMessages.filter(message => message.id !== options.excludeMessageId)
    : localMessages

  const profile =
    options && 'profile' in options
      ? options.profile
      : profileScopeForSessionOwner(knownSessionOwner(ownerLookupSessionRows(), storedSessionId))

  try {
    const remote = await getLatestSessionMessages(storedSessionId, profile)
    const refreshed = messagesIfTranscriptBehind(baseline, toChatMessages(remote.messages))

    if (!refreshed) {
      return null
    }

    return preserveLocalAssistantErrors(refreshed, baseline)
  } catch {
    return null
  }
}
