/**
 * Standing Desktop keybind overlay:
 *   ⌘1–9     Nth visible row in the ACTIVE sidebar tab (sessions or bots)
 *   ⌃1–2     sidebar tabs in visual order (not hardcoded Sessions/Bots)
 *   ⌃3–9     named profiles 3–9
 *   ⌘J       toggle terminal      (stock: ⌃`)
 *   ⌘⌥B      toggle right sidebar (stock: ⌘J)
 *   ⌘⇧A      archive the focused chat (stock: unbound)
 *
 * Stock session.slot.N is $sessions[N-1] (flat recency). We unbind those and
 * register sidebar.row.N so the chord follows PROJECTS / recents row order.
 */
import { KEYBINDS_AREA, PALETTE_AREA, host } from '@hermes/plugin-sdk'
import { resetBinding, setBinding } from '@/store/keybinds'

const ID = 'cmd-number-sessions'
const STORAGE_KEY = 'hermes.desktop.keybinds'
export const SESSIONS_PANE = 'sessions'
export const BOTS_PANE = 'hermes-bots:pane'
const SIDEBAR_TAB_PANES = new Set([SESSIONS_PANE, BOTS_PANE])

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
  if (!comboIs(overrides, 'session.archive', 'mod+shift+a')) return false
  if (Object.prototype.hasOwnProperty.call(overrides, 'session.new')) return false
  return true
}

function applyMap() {
  for (let i = 1; i <= 9; i++) {
    setBinding(`session.slot.${i}`, [])
  }
  setBinding('profile.switch.1', [])
  setBinding('profile.switch.2', [])
  for (let i = 3; i <= 9; i++) {
    setBinding(`profile.switch.${i}`, [`ctrl+${i}`])
  }
  setBinding('view.showTerminal', ['mod+j'])
  setBinding('view.toggleRightSidebar', ['mod+alt+b'])
  setBinding('session.archive', ['mod+shift+a'])
  resetBinding('session.new')
}

export function shown(el) {
  // Inactive sidebar tabs stay mounted with visibility:hidden, so their rects
  // match the visible tab. A rect check alone cannot tell them apart — skip
  // the keep-alive marker or ⌘1–9 clicks an inert roster and does nothing.
  return el.getClientRects().length > 0 && !el.closest('[data-pane-hidden]')
}

function clickWithoutModifiers(el) {
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false
    })
  )
}

export function sidebarTabsInOrder(root = document) {
  const markers = [...root.querySelectorAll('[data-tree-tab]')].filter(el => {
    const id = el.getAttribute('data-tree-tab')
    return id && SIDEBAR_TAB_PANES.has(id) && shown(el)
  })
  const strip = markers[0]?.closest('[role="tablist"]') ?? markers[0]?.parentElement
  if (!strip) return []
  return [...strip.querySelectorAll('[data-tree-tab]')].filter(shown)
}

export function activateSidebarTab(slot, reveal, root = document) {
  const tab = sidebarTabsInOrder(root)[slot - 1]
  const id = tab?.getAttribute('data-tree-tab')
  if (!id) return false
  if (typeof reveal === 'function') {
    reveal(id)
    return true
  }
  if (typeof host.revealPane === 'function') {
    host.revealPane(id)
    return true
  }
  clickWithoutModifiers(tab)
  return true
}

export function rosterVisible(root = document) {
  return [...root.querySelectorAll('[data-slot="bots-roster"]')].some(shown)
}

export function rosterRowButtons(root = document) {
  const roster = [...root.querySelectorAll('[data-slot="bots-roster"]')].find(shown)
  if (!roster) return []
  // Section headers are row-buttons too (aria-expanded). Counting them makes
  // ⌘1 toggle THIS DEVICE instead of opening the first bot.
  return [...roster.querySelectorAll('[data-slot="row-button"]:not([aria-expanded])')].filter(shown)
}

