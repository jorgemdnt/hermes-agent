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
