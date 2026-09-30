import type { GatewayEventName } from '@hermes/shared'
import { act, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { chatMessageText } from '@/lib/chat-messages'

import { renderMessageStream } from './test-harness'

const SID = 'streaming-turn-once'
const PREAMBLE = "I'll read the kanban docs and the work-placement rules."
const ANSWER = 'Kanban is a shared task board, not a chat.'

function mount() {
  const stream = renderMessageStream(SID)

  const send = (type: GatewayEventName, payload: Record<string, unknown> = {}) =>
    act(() => stream.handleEvent({ payload, session_id: SID, type }))

  return { stream, send }
}

afterEach(cleanup)

it('paints one streaming turn when the sealed answer and tool results are replayed', () => {
  const { stream, send } = mount()

  send('message.start')
  send('message.delta', { text: PREAMBLE })
  send('message.interim', { already_streamed: true, text: PREAMBLE })
  send('tool.start', { args: { name: 'how' }, name: 'skill_view', tool_id: 'call-skill' })
  send('tool.complete', { name: 'skill_view', result: 'docs', tool_id: 'call-skill' })
  send('tool.start', { args: { path: 'kanban.md' }, name: 'read_file', tool_id: 'call-read' })
  send('tool.complete', { name: 'read_file', result: 'board', tool_id: 'call-read' })
  send('message.delta', { text: ANSWER })
  send('message.interim', { already_streamed: true, text: ANSWER })

  // Still streaming. Identical results may refresh finished rows; a new
  // tool.start is a new invocation even when the provider reuses its id.
  send('message.delta', { text: ANSWER })
  send('tool.complete', { name: 'skill_view', result: 'docs', tool_id: 'call-skill' })
  send('tool.complete', { name: 'read_file', result: 'board', tool_id: 'call-read' })

  const messages = stream.state(SID).messages
  const painted = messages
    .filter(message => message.role === 'assistant' && !message.hidden)
    .map(message => chatMessageText(message))

  expect(painted.filter(text => text.includes(ANSWER))).toHaveLength(1)
  expect(painted.filter(text => text.includes(PREAMBLE))).toHaveLength(1)

  const toolIds = messages.flatMap(message =>
    message.parts.flatMap(part => (part.type === 'tool-call' ? [part.toolCallId] : []))
  )

  expect(toolIds.filter(id => id === 'call-skill')).toHaveLength(1)
  expect(toolIds.filter(id => id === 'call-read')).toHaveLength(1)
})

it('keeps reused ids as separate calls after an interim, even with identical args', () => {
  const { stream, send } = mount()
  const call = { args: { command: 'status' }, name: 'terminal', tool_id: 'call-constant' }

  send('message.start')
  send('tool.start', call)
  send('tool.complete', { ...call, result: 'first status' })
  send('message.interim', { text: 'Checking again.' })
  send('tool.start', call)
  send('tool.complete', { ...call, result: 'second status' })

  const calls = stream.state(SID).messages.flatMap(message =>
    message.parts.filter(part => part.type === 'tool-call' && part.toolCallId === call.tool_id)
  )

  expect(calls).toEqual([
    expect.objectContaining({ result: 'first status' }),
    expect.objectContaining({ result: 'second status' })
  ])
})
