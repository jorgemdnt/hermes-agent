import { describe, expect, it } from 'vitest'

import { canonicalizeCombo } from '@/lib/keybinds/combo'

import { buildComboIndex, withoutRailOnModJ } from './keybinds'

describe('⌘J', () => {
  it('takes a stale right-sidebar override off mod+j', () => {
    const next = withoutRailOnModJ({
      'view.showTerminal': ['ctrl+`'],
      'view.toggleRightSidebar': ['mod+j']
    })

    expect(next['view.toggleRightSidebar']).not.toContain('mod+j')
    expect(next['view.showTerminal']).toContain('mod+j')
  })

  it('dispatches mod+j to the terminal even when the rail still claims it', () => {
    const index = buildComboIndex({
      'view.showTerminal': ['ctrl+`'],
      'view.toggleRightSidebar': ['mod+j']
    })

    expect(index.get(canonicalizeCombo('mod+j'))).toBe('view.showTerminal')
  })
})
