import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import type { SessionMessage } from '@/types/hermes'

import { toChatMessages } from './chat-messages'
import { messagesIfTranscriptBehind } from './stale-transcript-guard'


const msg = (id: string, rowId?: number): ChatMessage => ({
  id,
  role: rowId !== undefined && rowId % 2 === 0 ? 'assistant' : 'user',
  parts: [{ type: 'text', text: id }],
  ...(rowId !== undefined ? { rowId } : {})
})

const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => msg(`row-${from + index}`, from + index))



/**
 * The guard refuses a send when the authoritative latest page holds MORE
 * transcript than the window does, rather than forking the session (#65047).
 * It measures that difference with `remoteChat.length > localMessages.length`
 * after `toChatMessages`.
 *
 * A backend-authored NOTICE also arrives as a `ChatMessage` (`model changed`,
 * `background agent work finished`): `tui_gateway/server.py` persists
 * `display_kind=model_switch` with `role=user` on an in-place model switch, and
 * hydration renders it as a system row. Nothing about it means another window
 * exists — but it inflates the page by one message per event, so the guard
 * reported "This window was behind another view of the same chat" to a user who
 * had only switched models, refused the send, and said the same thing on every
 * retry. Staleness must be measured in AUTHORED content, not array length.
 */

const row = (over: Partial<SessionMessage> & Pick<SessionMessage, 'role'>): SessionMessage => ({
  content: '',
  timestamp: 1_700_000_000,
  ...over
})

const userTurn = (id: number, text: string): SessionMessage =>
  row({ content: text, id, role: 'user', timestamp: 1_700_000_000 + id })

const assistantTurn = (id: number, text: string): SessionMessage =>
  row({ content: text, id, role: 'assistant', timestamp: 1_700_000_000 + id })

/** What an in-place model switch persists, exactly as the gateway writes it. */
const modelSwitchNotice = (id: number): SessionMessage =>
  row({
    content: 'switched to another model',
    display_kind: 'model_switch',
    id,
    role: 'user',
    timestamp: 1_700_000_000 + id
  })

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


  it('does not treat a backend-authored notice as another view being ahead', () => {
    const windowMessages = toChatMessages([userTurn(1, 'ask'), assistantTurn(2, 'answer')])
    const page = toChatMessages([userTurn(1, 'ask'), assistantTurn(2, 'answer'), modelSwitchNotice(3)])

    // The notice is a real message in the page: this is what skews a length compare.
    expect(page).toHaveLength(3)
    expect(page.map(message => message.role)).toEqual(['user', 'assistant', 'system'])

    expect(messagesIfTranscriptBehind(windowMessages, page)).toBeNull()
  })

  it('still refuses when another view advanced the chat with a real turn', () => {
    const windowMessages = toChatMessages([userTurn(1, 'ask'), assistantTurn(2, 'answer')])

    const page = toChatMessages([
      userTurn(1, 'ask'),
      assistantTurn(2, 'answer'),
      userTurn(4, 'sent from another window')
    ])

    expect(messagesIfTranscriptBehind(windowMessages, page)).not.toBeNull()
  })

  it('still refuses when a notice arrives alongside a reply this window never saw', () => {
    const windowMessages = toChatMessages([userTurn(1, 'ask'), assistantTurn(2, 'answer')])

    const page = toChatMessages([
      userTurn(1, 'ask'),
      assistantTurn(2, 'answer'),
      modelSwitchNotice(3),
      assistantTurn(4, 'a reply this window never rendered')
    ])

    expect(messagesIfTranscriptBehind(windowMessages, page)).not.toBeNull()
  })

  it('is current when both sides hold the same notices and the same turns', () => {
    const rows = [userTurn(1, 'ask'), assistantTurn(2, 'answer'), modelSwitchNotice(3)]

    expect(messagesIfTranscriptBehind(toChatMessages(rows), toChatMessages(rows))).toBeNull()
  })

  it('is current when the page is empty, and refreshes a window that holds nothing', () => {
    const rows = [userTurn(1, 'ask'), assistantTurn(2, 'answer')]

    expect(messagesIfTranscriptBehind(toChatMessages(rows), [])).toBeNull()
    expect(messagesIfTranscriptBehind([], toChatMessages(rows))).toEqual(toChatMessages(rows))

  })
})
