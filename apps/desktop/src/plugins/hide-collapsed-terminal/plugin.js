/**
 * Quiet chrome (Work layout owns collapsed-terminal hide in the tree):
 *   - Hide the empty-chat intro subtitle under HERMES AGENT.
 *     ⌘K → "Toggle intro subtitle" restores it.
 *   - Solid composer fill while the input is focused (Glass stays on the window).
 *   - Hide Capabilities / Messaging / Artifacts / Scheduled jobs in the sidebar.
 *     ⌘K still opens them; ⌘K → "Toggle sidebar page links" restores the rows.
 *   - Hide the Pinned section unless a chat is actually pinned.
 *   - Fade the sticky user prompt (especially the text) until hover/focus.
 *   - Hide empty worktree/branch lanes (no threads).
 *   - Keep SESSIONS | BOTS as left-sidebar tabs (not a nav row).
 *     ⌘K → Show Bots / Show Sessions.
 */
import { PALETTE_AREA, host } from '@hermes/plugin-sdk'

const BOTS_PANE = 'hermes-bots:pane'
const SESSIONS_PANE = 'sessions'
const LAYOUT_KEY = 'hermes.desktop.layoutTree.v2'
const TAB_STRIP_DEFAULT_KEY = 'hermes.desktop.tabStripDefault'
const HIDDEN_STRIP_TABS_KEY = 'hermes.desktop.hiddenStripTabs.v1'
const BOTS_STRIP_RELOAD = 'hermes.plugin.hide-collapsed-terminal.botsStripReload'

function showPane(id) {
  if (typeof host.revealPane === 'function') {
    host.revealPane(id)
    return true
  }
  const tab = document.querySelector(`[data-tree-tab="${id}"]`)
  if (tab instanceof HTMLElement) {
    tab.click()
    return true
  }
  return false
}

function showBots() {
  if (showPane(BOTS_PANE)) return
  host.notify({
    kind: 'warning',
    message: 'Bots pane not in the layout — enable the Bots plugin in Settings → Plugins, then ⌘B / ⌥⌘T.'
  })
}

function walkGroups(node, visit) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'group') visit(node)
  const children = node.children
  if (Array.isArray(children)) children.forEach(child => walkGroups(child, visit))
}

function ensureSessionBotsTabs() {
  let changed = false
  try {
    const hidden = JSON.parse(localStorage.getItem(HIDDEN_STRIP_TABS_KEY) || 'null')
    if (Array.isArray(hidden) && hidden.includes(BOTS_PANE)) {
      const next = hidden.filter(id => id !== BOTS_PANE)
      if (next.length) localStorage.setItem(HIDDEN_STRIP_TABS_KEY, JSON.stringify(next))
      else localStorage.removeItem(HIDDEN_STRIP_TABS_KEY)
      changed = true
    }
  } catch {
    /* ignore */
  }
  if (localStorage.getItem(TAB_STRIP_DEFAULT_KEY) === 'never') {
    localStorage.removeItem(TAB_STRIP_DEFAULT_KEY)
    changed = true
  }
  try {
    const tree = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null')
    if (tree) {
      walkGroups(tree, group => {
        const panes = Array.isArray(group.panes) ? group.panes : []
        const stacked =
          panes.includes('sessions') && panes.some(id => id === BOTS_PANE || String(id).startsWith('hermes-bots'))
        if (stacked && group.tabStrip !== 'always') {
          group.tabStrip = 'always'
          changed = true
        }
      })
      if (changed) localStorage.setItem(LAYOUT_KEY, JSON.stringify(tree))
    }
  } catch {
    /* ignore */
  }
  if (!changed) return
  if (sessionStorage.getItem(BOTS_STRIP_RELOAD)) return
  sessionStorage.setItem(BOTS_STRIP_RELOAD, '1')
  location.reload()
}

const INTRO_CSS = `
[data-slot="aui_intro"] p:not(.wordmark) {
  display: none !important;
}
`

const COMPOSER_FOCUS_CSS = `
[data-slot="composer-root"]:focus-within,
[data-slot="composer-root"][data-thread-scrolled-up]:focus-within {
  --composer-fill: var(--dt-card) !important;
}
`

const SIDEBAR_PAGES_CSS = `
[data-slot="sidebar-menu-item"]:has([data-tour="sidebar-nav-skills"]),
[data-slot="sidebar-menu-item"]:has([data-tour="sidebar-nav-messaging"]),
[data-slot="sidebar-menu-item"]:has([data-tour="sidebar-nav-artifacts"]),
[data-slot="sidebar-menu-item"]:has([data-tour="sidebar-nav-cron"]) {
  display: none !important;
}
`

