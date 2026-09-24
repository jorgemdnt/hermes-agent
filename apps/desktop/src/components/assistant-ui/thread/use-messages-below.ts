import { type ReactNode, type RefObject, useEffect } from 'react'

import { publishThreadMessagesBelow } from '@/store/thread-scroll'

const MESSAGE_ROOTS =
  '[data-slot="aui_user-message-root"], [data-slot="aui_assistant-message-root"], [data-slot="aui_system-message-root"]'

interface MessagesBelowOptions {
  contentRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  isAtBottom: boolean
  paneVisible: boolean
  rows: ReactNode
  sessionKey: string | null | undefined
  sessionId: string | null
}

/**
 * Only measure inside the viewport's turn; leave skipped off-screen content
 * asleep. `settled` is false when the turn straddling the fold has no layout
 * boxes yet: content-visibility relevancy updates a frame after a programmatic
 * scroll (a rail jump), and until then its messages measure as empty rects —
 * counting them as "above the fold" undercounts by that turn.
 */
export function countMessagesBelow(viewport: HTMLElement, content: HTMLElement): { count: number; settled: boolean } {
  const viewportRect = viewport.getBoundingClientRect()
  const top = viewportRect.top
  const bottom = viewportRect.bottom
  const shown = new Set<string>()
  let count = 0
  let settled = true

  const remember = (group: HTMLElement) => {
    for (const message of group.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-root"]')) {
      const text = message.textContent?.trim()

      if (text) {
        shown.add(text)
      }
    }
  }

  const isPaintedClone = (message: HTMLElement) => {
    if (message.dataset.slot !== 'aui_assistant-message-root') {
      return false
    }

    const text = message.textContent?.trim()

    return Boolean(text && shown.has(text))
  }

  for (const group of content.querySelectorAll<HTMLElement>('[data-slot="aui_message-group"]')) {
    const rect = group.getBoundingClientRect()

    if (rect.bottom <= top + 1) {
      continue
    }

    if (rect.bottom <= bottom + 1) {
      remember(group)

      continue
    }

    const messages = group.querySelectorAll<HTMLElement>(MESSAGE_ROOTS)

    if (rect.top >= bottom) {
      count += messages.length

      continue
    }

    for (const message of messages) {
      const messageRect = message.getBoundingClientRect()

      if (messageRect.height === 0 && messageRect.width === 0) {
        settled = false
      } else if (messageRect.height > 0 && messageRect.bottom <= bottom + 1) {
        const text = message.textContent?.trim()

        if (message.dataset.slot === 'aui_assistant-message-root' && text) {
          shown.add(text)
        }
      } else if (messageRect.height > 0 && messageRect.bottom > bottom + 1 && !isPaintedClone(message)) {
        count++
      }
    }
  }

  return { count, settled }
}

export function useMessagesBelow({
  contentRef,
  scrollRef,
  isAtBottom,
  paneVisible,
  rows,
  sessionKey,
  sessionId
}: MessagesBelowOptions) {
  useEffect(() => {
    if (!paneVisible) {
      return
    }

    if (isAtBottom) {
      publishThreadMessagesBelow(0, { paneVisible, sessionId })

      return
    }

    const viewport = scrollRef.current
    const content = contentRef.current

    if (!viewport || !content) {
      return
    }

    let frame = 0
    let retried = false

    const measure = () => {
      frame = 0
      const { count, settled } = countMessagesBelow(viewport, content)

      // One extra frame lets the skipped turn gain boxes; then publish what is
      // there so an empty turn can never stall the count.
      if (!settled && !retried) {
        retried = true
        schedule()

        return
      }

      retried = false
      publishThreadMessagesBelow(count, { paneVisible, sessionId })
    }

    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(measure)
      }
    }

    schedule()
    viewport.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    observer.observe(content)

    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [contentRef, scrollRef, isAtBottom, paneVisible, rows, sessionKey, sessionId])
}
