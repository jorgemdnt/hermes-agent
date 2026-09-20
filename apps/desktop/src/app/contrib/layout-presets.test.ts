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

  it('puts the terminal under chat, with the work slot as a right sibling', () => {
    expect(DEFAULT_TREE.type).toBe('split')
    expect(DEFAULT_TREE.orientation).toBe('row')

    const center = DEFAULT_TREE.children.find(
      child => child.type === 'split' && child.orientation === 'column' && allPaneIds(child).includes('workspace')
    )

    expect(center).toBeTruthy()
    expect(allPaneIds(center!)).toEqual(expect.arrayContaining(['workspace', 'terminal']))
    expect(allPaneIds(center!)).not.toContain('work')

    const workHome = DEFAULT_TREE.children.find(child => allPaneIds(child).includes('work'))

    expect(workHome).toBeTruthy()
    expect(workHome).not.toBe(center)
  })
})

describe('work slot sizing', () => {
  it('is a growable preview split, not a 20rem file-tree rail', () => {
    expect(workSlotSizing.maxWidth).not.toBe('20rem')
    expect(workSlotSizing).not.toHaveProperty('width')
  })

  it('cannot sash the chat column away', () => {
    expect(workSlotSizing.maxWidth).toBe('50vw')
  })
})
