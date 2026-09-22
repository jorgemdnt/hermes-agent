import { atom, computed } from 'nanostores'

import { $registryVersion } from '@/contrib/registry'
import { allKeybindActions, defaultBindings, keybindAction, type KeybindBindings } from '@/lib/keybinds/actions'
import { canonicalizeCombo } from '@/lib/keybinds/combo'
import { arraysEqual, persistString, storedString } from '@/lib/storage'

const STORAGE_KEY = 'hermes.desktop.keybinds'

// The user's raw stored overrides. Kept verbatim so an action CONTRIBUTED
// after module init (plugins register late) still resolves its saved rebind —
// `bindingsFor` consults this before falling back to shipped defaults.
function readStoredOverrides(): Record<string, string[]> {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string[]> = {}

    for (const [id, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[id] = value.filter((combo): combo is string => typeof combo === 'string')
      }
    }

    return out
  } catch {
    // Corrupt storage falls back to defaults.
    return {}
  }
}

const storedOverrides = readStoredOverrides()

const MOD_J = 'mod+j'

/** ⌘J is the terminal. A stale override (stock used to put it on the rail)
 *  must not win — first-wins in the combo index lists the rail first. */
export function withoutRailOnModJ(bindings: KeybindBindings): KeybindBindings {
  const next: KeybindBindings = { ...bindings }
  const rail = [...(next['view.toggleRightSidebar'] ?? [])]
  const stripped = rail.filter(combo => canonicalizeCombo(combo) !== MOD_J)

  if (stripped.length !== rail.length) {
    next['view.toggleRightSidebar'] = stripped.length > 0 ? stripped : ['mod+alt+b']
  }

  const term = [...(next['view.showTerminal'] ?? [])]

  if (!term.some(combo => canonicalizeCombo(combo) === MOD_J)) {
    next['view.showTerminal'] = [MOD_J, ...term]
  }

  return next
}

export function buildComboIndex(bindings: KeybindBindings): Map<string, string> {
  const index = new Map<string, string>()
  const resolved = withoutRailOnModJ(bindings)

  for (const action of allKeybindActions()) {
    for (const combo of resolved[action.id] ?? bindingsFor(action.id, resolved)) {
      const key = canonicalizeCombo(combo)

      if (!index.has(key)) {
        index.set(key, action.id)
      }
    }
  }

  // ⌘1–9 are sidebar rows (active Sessions or Bots tab). Profile slots ship
  // `mod+N` first in KEYBIND_ACTIONS, so first-wins would keep ⌘1 on
  // profile.switch.1 — a no-op when only `default` exists. Same pattern as ⌘J.
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = `sidebar.row.${slot}`

    if (allKeybindActions().some(action => action.id === id)) {
      index.set(canonicalizeCombo(`mod+${slot}`), id)
    }
  }

  index.set(canonicalizeCombo(MOD_J), 'view.showTerminal')

  return index
}

// Defaults overlaid with the user's stored overrides. Unknown / stale action
// ids are dropped; actions added in a later release pick up their shipped
// default; late-registered contributed actions resolve via `bindingsFor`.
function loadBindings(): KeybindBindings {
  const base = defaultBindings()

  for (const id of Object.keys(base)) {
    // An empty array is an explicit unbind. A truthy check treats `[]` as
    // "no override" and the shipped chord stays — that is how ⌘1–9 kept
    // switching top tabs after the sidebar plugin stored `profile.switch.N: []`.
    if (Object.prototype.hasOwnProperty.call(storedOverrides, id)) {
      base[id] = storedOverrides[id]
    }
  }

  return withoutRailOnModJ(base)
}

// Persist only the actions whose combos differ from their shipped default, so
// changing a default never gets shadowed by a stored snapshot.
function persistBindings(bindings: KeybindBindings): void {
  const defaults = defaultBindings()
  const diff: KeybindBindings = {}

  for (const action of allKeybindActions()) {
    const current = bindings[action.id] ?? []

    if (!arraysEqual(current, defaults[action.id] ?? [])) {
      diff[action.id] = current
    }
  }

  // Actions contributed after boot (plugins register late) are missing
  // from the registry when the boot-time subscribe fires. Carry their
  // stored overrides forward so the persist does not wipe them. Re-read
  // storage rather than the module-init snapshot: an override written after
  // boot (plugin registered → rebound → unloaded) is otherwise invisible here
  // and the next persist of any other action drops it.
  for (const [id, combos] of Object.entries(readStoredOverrides())) {
    if (!(id in defaults)) {
      diff[id] = combos
    }
  }

  persistString(STORAGE_KEY, JSON.stringify(diff))
}

export const $bindings = atom<KeybindBindings>(loadBindings())

$bindings.subscribe(persistBindings)

/** Live combos for an action: explicit binding → stored override → default. */
export function bindingsFor(id: string, bindings: KeybindBindings = $bindings.get()): string[] {
  return bindings[id] ?? storedOverrides[id] ?? [...(keybindAction(id)?.defaults ?? [])]
}

// Reverse lookup combo → actionId for dispatch. First action wins on conflict;
// the panel/edit overlay surface conflicts so users can resolve them. Keys go
// through `canonicalizeCombo` so a `ctrl+…` binding resolves everywhere.
// Recomputes on registry mutations so contributed actions dispatch live.
export const $comboIndex = computed([$bindings, $registryVersion], bindings => buildComboIndex(bindings))

export function setBinding(actionId: string, combos: string[]): void {
  if (!keybindAction(actionId)) {
    return
  }

  $bindings.set({ ...$bindings.get(), [actionId]: [...combos] })
}

export function resetBinding(actionId: string): void {
  const action = keybindAction(actionId)

  if (!action) {
    return
  }

  $bindings.set({ ...$bindings.get(), [actionId]: [...action.defaults] })
}

export function resetAllBindings(): void {
  $bindings.set(defaultBindings())
}

// Other actions that already use `combo` (excluding `actionId` itself).
export function conflictsFor(actionId: string, combo: string): string[] {
  const bindings = $bindings.get()

  return allKeybindActions()
    .map(action => action.id)
    .filter(id => id !== actionId && bindingsFor(id, bindings).includes(combo))
}

// ── Capture ─────────────────────────────────────────────────────────────────
// `$capture` is the action currently listening for its next keypress (a panel
// row armed for rebinding). Session-only — never persisted.

export const $capture = atom<string | null>(null)

export function beginCapture(actionId: string): void {
  $capture.set(actionId)
}

export function endCapture(): void {
  $capture.set(null)
}
