import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { messagesIfTranscriptBehind } from './stale-transcript-guard'

const msg = (id: string, rowId?: number): ChatMessage => ({
  id,
  role: rowId !== undefined && rowId % 2 === 0 ? 'assistant' : 'user',
  parts: [{ type: 'text', text: id }],
  ...(rowId !== undefined ? { rowId } : {})
})

const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => msg(`row-${from + index}`, from + index))

describe('messagesIfTranscriptBehind', () => {
  it('treats a retention-trimmed but current window as current', () => {
    // The latest page reaches further back than the store keeps after the
    // retention cut; the newest row is the same on both sides.
    const remote = rows(100, 140)
    const local = rows(130, 140)

    expect(messagesIfTranscriptBehind(local, remote)).toBeNull()
  })

  it('refuses when the authoritative page has a row newer than this window', () => {
    const remote = rows(100, 142)
    const local = rows(130, 140)

    expect(
      messagesIfTranscriptBehind(local, remote)
        ?.map(m => m.rowId)
        .at(-1)
    ).toBe(142)
  })

  it('does not block the window that streamed the latest turn itself', () => {
    const remote = rows(100, 142)
    const local = [...rows(130, 140), msg('live-user'), msg('live-assistant')]

    expect(messagesIfTranscriptBehind(local, remote)).toBeNull()
  })

  it('refuses when the whole latest page is newer than a longer backfilled window', () => {
    const remote = rows(500, 540)
    const local = rows(300, 400)

    expect(messagesIfTranscriptBehind(local, remote)).not.toBeNull()
  })

  it('refuses when another view added more rows than this window streamed', () => {
    const remote = rows(100, 144)
    const local = [...rows(130, 140), msg('live-user'), msg('live-assistant')]

    expect(messagesIfTranscriptBehind(local, remote)).not.toBeNull()
  })
})
