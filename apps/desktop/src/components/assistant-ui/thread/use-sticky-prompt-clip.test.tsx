import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { StickyHumanMessageContainer } from './user-message'
import { seatedPromptTop, stickyPromptEngaged, useStickyPromptClip } from './use-sticky-prompt-clip'

const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('clips only visible covered siblings, follows resize, and releases styles and observers on hide', () => {
  const viewport = window.document.createElement('div')
  const content = window.document.createElement('div')
  viewport.append(content)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 500))

  const makeGroup = () => {
    const group = window.document.createElement('div')
    group.dataset.slot = 'aui_message-group'
    const editor = window.document.createElement('div')
    editor.style.display = 'contents'
    const prompt = window.document.createElement('div')
    prompt.dataset.slot = 'aui_user-message-root'
    prompt.style.top = '5px'
    const attachments = window.document.createElement('div')
    const reply = window.document.createElement('div')
    group.append(editor, reply)
    editor.append(prompt, attachments)
    content.append(group)

    return {
      group,
      prompt,
      attachments,
      reply,
      promptRect: vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue(rect(5, 60)),
      attachmentRect: vi.spyOn(attachments, 'getBoundingClientRect').mockReturnValue(rect(-50, 40)),
      replyRect: vi.spyOn(reply, 'getBoundingClientRect').mockReturnValue(rect(-10, 900))
    }
  }

  const visible = makeGroup()
  const skipped = makeGroup()
  vi.spyOn(visible.group, 'getBoundingClientRect').mockReturnValue(rect(0, 900))
  vi.spyOn(skipped.group, 'getBoundingClientRect').mockReturnValue(rect(900, 900))
  let intersection: IntersectionObserverCallback
  let resize: ResizeObserverCallback
  let frame: FrameRequestCallback | undefined
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback

    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined
  })

  const flush = () =>
    act(() => {
      const run = frame
      frame = undefined
      run?.(0)
    })

  const options = {
    scrollRef: { current: viewport },
    contentRef: { current: content },
    paneVisible: true,
    rows: 'initial'
  }

  const { rerender } = renderHook(props => useStickyPromptClip(props), { initialProps: options })
  expect(observe).toHaveBeenCalledWith(skipped.group)
  act(() =>
    intersection(
      [
        {
          target: visible.group,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: rect(0, 900),
          intersectionRect: rect(0, 500),
          rootBounds: rect(0, 500),
          time: 0
        }
      ],
      {} as IntersectionObserver
    )
  )
  flush()
  expect(visible.reply.style.getPropertyValue('--sticky-prompt-clip')).toBe('75px')
  expect(visible.attachments.style.getPropertyValue('--sticky-prompt-clip')).toBe('40px')
  expect(visible.prompt.hasAttribute('data-sticky-prompt-clip')).toBe(false)
  expect(skipped.promptRect).not.toHaveBeenCalled()
  expect(skipped.replyRect).not.toHaveBeenCalled()

  // A new message or backfill changes rows while the same prompt is pinned.
  // Its existing mask must survive the commit, before any observer/rAF delivery.
  rerender({ ...options, rows: 'appended' })
  expect(visible.reply.style.getPropertyValue('--sticky-prompt-clip')).toBe('75px')
  expect(disconnect).not.toHaveBeenCalled()

  visible.promptRect.mockReturnValue(rect(5, 120))
  act(() => resize([], {} as ResizeObserver))
  flush()
  expect(visible.reply.style.getPropertyValue('--sticky-prompt-clip')).toBe('135px')

  visible.promptRect.mockReturnValue(rect(80, 120))
  act(() => viewport.dispatchEvent(new Event('scroll')))
  flush()
  expect(visible.reply.hasAttribute('data-sticky-prompt-clip')).toBe(false)
  expect(visible.attachments.hasAttribute('data-sticky-prompt-clip')).toBe(false)

  visible.promptRect.mockReturnValue(rect(5, 120))
  act(() => viewport.dispatchEvent(new Event('scroll')))
  flush()
  expect(visible.reply.hasAttribute('data-sticky-prompt-clip')).toBe(true)
  rerender({ ...options, paneVisible: false })
  expect(visible.reply.style.getPropertyValue('--sticky-prompt-clip')).toBe('')
  expect(disconnect).toHaveBeenCalledTimes(2)
})

