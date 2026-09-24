import { type ChatMessage, chatMessageText } from '@/lib/chat-messages'

/** Where a post-interim replay belongs. `painted` means the sealed interim
 *  already shows this text. `extend` means the replay continues that interim. */
export function replayedInterimTarget(
  messages: ChatMessage[],
  streamId: string | null,
  incoming: string
): { id: string; mode: 'extend' | 'painted' } | null {
  const text = incoming.trim()

  if (!text || streamId) {
    return null
  }

  const tail = [...messages].reverse().find(message => !message.hidden)

  if (!tail || tail.role !== 'assistant' || !tail.interim) {
    return null
  }

  const existing = chatMessageText(tail).trim()

  if (!existing) {
    return null
  }

  if (existing.startsWith(text)) {
    return { id: tail.id, mode: 'painted' }
  }

  if (text.startsWith(existing)) {
    return { id: tail.id, mode: 'extend' }
  }

  return null
}
