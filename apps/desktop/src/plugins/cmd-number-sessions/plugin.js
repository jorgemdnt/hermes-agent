/**
 * Standing Desktop keybind overlay:
 *   ⌘1–9     Nth visible chat in the sessions sidebar (stock: recent-session slots)
 *   ⌃1 / ⌃2  Sessions / Bots tabs (no sidebar click required)
 *   ⌃3–9     named profiles 3–9
 *   ⌘J       toggle terminal      (stock: ⌃`)
 *   ⌘⌥B      toggle right sidebar (stock: ⌘J)
 *
 * Stock session.slot.N is $sessions[N-1] (flat recency). We unbind those and
 * register sidebar.row.N so the chord follows PROJECTS / recents row order.
 */
import { KEYBINDS_AREA, PALETTE_AREA, host } from '@hermes/plugin-sdk'

const ID = 'cmd-number-sessions'
const STORAGE_KEY = 'hermes.desktop.keybinds'
const APPLIED_KEY = 'hermes.desktop.keybinds.cmd-number-sessions'
const SESSIONS_PANE = 'sessions'
const BOTS_PANE = 'hermes-bots:pane'

function readOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    /* ignore */
  }
  return {}
}

function comboIs(overrides, id, combo) {
  const value = overrides[id]
  return Array.isArray(value) && value[0] === combo
}

function isUnbound(overrides, id) {
  const value = overrides[id]
  return Array.isArray(value) && value.length === 0
}

function comboIsOrUnset(overrides, id, combo) {
  if (!Object.prototype.hasOwnProperty.call(overrides, id)) return true
  return comboIs(overrides, id, combo)
}

function isDesired(overrides) {
  for (let i = 1; i <= 9; i++) {
    if (!isUnbound(overrides, `session.slot.${i}`)) return false
  }
  if (!isUnbound(overrides, 'profile.switch.1')) return false
  if (!isUnbound(overrides, 'profile.switch.2')) return false
  for (let i = 3; i <= 9; i++) {
    if (!comboIs(overrides, `profile.switch.${i}`, `ctrl+${i}`)) return false
  }
  if (!comboIsOrUnset(overrides, 'view.showTerminal', 'mod+j')) return false
  if (!comboIsOrUnset(overrides, 'view.toggleRightSidebar', 'mod+alt+b')) return false
  if (Object.prototype.hasOwnProperty.call(overrides, 'session.new')) return false
  return true
}

function writeMap() {
  const next = { ...readOverrides() }
  for (let i = 1; i <= 9; i++) {
    next[`session.slot.${i}`] = []
  }
  next['profile.switch.1'] = []
  next['profile.switch.2'] = []
  for (let i = 3; i <= 9; i++) {
    next[`profile.switch.${i}`] = [`ctrl+${i}`]
  }
  next['view.showTerminal'] = ['mod+j']
  next['view.toggleRightSidebar'] = ['mod+alt+b']
  delete next['session.new']
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(APPLIED_KEY, '1')
}

function revealPane(id) {
  if (typeof host.revealPane === 'function') {
    host.revealPane(id)
    return true
  }
  return false
}

function shown(el) {
  return el.getClientRects().length > 0
}

function sessionResumeButtons() {
  const root = document.querySelector('[data-sessions-mode]')
  if (!root) return []
  const projects = [...root.querySelectorAll('[data-sessions-project]')]
  if (projects.length) {
    const buttons = []
    for (const project of projects) {
      const btns = [...project.querySelectorAll('[data-slot="row-button"]')].filter(shown)
      buttons.push(...btns.slice(1))
    }
    return buttons
  }
  return [...root.querySelectorAll('[data-slot="row-button"]')].filter(shown)
}

function resumeNthVisibleSession(slot) {
  const btn = sessionResumeButtons()[slot - 1]
  if (!btn) return false
  // This runs from the ⌘1–9 keydown — Cmd is still down. `element.click()`
  // inherits metaKey in Chromium, and the session row treats ⌘-click as
  // "open tab" (`openSession(..., 'tab')`), which never writes
  // `$selectedStoredSessionId`. Archive (⌘⇧A) then hits the previous primary.
  // A modifier-free click takes the resume path (same as a plain mouse click).
  btn.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false
    })
  )
  return true
}

async function treePreviewIds() {
  try {
    const tree = await host.request('projects.tree', { preview_limit: 9 })
    const ids = []
    for (const project of tree?.projects || []) {
      for (const session of project.previewSessions || []) {
        if (session?.id) ids.push(session.id)
      }
    }
    return ids
  } catch {
    return []
  }
}

async function openSidebarSlot(slot) {
  if (resumeNthVisibleSession(slot)) return
  const id = (await treePreviewIds())[slot - 1]
  if (id) host.navigate(`/${encodeURIComponent(id)}`)
}

function applyAndReload() {
  writeMap()
  location.reload()
}

export default {
  id: ID,
  name: '⌘1–9 conversations',
  description: '⌘1–9 sidebar chats. ⌃1/⌃2 Sessions/Bots. ⌃3–9 profiles. ⌘J terminal. ⌘⌥B work slot.',
  register(ctx) {
    ctx.register({
      id: 'reapply',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.reapply`,
        label: 'Re-apply ⌘1–9 / ⌃1–2 Sessions-Bots / ⌘J terminal / ⌘⌥B work',
        keywords: ['keybind', 'shortcut', 'cmd', 'ctrl', 'session', 'profile', 'terminal', 'sidebar'],
        run: () => applyAndReload()
      }
    })

    for (let i = 1; i <= 9; i++) {
      const slot = i
      ctx.register({
        id: `row-${slot}`,
        area: KEYBINDS_AREA,
        data: {
          id: `sidebar.row.${slot}`,
          category: 'session',
          defaults: [`mod+${slot}`],
          label: `Switch to sidebar chat ${slot}`,
          run: () => void openSidebarSlot(slot)
        }
      })
    }

    ctx.register({
      id: 'sessions-tab',
      area: KEYBINDS_AREA,
      data: {
        id: 'sidebar.sessionsTab',
        category: 'view',
        defaults: ['ctrl+1'],
        label: 'Show Sessions',
        run: () => revealPane(SESSIONS_PANE)
      }
    })

    ctx.register({
      id: 'bots-tab',
      area: KEYBINDS_AREA,
      data: {
        id: 'sidebar.botsTab',
        category: 'view',
        defaults: ['ctrl+2'],
        label: 'Show Bots',
        run: () => revealPane(BOTS_PANE)
      }
    })

    if (isDesired(readOverrides())) {
      localStorage.setItem(APPLIED_KEY, '1')
      return
    }

    applyAndReload()
  }
}
