import { act, cleanup, render } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, it, vi } from 'vitest'

import { stubThreadEnvironment } from '@/components/assistant-ui/test-utils'
import type { ChatMessage } from '@/lib/chat-messages'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from './session-view'

import { ChatRuntimeBoundary } from '.'

stubThreadEnvironment()

afterEach(cleanup)

const message = (rowId: number): ChatMessage => ({
  id: `live-${rowId}`,
  rowId,
  role: 'user',
  parts: [{ type: 'text', text: `prompt ${rowId}` }]
})

describe('workspace runtime getSnapshot loop', () => {
  it('does not throw on an idle ChatRuntimeBoundary mount', async () => {
    const $messages = atom(Array.from({ length: 8 }, (_, index) => message(index + 1)))
    const view = {
      ...PRIMARY_SESSION_VIEW,
      $messages,
      $runtimeId: atom<string | null>('runtime'),
      $storedId: atom<string | null>('stored')
    }
    const mutations = {
      onEdit: vi.fn(),
      onReload: vi.fn(),
      onCancel: vi.fn(),
      onThreadMessagesChange: vi.fn()
    }

    render(
      <SessionViewProvider value={view}>
        <ChatRuntimeBoundary busy={false} suppressMessages={false} {...mutations}>
          <div>idle</div>
        </ChatRuntimeBoundary>
      </SessionViewProvider>
    )

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
  })
})
