import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react'

const GROUP = '[data-slot="aui_message-group"]'
const PROMPT = '[data-slot="aui_user-message-root"]'
const TURN = '[data-slot="aui_turn-pair"]'
const CLIP = '--sticky-prompt-clip'
const ENGAGED = 'stickyEngaged'
const OFFSET = 'stickyOffset'

/** A prompt may pin only once its turn has reached the scroller's stick line
 *  and still occupies it. A turn still below that line — a message just sent,
 *  or one painted after switching back to the thread — stays in document order.
 *  Pinning it early floats the bubble on the message-list container while the
 *  previous turn is still visible underneath. */
export function stickyPromptEngaged(
  turnTop: number,
  turnBottom: number,
  viewportTop: number,
  stickyOffset: number
): boolean {
  const stickLine = viewportTop + stickyOffset

  return turnTop <= stickLine + 1 && turnBottom > stickLine + 1
}

function stickyOffsetOf(prompt: HTMLElement): number {
  const cached = prompt.dataset[OFFSET]

  if (cached) {
    return Number(cached)
  }

  const variable = Number.parseFloat(getComputedStyle(prompt).getPropertyValue('--sticky-human-offset'))
  const top = Number.parseFloat(getComputedStyle(prompt).top)
  const offset = Number.isFinite(variable) ? variable : Number.isFinite(top) ? top : 0

  prompt.dataset[OFFSET] = String(offset)

  return offset
}

function releaseStickyOverride(prompt: HTMLElement) {
  prompt.style.removeProperty('position')
  prompt.style.removeProperty('top')
  delete prompt.dataset[ENGAGED]
  delete prompt.dataset[OFFSET]
}

function syncStickyEngagement(prompt: HTMLElement, viewportTop: number) {
  const turn = prompt.closest<HTMLElement>(TURN) ?? prompt.closest<HTMLElement>(GROUP)

  if (!turn) {
    return
  }

  const turnRect = turn.getBoundingClientRect()
  const engaged = stickyPromptEngaged(turnRect.top, turnRect.bottom, viewportTop, stickyOffsetOf(prompt))
  const next = engaged ? 'true' : 'false'

  if (prompt.dataset[ENGAGED] === next) {
    return
  }

  prompt.dataset[ENGAGED] = next

  if (engaged) {
    prompt.style.removeProperty('position')
    prompt.style.removeProperty('top')

    return
  }

  // Inline, not a class: the bubble's `sticky` utility would otherwise win
  // and pin against whatever overflow ancestor survived a pane hide/show.
  prompt.style.position = 'relative'
  prompt.style.top = 'auto'
}

interface StickyPromptClipOptions {
  contentRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  paneVisible: boolean
  rows: ReactNode
}

/** Clip covered content instead of painting a solid rectangle over the glass. */
export function useStickyPromptClip({ contentRef, scrollRef, paneVisible, rows }: StickyPromptClipOptions) {
  const controller = useRef<ReturnType<typeof observeStickyPromptClip> | null>(null)

  useLayoutEffect(() => {
    const viewport = scrollRef.current
    const content = contentRef.current
    const previous = controller.current

    if (!paneVisible || previous?.viewport !== viewport || previous?.content !== content) {
      previous?.dispose()
      controller.current = null
    }

    if (paneVisible && viewport && content) {
      controller.current ??= observeStickyPromptClip(viewport, content)
      // Reconcile before paint without tearing down surviving clips when a
      // stream appends a message or the history window changes its rows.
      controller.current.reconcile()
    }
  }, [contentRef, scrollRef, paneVisible, rows])

  useLayoutEffect(
    () => () => {
      controller.current?.dispose()
      controller.current = null
    },
    []
  )
}

