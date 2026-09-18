import { describe, expect, it } from 'vitest'

import { rosterPaintSource } from './roster-paint'
import type { RosterRow } from './types'

const last = [{ name: 'ops' }, { name: 'writer' }] as RosterRow[]

describe('rosterPaintSource', () => {
  it('keeps the last roster visible while profiles.list is in flight', () => {
    expect(rosterPaintSource(null, last)).toEqual(last)
  })

  it('uses the live list once it arrives, including an empty one', () => {
    expect(rosterPaintSource([], last)).toEqual([])
    expect(rosterPaintSource([{ name: 'ops' }] as RosterRow[], last)).toEqual([{ name: 'ops' }])
  })
})
