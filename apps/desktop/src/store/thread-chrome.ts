import { atom } from 'nanostores'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { readKey, writeKey } from '@/lib/storage'

import { $fileBrowserOpen, setFileBrowserOpen } from './layout'
import { $focusedStoredSessionId } from './session-states'

/**
 * Preview-rail and terminal open/closed follow the focused thread. Switching
 * to a chat that never opened them must not leave an empty preview (or a
 * terminal) hanging from the previous chat.
 */

const STORAGE_KEY = 'hermes.desktop.threadChrome.v1'
const DRAFT_OWNER = '__draft__'

export interface ThreadChrome {
  previewOpen: Record<string, boolean>
  terminalOpen: Record<string, boolean>
}

function ownerKey(): string {
  return $focusedStoredSessionId.get()?.trim() || DRAFT_OWNER
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

export function applyThreadChrome(owner = ownerKey()) {
  const chrome = $threadChrome.get()
  const preview = chrome.previewOpen[owner] ?? false
  const terminal = chrome.terminalOpen[owner] ?? false

  applying = true
  setFileBrowserOpen(preview || terminal)
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

  if (open && !$fileBrowserOpen.get()) {
    applying = true
    setFileBrowserOpen(true)
    applying = false
  }
})

$focusedStoredSessionId.listen(() => {
  applyThreadChrome()
})
