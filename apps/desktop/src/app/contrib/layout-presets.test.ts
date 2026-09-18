import { describe, expect, it } from 'vitest'

import { allPaneIds } from '@/components/pane-shell/tree/model'
import { workSlotSizing } from '@/store/layout'

import { DEFAULT_TREE } from './layout-presets'

describe('DEFAULT_TREE', () => {
  it('puts a work slot on the right, not the file tree', () => {
    const ids = allPaneIds(DEFAULT_TREE)

    expect(ids).toContain('work')
    expect(ids).not.toContain('files')
  })
})

describe('work slot sizing', () => {
  it('is a growable preview split, not a 20rem file-tree rail', () => {
    expect(workSlotSizing).not.toHaveProperty('maxWidth')
    expect(workSlotSizing).not.toHaveProperty('width')
  })
})