function observeStickyPromptClip(viewport: HTMLElement, content: HTMLElement) {
  const observed = new Set<HTMLElement>()
  const visible = new Set<HTMLElement>()
  const clipped = new Set<HTMLElement>()
  const engaged = new Set<HTMLElement>()
  let frame = 0

  const measure = () => {
    frame = 0
    const viewportTop = viewport.getBoundingClientRect().top
    const next = new Map<HTMLElement, number>()
    let activePrompt: HTMLElement | null = null
    let exclusionBottom = viewportTop

    for (const group of visible) {
      // Read only intersecting groups: measuring a skipped turn's descendants
      // would defeat content-visibility and wake the entire transcript.
      const prompt = group.querySelector<HTMLElement>(PROMPT)

      if (!prompt) {
        continue
      }

      syncStickyEngagement(prompt, viewportTop)
      engaged.add(prompt)

      const promptRect = prompt.getBoundingClientRect()
      const stickyTop = Number.parseFloat(getComputedStyle(prompt).top) || 0

      if (promptRect.top > viewportTop + stickyTop + 1 || promptRect.bottom <= viewportTop) {
        continue
      }

      // During the handoff, the later prompt supersedes the one being pushed
      // out. Its exclusion region also covers preceding turns in the top gap.
      if (!activePrompt || activePrompt.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING) {
        activePrompt = prompt
        exclusionBottom = promptRect.bottom
      }
    }

    if (activePrompt) {
      // Follow only the ancestor path to the active prompt. Other groups can
      // be clipped whole, including old prompts and standalone assistant rows.
      const collect = (element: HTMLElement) => {
        if (element === activePrompt) {
          return
        }

        if (element.contains(activePrompt)) {
          for (const child of element.children) {
            if (child instanceof HTMLElement) {
              collect(child)
            }
          }

          return
        }

        const rect = element.getBoundingClientRect()

        if (rect.height > 0 && rect.top < exclusionBottom) {
          next.set(element, Math.min(rect.height, exclusionBottom - rect.top))
        }
      }

      for (const group of visible) {
        // Keep the IO target itself unmasked; clipping it would change its
        // intersection and oscillate between hiding and revealing the group.
        for (const child of group.children) {
          if (child instanceof HTMLElement) {
            collect(child)
          }
        }
      }
    }

    // All geometry reads precede writes. Clipping changes no layout, scroll
    // position, or React state; only covered siblings get a style update.
    for (const element of clipped) {
      if (!next.has(element)) {
        element.style.removeProperty(CLIP)
        element.removeAttribute('data-sticky-prompt-clip')
      }
    }

    clipped.clear()

    for (const [element, inset] of next) {
      const value = `${inset}px`

      if (element.style.getPropertyValue(CLIP) !== value) {
        element.style.setProperty(CLIP, value)
        element.setAttribute('data-sticky-prompt-clip', '')
      }

      clipped.add(element)
    }
  }

  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(measure)
    }
  }

  const sizes = new ResizeObserver(schedule)

  const intersections = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        const group = entry.target as HTMLElement

        if (entry.isIntersecting) {
          visible.add(group)
          sizes.observe(group)
        } else {
          visible.delete(group)
          sizes.unobserve(group)
        }
      }

      schedule()
    },
    { root: viewport }
  )

  const reconcile = () => {
    const groups = new Set(content.querySelectorAll<HTMLElement>(GROUP))
    const viewportRect = viewport.getBoundingClientRect()

    for (const group of observed) {
      if (!groups.has(group)) {
        intersections.unobserve(group)
        sizes.unobserve(group)
        observed.delete(group)
        visible.delete(group)
      }
    }

    for (const group of groups) {
      if (!observed.has(group)) {
        intersections.observe(group)
        observed.add(group)
      }

      // A row commit can rehome a turn before IO delivers. Measure only outer
      // boxes here; never force layout inside content-visibility's skipped rows.
      const rect = group.getBoundingClientRect()

      if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
        visible.add(group)
        sizes.observe(group)
      } else {
        visible.delete(group)
        sizes.unobserve(group)
      }
    }

    cancelAnimationFrame(frame)
    measure()
  }

  sizes.observe(viewport)
  sizes.observe(content)
  viewport.addEventListener('scroll', schedule, { passive: true })

  const dispose = () => {
    intersections.disconnect()
    sizes.disconnect()
    viewport.removeEventListener('scroll', schedule)
    cancelAnimationFrame(frame)

    for (const element of clipped) {
      element.style.removeProperty(CLIP)
      element.removeAttribute('data-sticky-prompt-clip')
    }

    for (const prompt of engaged) {
      releaseStickyOverride(prompt)
    }
  }

  return { viewport, content, reconcile, dispose }
}