function isSessionResumeButton(btn) {
  // Project names are SidebarRowLink (`p-0`). They enter the project; they are
  // not a chat. Show-all and the drill-in back row are row-buttons too, and
  // they don't resume. Do not skip "the first row-button" in each project:
  // a project whose name is not a row-button loses its only chat to that skip,
  // so ⌘N never reaches the next project.
  if (btn.classList.contains('p-0')) return false
  if (btn.classList.contains('group/more')) return false
  if (btn.classList.contains('group/back')) return false
  return true
}

function sessionResumeButtons(root = document) {
  const roots = [...root.querySelectorAll('[data-sessions-mode]')]
  const sessionsRoot = roots.find(shown) || roots[0]
  if (!sessionsRoot) return []
  return [...sessionsRoot.querySelectorAll('[data-slot="row-button"]')].filter(shown).filter(isSessionResumeButton)
}

function resumeNthVisibleSession(slot, root = document) {
  const btn = sessionResumeButtons(root)[slot - 1]
  if (!btn) return false
  // This runs from the ⌘1–9 keydown — Cmd is still down. `element.click()`
  // inherits metaKey in Chromium, and the session row treats ⌘-click as
  // "open tab" (`openSession(..., 'tab')`), which never writes
  // `$selectedStoredSessionId`. Archive (⌘⇧A) then hits the previous primary.
  // A modifier-free click takes the resume path (same as a plain mouse click).
  clickWithoutModifiers(btn)
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

export function botsTabActive(root = document) {
  const tab = root.querySelector('[data-tree-tab="hermes-bots:pane"][aria-selected="true"]')
  return Boolean(tab && shown(tab))
}

export function rosterKeys(root = document) {
  const roster = [...root.querySelectorAll('[data-slot="bots-roster"]')].find(shown)
  if (!roster) return []
  return [...roster.querySelectorAll('[data-roster-key]')].filter(shown)
}

function dispatchRosterSlot(slot) {
  return window.dispatchEvent(
    new CustomEvent('hermes:sidebar-roster-slot', {
      cancelable: true,
      detail: { slot }
    })
  )
}

export async function openSidebarSlot(slot, root = document) {
  if (botsTabActive(root) || rosterVisible(root)) {
    // A synthetic click on a draggable bot row does not run its React onClick.
    // The bots plugin opens the Nth data-roster-key through the real open path
    // and preventDefaults this event. Click remains the fallback.
    if (!dispatchRosterSlot(slot)) return
    const btn = rosterKeys(root)[slot - 1] || rosterRowButtons(root)[slot - 1]
    if (!btn) return
    clickWithoutModifiers(btn)
    return
  }
  if (resumeNthVisibleSession(slot, root)) return
  const id = (await treePreviewIds())[slot - 1]
  if (id) host.navigate(`/${encodeURIComponent(id)}`)
}

function applyIfNeeded() {
  if (isDesired(readOverrides())) {
    return
  }
  applyMap()
}

export default {
  id: ID,
  name: '⌘1–9 conversations',
  description: '⌘1–9 rows in the active sidebar tab. ⌃1/⌃2 tabs in visual order. ⌃3–9 profiles. ⌘J terminal. ⌘⌥B work slot.',
  register(ctx) {
    ctx.register({
      id: 'reapply',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.reapply`,
        label: 'Re-apply ⌘1–9 / ⌃1–2 sidebar-tab-order / ⌘J terminal / ⌘⌥B work',
        keywords: ['keybind', 'shortcut', 'cmd', 'ctrl', 'session', 'profile', 'terminal', 'sidebar'],
        run: () => applyMap()
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
          label: `Switch to sidebar row ${slot}`,
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
        label: 'Switch to sidebar tab 1 (visual order)',
        run: () => activateSidebarTab(1)
      }
    })

    ctx.register({
      id: 'bots-tab',
      area: KEYBINDS_AREA,
      data: {
        id: 'sidebar.botsTab',
        category: 'view',
        defaults: ['ctrl+2'],
        label: 'Switch to sidebar tab 2 (visual order)',
        run: () => activateSidebarTab(2)
      }
    })

    applyIfNeeded()
  }
}
