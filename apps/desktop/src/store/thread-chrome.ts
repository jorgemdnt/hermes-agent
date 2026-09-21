import { atom } from 'nanostores'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { readKey, writeKey } from '@/lib/storage'

import { $fileBrowserOpen, setFileBrowserOpen } from './layout'
import { $selectedStoredSessionId } from './session'

/**
 * Preview-rail and terminal open/closed follow the focused thread independently.
 * The terminal is a bottom split under chat; opening it must not unhide the
 * work slot.
 *
 * Do not import session-states from this file. session-states already imports
 * preview, and preview used to pull this module in — that cycle left
 * `$focusedStoredSessionId` undefined in the packed bundle, so `.listen` threw
 * on boot and the window rendered blank.
 */

const STORAGE_KEY = 'hermes.desktop.threadChrome.v1'
const DRAFT_OWNER = '__draft__'

export interface ThreadChrome {
  previewOpen: Record<string, boolean>
  terminalOpen: Record<string, boolean>
}

let chromeOwner = DRAFT_OWNER

function ownerKey(): string {
  return chromeOwner
}

function load(): ThreadChrome {
  try {
    const raw = readKey(STORAGE_KEY)

    if (!raw) {
      return { previewOpen: {}, terminalOpen: {} }
    }

    const parsed = JSON.parse(raw) as Partial<ThreadChrome>
    const asFlagMap = (value: unknown): Record<string, boolean> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {}
      }

      const out: Record<string, boolean> = {}

      for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
        if (typeof flag === 'boolean') {
          out[key] = flag
        }
      }

      return out
    }

    return { previewOpen: asFlagMap(parsed.previewOpen), terminalOpen: asFlagMap(parsed.terminalOpen) }
  } catch {
    return { previewOpen: {}, terminalOpen: {} }
  }
}

export const $threadChrome = atom<ThreadChrome>(load())

let applying = false

function persist(state: ThreadChrome) {
  writeKey(STORAGE_KEY, JSON.stringify(state))
}

function patch(owner: string, field: 'previewOpen' | 'terminalOpen', value: boolean) {
  const cur = $threadChrome.get()

  if (cur[field][owner] === value) {
    return
  }

  const next: ThreadChrome = { ...cur, [field]: { ...cur[field], [owner]: value } }

  $threadChrome.set(next)
  persist(next)
}

export function threadPreviewOpen(owner = ownerKey()): boolean {
  return $threadChrome.get().previewOpen[owner] ?? false
}

export function applyThreadChrome(owner = $selectedStoredSessionId.get()?.trim() || chromeOwner) {
  const nextOwner = owner.trim() || DRAFT_OWNER
  const chrome = $threadChrome.get()
  const preview = chrome.previewOpen[nextOwner] ?? false
  const terminal = chrome.terminalOpen[nextOwner] ?? false

  chromeOwner = nextOwner

  // Focus/selection both push chrome. Re-applying the same flags still called
  // setFileBrowserOpen, which restores hidden right-rail tabs and can retrigger
  // layout → focus → apply in a loop (packed boot: getSnapshot "Maximum update
  // depth exceeded").
  if ($fileBrowserOpen.get() === preview && $terminalTakeover.get() === terminal) {
    return
  }

  applying = true
  // Terminal is a bottom split under chat. The work slot is preview only —
  // opening the terminal must not unhide "Nothing open" on the right.
  setFileBrowserOpen(preview)
  setTerminalTakeover(terminal)
  applying = false
}

$fileBrowserOpen.listen(open => {
  if (applying) {
    return
  }

  patch(ownerKey(), 'previewOpen', open)
})

$terminalTakeover.listen(open => {
  if (applying) {
    return
  }

  patch(ownerKey(), 'terminalOpen', open)
})

$selectedStoredSessionId.listen(selected => {
  applyThreadChrome(selected?.trim() || DRAFT_OWNER)
})
