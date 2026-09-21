import { beforeEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import { $messages, $selectedStoredSessionId, $sessionResumeRequest } from '@/store/session'
import { saveTranscriptTail } from '@/store/transcript-tail-cache'

import { paintCachedLocalBotChat } from './cached-bot-paint'
import type { RosterRow } from './types'

const msg = (id: string): ChatMessage => ({ id, parts: [{ text: 'last turn', type: 'text' }], role: 'assistant' }) as never

const localBot = (name: string, id: string): RosterRow =>
  ({
    canonical_session: { id, resolved_id: id },
    connectionId: 'local',
    connectionKind: 'local',
    name,
    sourceScoped: true
  }) as RosterRow

beforeEach(() => {
  window.localStorage.clear()
  $messages.set([])
  $selectedStoredSessionId.set(null)
})

describe('paintCachedLocalBotChat', () => {
  it('paints the cached transcript in the calling turn and does not dial', () => {
    saveTranscriptTail('frodo-chat', [msg('cached-row')], { connectionId: 'local', profile: 'frodo' })

    const painted = paintCachedLocalBotChat(localBot('frodo', 'frodo-chat'))

    expect(painted).toBe(true)
    expect($messages.get().map(row => row.id)).toEqual(['cached-row'])
    expect($selectedStoredSessionId.get()).toBe('frodo-chat')
    expect($sessionResumeRequest.get()?.ownerRoute).toEqual({
      connectionId: 'local',
      mode: 'local',
      profile: 'frodo',
      targetProfile: 'frodo'
    })
  })

  it('does not paint a remote bot from the local cache', () => {
    saveTranscriptTail('remote-chat', [msg('remote-row')], { connectionId: 'homelab', profile: 'writer' })

    const painted = paintCachedLocalBotChat({
      canonical_session: { id: 'remote-chat' },
      connectionId: 'homelab',
      connectionKind: 'ssh',
      name: 'writer',
      sourceScoped: true
    } as RosterRow)

    expect(painted).toBe(false)
    expect($messages.get()).toEqual([])
  })
})
