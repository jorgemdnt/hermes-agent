import { afterEach, describe, expect, it } from 'vitest'

import { createPluginContext } from '@/contrib/plugin'
import { KEYBINDS_AREA } from '@/lib/keybinds/actions'
import { canonicalizeCombo } from '@/lib/keybinds/combo'

import { buildComboIndex } from './keybinds'

describe('⌘1–9 sidebar rows', () => {
  const disposers: Array<() => void> = []

  afterEach(() => {
    while (disposers.length) {
      disposers.pop()?.()
    }
  })

  it('dispatches mod+1 to sidebar.row.1 even when profile.switch.1 still ships that chord', () => {
    const ctx = createPluginContext('cmd-number-sessions')
    disposers.push(
      ctx.register({
        id: 'row-1',
        area: KEYBINDS_AREA,
        data: {
          id: 'sidebar.row.1',
          category: 'session',
          defaults: ['mod+1'],
          label: 'Switch to sidebar row 1',
          run: () => undefined
        }
      })
    )

    const index = buildComboIndex({
      'profile.switch.1': ['mod+1'],
      'sidebar.row.1': ['mod+1']
    })

    expect(index.get(canonicalizeCombo('mod+1'))).toBe('sidebar.row.1')
  })
})