it('pins a prompt only once its turn reaches the stick line', () => {
  // A just-sent message, or one painted after switching back, still sits below
  // the scroller top. Sticky must not lift it onto the list container.
  expect(stickyPromptEngaged(180, 420, 0, 5)).toBe(false)
  // The turn has crossed the stick line and still occupies the scroller: pin.
  expect(stickyPromptEngaged(-40, 800, 0, 5)).toBe(true)
  // Scrolled fully past: the turn is gone, nothing to pin.
  expect(stickyPromptEngaged(-900, -20, 0, 5)).toBe(false)
  // Subpixel noise at the line is still a pin, matching the clip epsilon.
  expect(stickyPromptEngaged(6, 400, 0, 5)).toBe(true)
})

it('keeps a below-the-fold prompt in flow and releases the override once the turn reaches the line', () => {
  const viewport = window.document.createElement('div')
  const content = window.document.createElement('div')
  viewport.append(content)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 500))

  const group = window.document.createElement('div')
  group.dataset.slot = 'aui_message-group'
  const turn = window.document.createElement('div')
  turn.dataset.slot = 'aui_turn-pair'
  const prompt = window.document.createElement('div')
  prompt.dataset.slot = 'aui_user-message-root'
  prompt.style.top = '5px'
  turn.append(prompt)
  group.append(turn)
  content.append(group)

  const turnRect = vi.spyOn(turn, 'getBoundingClientRect').mockReturnValue(rect(180, 240))
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(rect(180, 240))
  const promptRect = vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue(rect(180, 60))

  let frame: FrameRequestCallback | undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined
  })

  renderHook(() =>
    useStickyPromptClip({
      scrollRef: { current: viewport },
      contentRef: { current: content },
      paneVisible: true,
      rows: 'sent'
    })
  )

  expect(prompt.style.position).toBe('relative')
  expect(prompt.style.top).toBe('auto')

  turnRect.mockReturnValue(rect(-20, 700))
  promptRect.mockReturnValue(rect(-20, 60))
  act(() => viewport.dispatchEvent(new Event('scroll')))
  act(() => {
    const run = frame
    frame = undefined
    run?.(0)
  })

  expect(prompt.style.position).toBe('sticky')
  expect(prompt.style.top).toBe('')
})

function stubObservers() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)

    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

it('does not pin a prompt the scroller has not reached, including one still below the fold', () => {
  // The sticky utility is what pins an unmeasured bubble to the list container.
  // A turn the observer has not intersected must not keep that position.
  const style = window.document.createElement('style')
  style.textContent = '.sticky { position: sticky; top: 5px; }'
  window.document.head.append(style)

  const viewport = window.document.createElement('div')
  const content = window.document.createElement('div')
  viewport.append(content)
  window.document.body.append(viewport)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 500))

  const group = window.document.createElement('div')
  group.dataset.slot = 'aui_message-group'
  const turn = window.document.createElement('div')
  turn.dataset.slot = 'aui_turn-pair'
  group.append(turn)
  content.append(group)
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(rect(800, 240))
  vi.spyOn(turn, 'getBoundingClientRect').mockReturnValue(rect(800, 240))
  stubObservers()

  render(<StickyHumanMessageContainer>1. make sure we can have that pipe</StickyHumanMessageContainer>, {
    container: turn
  })
  const prompt = turn.querySelector<HTMLElement>('[data-slot="aui_user-message-root"]')!

  renderHook(() =>
    useStickyPromptClip({
      scrollRef: { current: viewport },
      contentRef: { current: content },
      paneVisible: true,
      rows: 'sent'
    })
  )

  expect(getComputedStyle(prompt).position).not.toBe('sticky')
  style.remove()
  viewport.remove()
})