const EMPTY_PINNED_CSS = `
[data-sessions-mode] > [data-slot="sidebar-group"].shrink-0.pb-1:not(:has([data-slot="row-button"])) {
  display: none !important;
}
`

const EMPTY_WORKTREE_CSS = `
[data-sessions-mode] .grid.gap-px:has(.codicon-git-branch):has(.min-h-7.pl-2.leading-7):not(:has([data-slot="row-button"])) {
  display: none !important;
}
`

const STICKY_PROMPT_CSS = `
[data-slot="aui_user-message-root"]:not(:hover):not(:focus-within) .composer-human-message {
  background: color-mix(in srgb, var(--dt-user-bubble) 42%, transparent);
}
[data-slot="aui_user-message-root"]:not(:hover):not(:focus-within) [data-slot="aui_user-message-text"] {
  opacity: 0.5;
}
[data-slot="aui_user-message-root"] .composer-human-message,
[data-slot="aui_user-message-root"] [data-slot="aui_user-message-text"] {
  transition: background-color 150ms ease-out, opacity 150ms ease-out;
}
`

const HIDE_INTRO_KEY = 'hideIntroSubtitle'
const HIDE_PAGES_KEY = 'hideSidebarPages'
const RAIL_KEY = 'hermes.desktop.profileRailVisible'
const RAIL_HID = 'hermes.plugin.hide-collapsed-terminal.hidProfileRail.v1'

function hideProfileRailOnce() {
  try {
    if (localStorage.getItem(RAIL_HID)) return
    localStorage.setItem(RAIL_KEY, 'false')
    localStorage.setItem(RAIL_HID, '1')
  } catch {
    /* ignore */
  }
}

export default {
  id: 'hide-collapsed-terminal',
  name: 'Hide collapsed terminal rail',
  description: 'Quiet chrome: collapsed terminal, intro subtitle, focused composer, sidebar pages, empty Pinned.',
  register(ctx) {
    hideProfileRailOnce()
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'hide-collapsed-terminal')

    const hideIntro = () => ctx.storage.get(HIDE_INTRO_KEY, true) !== false
    const hidePages = () => ctx.storage.get(HIDE_PAGES_KEY, true) !== false

    const apply = () => {
      style.textContent = [
        COMPOSER_FOCUS_CSS,
        EMPTY_PINNED_CSS,
        EMPTY_WORKTREE_CSS,
        STICKY_PROMPT_CSS,
        hideIntro() ? INTRO_CSS : '',
        hidePages() ? SIDEBAR_PAGES_CSS : ''
      ].join('\n')
    }

    apply()
    document.head.appendChild(style)
    ctx.onDispose(() => style.remove())
    ensureSessionBotsTabs()

    ctx.register({
      id: 'toggle-intro-subtitle',
      area: PALETTE_AREA,
      data: {
        id: 'hide-collapsed-terminal.toggle-intro-subtitle',
        label: 'Toggle intro subtitle',
        keywords: ['intro', 'subtitle', 'empty chat', 'wordmark', 'chrome', 'splash'],
        run: () => {
          const next = !hideIntro()
          ctx.storage.set(HIDE_INTRO_KEY, next)
          apply()
          host.notify({
            kind: 'info',
            message: next ? 'Intro subtitle hidden' : 'Intro subtitle shown'
          })
        }
      }
    })

    ctx.register({
      id: 'show-bots',
      area: PALETTE_AREA,
      data: {
        id: 'hide-collapsed-terminal.show-bots',
        label: 'Show Bots',
        keywords: ['bots', 'bot mode', 'roster', 'agents', 'profiles'],
        run: () => showBots()
      }
    })

    ctx.register({
      id: 'show-sessions',
      area: PALETTE_AREA,
      data: {
        id: 'hide-collapsed-terminal.show-sessions',
        label: 'Show Sessions',
        keywords: ['sessions', 'chats', 'sidebar', 'recents'],
        run: () => {
          if (!showPane(SESSIONS_PANE)) {
            host.notify({ kind: 'warning', message: 'Sessions sidebar not in the layout — try ⌘B.' })
          }
        }
      }
    })

    ctx.register({
      id: 'toggle-sidebar-pages',
      area: PALETTE_AREA,
      data: {
        id: 'hide-collapsed-terminal.toggle-sidebar-pages',
        label: 'Toggle sidebar page links',
        keywords: [
          'artifacts',
          'messaging',
          'capabilities',
          'skills',
          'cron',
          'scheduled',
          'jobs',
          'sidebar',
          'nav'
        ],
        run: () => {
          const next = !hidePages()
          ctx.storage.set(HIDE_PAGES_KEY, next)
          apply()
          host.notify({
            kind: 'info',
            message: next
              ? 'Sidebar page links hidden — open them from ⌘K'
              : 'Sidebar page links shown'
          })
        }
      }
    })
  }
}
