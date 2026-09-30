import type { NavigationEntry } from '@/store/navigation-history'

function viewport(entry: NavigationEntry): HTMLElement | null {
  const anchors = entry.pane?.startsWith('session-tile:')
    ? [entry.pane]
    : [entry.pane, `session-tile:${entry.session}`, 'workspace']
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-session-anchor]'))
  const surface = anchors
    .map(anchor => surfaces.find(element => element.dataset.sessionAnchor === anchor))
    .find(element => element && !element.closest('[data-pane-hidden]'))

  const element = surface?.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')

  return element?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? element : null
}

export function captureNavigationScroll(entry: NavigationEntry): number | undefined {
  const element = viewport(entry)

  return element && element.clientHeight > 0 ? element.scrollTop : undefined
}

/** Browser layout changes can overwrite the transcript's per-session offset. */
export function restoreNavigationScroll(entry: NavigationEntry, onSettled: () => void): () => void {
  const top = entry.scrollTop

  if (top === undefined) {
    onSettled()

    return () => {}
  }
  let frame = 0
  let stableFrames = 0
  let lastHeight = -1
  let request = 0
  const restore = () => {
    const element = viewport(entry)

    if (element && element.clientHeight > 0) {
      const height = element.scrollHeight
      element.scrollTop = top
      stableFrames = height === lastHeight && element.scrollTop === top ? stableFrames + 1 : 0
      lastHeight = height
    }
    // Match the transcript's bounded settle window; don't freeze a live stream.
    if (++frame < 90 && stableFrames < 3) {
      request = requestAnimationFrame(restore)
    } else {
      onSettled()
    }
  }
  request = requestAnimationFrame(restore)

  return () => cancelAnimationFrame(request)
}
