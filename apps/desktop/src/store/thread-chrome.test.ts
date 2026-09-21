import { beforeEach, describe, expect, it } from 'vitest'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { $fileBrowserOpen } from '@/store/layout'
import { $selectedStoredSessionId } from '@/store/session'
import { $threadChrome, applyThreadChrome } from '@/store/thread-chrome'

describe('thread chrome', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $threadChrome.set({ previewOpen: {}, terminalOpen: {} })
    $selectedStoredSessionId.set(null)
    applyThreadChrome()
  })

  it('collapses the terminal on a thread that did not open it', () => {
    $selectedStoredSessionId.set('session-a')
    setTerminalTakeover(true)
    expect($terminalTakeover.get()).toBe(true)

    $selectedStoredSessionId.set('session-b')
    expect($terminalTakeover.get()).toBe(false)

    $selectedStoredSessionId.set('session-a')
    expect($terminalTakeover.get()).toBe(true)
  })

  it('does not open the work slot when the terminal opens', () => {
    $selectedStoredSessionId.set('session-a')
    setTerminalTakeover(true)
    expect($fileBrowserOpen.get()).toBe(false)
    expect($terminalTakeover.get()).toBe(true)
  })

  it('does not reopen the work slot when chrome is already applied', () => {
    $selectedStoredSessionId.set('session-a')
    expect($fileBrowserOpen.get()).toBe(false)

    applyThreadChrome('session-a')
    applyThreadChrome('session-a')
    expect($fileBrowserOpen.get()).toBe(false)
    expect($terminalTakeover.get()).toBe(false)
  })
})