it('drops a pin when the turn scrolls back below the fold', () => {
  const viewport = window.document.createElement('div')
  const content = window.document.createElement('div')
  viewport.append(content)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 500))

  const group = window.document.createElement('div')
  group.dataset.slot = 'aui_message-group'
  const turn = window.document.createElement('div')
  turn.dataset.slot = 'aui_turn-pair'
  const prompt = window.document.createElement('div')
  prompt.dataset.slot = 'aui_user-message-root'
  prompt.style.top = '5px'
  turn.append(prompt)
  group.append(turn)
  content.append(group)

  const groupRect = vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(rect(-20, 700))
  vi.spyOn(turn, 'getBoundingClientRect').mockReturnValue(rect(-20, 700))
  vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue(rect(5, 60))

  let frame: FrameRequestCallback | undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback

    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined
  })

  renderHook(() =>
    useStickyPromptClip({
      scrollRef: { current: viewport },
      contentRef: { current: content },
      paneVisible: true,
      rows: 'pinned'
    })
  )

  expect(prompt.style.position).toBe('sticky')

  groupRect.mockReturnValue(rect(800, 240))
  act(() => viewport.dispatchEvent(new Event('scroll')))
  act(() => {
    const run = frame
    frame = undefined
    run?.(0)
  })

  expect(prompt.style.position).toBe('relative')
  expect(prompt.style.top).toBe('auto')
})

it('keeps a just-sent prompt after the previous turn, at the bottom of the viewport', () => {
  // The measured turn includes the previous turn, so its top is already above
  // the stick line on send. The bubble was sent at the bottom. It must stay
  // there, not jump to the top while the previous turn is still in view.
  const viewportTop = 0
  const viewportBottom = 500
  const stickyOffset = 5
  const previousTop = 12
  const previousBottom = 430
  const sentTop = 448
  const sentBottom = 488

  const seat = seatedPromptTop({
    promptTop: sentTop,
    promptBottom: sentBottom,
    turnTop: -180,
    turnBottom: viewportBottom,
    previousTop,
    previousBottom,
    viewportTop,
    viewportBottom,
    stickyOffset
  })

  expect(seat).toBe(sentTop)
  expect(seat).toBeGreaterThan(previousTop)
  expect(seat).toBeLessThan(viewportBottom)
  expect(seat).toBeGreaterThan(viewportTop + stickyOffset + 1)

  const viewport = window.document.createElement('div')
  const content = window.document.createElement('div')
  viewport.append(content)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(viewportTop, viewportBottom))

  const previous = window.document.createElement('div')
  previous.dataset.slot = 'aui_message-group'
  content.append(previous)
  vi.spyOn(previous, 'getBoundingClientRect').mockReturnValue(rect(previousTop, previousBottom - previousTop))

  const group = window.document.createElement('div')
  group.dataset.slot = 'aui_message-group'
  const turn = window.document.createElement('div')
  turn.dataset.slot = 'aui_turn-pair'
  const prompt = window.document.createElement('div')
  prompt.dataset.slot = 'aui_user-message-root'
  prompt.textContent = 'Ok close it, it is fixed I guess'
  turn.append(prompt)
  group.append(turn)
  content.append(group)
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(rect(sentTop, sentBottom - sentTop))
  vi.spyOn(turn, 'getBoundingClientRect').mockReturnValue(rect(-180, viewportBottom + 180))
  vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue(rect(sentTop, sentBottom - sentTop))
  stubObservers()

  renderHook(() =>
    useStickyPromptClip({
      scrollRef: { current: viewport },
      contentRef: { current: content },
      paneVisible: true,
      rows: 'just-sent'
    })
  )

  const stickLine = viewportTop + stickyOffset
  const seated = prompt.style.position === 'sticky' ? stickLine : sentTop

  expect(prompt.style.position).toBe('relative')
  expect(seated).toBe(sentTop)
  expect(seated).toBeGreaterThan(previousTop)
})
