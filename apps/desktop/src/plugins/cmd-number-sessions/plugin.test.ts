// @ts-nocheck — bundled overlay is plugin.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activateSidebarTab, openSidebarSlot, sidebarTabsInOrder } from './plugin.js'

function tab(id: string) {
  const el = document.createElement('button')
  el.setAttribute('data-tree-tab', id)
  el.setAttribute('role', 'tab')
  return el
}

function row(label: string) {
  const el = document.createElement('button')
  el.setAttribute('data-slot', 'row-button')
  el.textContent = label
  return el
}

describe('cmd-number-sessions sidebar slots', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function mockRects(this: HTMLElement) {
      if (this.hidden || this.style.display === 'none') {
        return [] as unknown as DOMRectList
      }

      return [{ width: 10, height: 10 }] as unknown as DOMRectList
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('maps ctrl slots to sidebar tabs in visual order, not hardcoded Sessions/Bots', () => {
    const strip = document.createElement('div')
    strip.setAttribute('role', 'tablist')
    strip.append(tab('hermes-bots:pane'), tab('sessions'))
    document.body.append(strip)

    expect(sidebarTabsInOrder().map((el: Element) => el.getAttribute('data-tree-tab'))).toEqual([
      'hermes-bots:pane',
      'sessions'
    ])

    const revealed: string[] = []
    expect(activateSidebarTab(1, (id: string) => revealed.push(id), document)).toBe(true)
    expect(activateSidebarTab(2, (id: string) => revealed.push(id), document)).toBe(true)
    expect(revealed).toEqual(['hermes-bots:pane', 'sessions'])
  })

  it('skips section headers and opens the Nth bot row on the visible roster', async () => {
    const roster = document.createElement('div')
    roster.setAttribute('data-slot', 'bots-roster')
    const header = row('THIS DEVICE')
    header.setAttribute('aria-expanded', 'true')
    const hermes = row('hermes')
    const frodo = row('frodo')
    const clicked: string[] = []
    header.addEventListener('click', () => clicked.push('header'))
    hermes.addEventListener('click', () => clicked.push('hermes'))
    frodo.addEventListener('click', () => clicked.push('frodo'))
    roster.append(header, hermes, frodo)
    document.body.append(roster)

    await openSidebarSlot(1, document)
    await openSidebarSlot(2, document)
    expect(clicked).toEqual(['hermes', 'frodo'])
  })

  it('does not let a keep-alive hidden bots roster steal the session slot', async () => {
    const hidden = document.createElement('div')
    hidden.setAttribute('data-pane-hidden', '')
    const roster = document.createElement('div')
    roster.setAttribute('data-slot', 'bots-roster')
    const bot = row('gandalf')
    const clicked: string[] = []
    bot.addEventListener('click', () => clicked.push('gandalf'))
    roster.append(bot)
    hidden.append(roster)

    const sessions = document.createElement('div')
    sessions.setAttribute('data-sessions-mode', '')
    const session = row('alpha')
    session.addEventListener('click', () => clicked.push('alpha'))
    sessions.append(session)
    document.body.append(hidden, sessions)

    await openSidebarSlot(1, document)
    expect(clicked).toEqual(['alpha'])
  })

  it('opens the Nth bot row when the bots roster is the visible sidebar', async () => {
    const roster = document.createElement('div')
    roster.setAttribute('data-slot', 'bots-roster')
    const gandalf = row('gandalf')
    const frodo = row('frodo')
    const clicked: string[] = []
    gandalf.addEventListener('click', () => clicked.push('gandalf'))
    frodo.addEventListener('click', () => clicked.push('frodo'))
    roster.append(gandalf, frodo)
    document.body.append(roster)

    await openSidebarSlot(2, document)
    expect(clicked).toEqual(['frodo'])
  })

  it('lets the bots plugin claim the slot instead of clicking', async () => {
    const roster = document.createElement('div')
    roster.setAttribute('data-slot', 'bots-roster')
    const hermes = row('hermes')
    hermes.setAttribute('data-roster-key', 'legacy::hermes')
    const clicked: string[] = []
    hermes.addEventListener('click', () => clicked.push('hermes'))
    roster.append(hermes)
    const tab = document.createElement('button')
    tab.setAttribute('data-tree-tab', 'hermes-bots:pane')
    tab.setAttribute('aria-selected', 'true')
    document.body.append(tab, roster)

    const claimed: number[] = []
    const onSlot = (event: Event) => {
      claimed.push((event as CustomEvent).detail.slot)
      event.preventDefault()
    }
    window.addEventListener('hermes:sidebar-roster-slot', onSlot)

    await openSidebarSlot(1, document)
    window.removeEventListener('hermes:sidebar-roster-slot', onSlot)
    expect(claimed).toEqual([1])
    expect(clicked).toEqual([])
  })

  it('opens the Nth session row when the bots roster is not visible', async () => {
    const sessions = document.createElement('div')
    sessions.setAttribute('data-sessions-mode', '')
    const first = row('alpha')
    const second = row('beta')
    const clicked: string[] = []
    first.addEventListener('click', () => clicked.push('alpha'))
    second.addEventListener('click', () => clicked.push('beta'))
    sessions.append(first, second)
    document.body.append(sessions)

    await openSidebarSlot(2, document)
    expect(clicked).toEqual(['beta'])
  })
})
