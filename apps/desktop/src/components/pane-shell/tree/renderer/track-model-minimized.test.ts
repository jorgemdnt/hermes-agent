import { describe, expect, it } from 'vitest'

import { group } from '../model'

import { MINIMIZED_TRACK, fixedTrackSize, type TrackContext } from './track-model'

const ctx: TrackContext = {
  overrides: {},
  paneFor: () => ({ data: { height: '20vh' }, id: 'terminal' }) as never,
  paneGone: () => false
}

describe('minimized track size', () => {
  it('gives a column-minimized terminal no track, not a title strip', () => {
    const node = group(['terminal'], { id: 'grp-terminal', minimized: true })

    expect(fixedTrackSize(node, 'column', ctx)).toBe('0px')
  })

  it('keeps a row-minimized rail as a strip', () => {
    const node = group(['work'], { id: 'grp-work', minimized: true })

    expect(fixedTrackSize(node, 'row', ctx)).toBe(MINIMIZED_TRACK)
  })
})
