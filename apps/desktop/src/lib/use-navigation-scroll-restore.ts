import { useEffect, type RefObject } from 'react'

import type { ThreadScrollState } from '@/store/thread-scroll'

import { subscribeNavigationScrollRestore } from './navigation-scroll'

/** Navigation changes intent through the transcript owner, not a second DOM writer. */
export function useNavigationScrollRestore(
  scrollRef: RefObject<HTMLElement | null>,
  restoreRef: RefObject<((target?: ThreadScrollState) => void) | null>,
  stopScroll: () => void,
  paneVisible: boolean
) {
  useEffect(() => {
    if (!paneVisible) {
      return
    }

    return subscribeNavigationScrollRestore(
      () => scrollRef.current,
      (top, element) => {
        if (restoreRef.current) {
          restoreRef.current({
            kind: 'offset',
            fromBottom: Math.max(0, element.scrollHeight - element.clientHeight - top)
          })
        } else {
          // Cached Bot messages can render before the live session key exists.
          // This transcript still owns its library's follow state during wakeup.
          stopScroll()
          element.scrollTop = top
        }
      }
    )
  }, [paneVisible, restoreRef, scrollRef, stopScroll])
}
