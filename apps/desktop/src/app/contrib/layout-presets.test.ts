import { describe, expect, it } from 'vitest'

import { allPaneIds } from '@/components/pane-shell/tree/model'
import { clampWorkSlotWidth, FILE_BROWSER_DEFAULT_WIDTH, workSlotSizing } from '@/store/layout'

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
  it('opens as a capped side panel, not a leftover flex column', () => {
    expect(workSlotSizing.width).toBeTruthy()
    expect(workSlotSizing.width).not.toBe(FILE_BROWSER_DEFAULT_WIDTH)
    expect(workSlotSizing.maxWidth).not.toBe('20rem')
    expect(workSlotSizing.maxWidth).toBe('50vw')
    expect(workSlotSizing.minWidth).toBe('22rem')
  })

  it('snaps a transcript-eating sash back to a side panel', () => {
    expect(clampWorkSlotWidth(1800, 1440)).toBe(Math.round(1440 * 0.36))
    expect(clampWorkSlotWidth(400, 1440)).toBe(400)
  })
})
