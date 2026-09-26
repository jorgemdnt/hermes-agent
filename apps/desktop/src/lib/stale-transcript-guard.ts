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
    return lastDurableIndex(remoteChat) >= 0 ? true : null
  }

  return remoteChat.length - remoteIndex > localMessages.length - localIndex
}

/**
 * Chat messages to install when the authoritative latest page is ahead of the
 * local view. Null when the local view is current.
 *
 * Counts are compared after `toChatMessages`, so tool rows folded into an
 * assistant bubble are not "ahead". A backfilled prefix is kept when the
 * refreshed tail anchors inside it. Live stream ids that have no stored row
 * yet count against the page's newer rows, so the window that just finished
 * the turn is not blocked.
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

  const grafted = graftRefreshedTailOntoBackfill(remoteChat, localMessages)
  const ahead = aheadOfNewestDurableRow(localMessages, remoteChat) ?? grafted.length > localMessages.length

  return ahead ? grafted : null
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
