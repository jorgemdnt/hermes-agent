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

export function buildComboIndex(bindings: KeybindBindings): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const resolved = withoutRailOnModJ(bindings)

  for (const action of allKeybindActions()) {
    for (const combo of bindingsFor(action.id, resolved)) {
      const key = canonicalizeCombo(combo)
      index.set(key, [...(index.get(key) ?? []), action.id])
    }
  }

  // The contributed sidebar-row action owns ⌘N when installed. Keep the
  // remaining actions in order for the upstream passthrough dispatcher.
  for (let slot = 1; slot <= 9; slot += 1) {
    const id = `sidebar.row.${slot}`
    const key = canonicalizeCombo(`mod+${slot}`)
    const actions = index.get(key)
    if (actions?.includes(id)) {
      index.set(key, [id, ...actions.filter(action => action !== id)])
    }
  }

  const terminal = canonicalizeCombo(MOD_J)
  index.set(terminal, ['view.showTerminal', ...(index.get(terminal) ?? []).filter(id => id !== 'view.showTerminal')])
  return index
}

// Defaults overlaid with the user's stored overrides. Unknown / stale action
// ids are dropped; actions added in a later release pick up their shipped
// default; late-registered contributed actions resolve via `bindingsFor`.
function loadBindings(): KeybindBindings {
  const base = defaultBindings()

  for (const id of Object.keys(base)) {
    // Empty combos are a cleared binding, not a missing one. Object.hasOwn
    // keeps a stored [] (sidebar unbound) from falling back to the shipped default.
    if (Object.hasOwn(storedOverrides, id)) {
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
    const current = bindingsFor(action.id, bindings)

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

// Reverse lookup combo → action ids; a passthrough action can decline and
// hand the chord to the next. Rebuild on late plugin registrations.
export const $comboIndex = computed([$bindings, $registryVersion], bindings => buildComboIndex(bindings))

export function setBinding(actionId: string, combos: string[]): void {
  if (!keybindAction(actionId)) {
    return
  }

  $bindings.set({ ...$bindings.get(), [actionId]: [...combos] })
}

/** Drop every combo. Empty is persisted, so a shipped default stays unbound. */
export function clearBinding(actionId: string): void {
  setBinding(actionId, [])
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

// Other actions that already use `combo` (excluding `actionId` itself). A
// `passthrough` action layered over a later one shares the chord by design,
// so that pair is not reported from either side.
export function conflictsFor(actionId: string, combo: string): string[] {
  const bindings = $bindings.get()
  const actions = allKeybindActions()
  const self = actions.findIndex(action => action.id === actionId)

  return actions
    .filter((action, index) => {
      if (index === self || !bindingsFor(action.id, bindings).includes(combo)) {
        return false
      }

      const earlier = index < self ? action : actions[self]

      return !earlier?.passthrough
    })
    .map(action => action.id)
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

export type CaptureStep = { type: 'cancel' } | { type: 'set'; combos: string[] } | { type: 'wait' }

// Capture-mode keydown. Backspace/Delete record an empty combo so a shipped
// chord (sidebar mod+b) can be unbound. Escape cancels. A modifier-only press
// (`combo == null`) keeps waiting for a real key.
export function captureStep(key: string, combo: string | null): CaptureStep {
  if (key === 'Escape') {
    return { type: 'cancel' }
  }

  if (key === 'Backspace' || key === 'Delete') {
    return { type: 'set', combos: [] }
  }

  if (!combo) {
    return { type: 'wait' }
  }

  return { type: 'set', combos: [combo] }
}
