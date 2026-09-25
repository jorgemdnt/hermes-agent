import { describe, expect, it } from 'vitest'

import { group } from '../model'

import { fixedTrackSize, MINIMIZED_TRACK, type TrackContext } from './track-model'

const ctx: TrackContext = {
  overrides: {},
  paneFor: () => ({ data: { height: '20vh' }, id: 'terminal' }) as never,
  paneGone: () => false
}

describe('minimized track size', () => {
  it('gives a column-minimized terminal the stock strip track', () => {
    const node = group(['terminal'], { id: 'grp-terminal', minimized: true })

    expect(fixedTrackSize(node, 'column', ctx)).toBe(MINIMIZED_TRACK)
  })

  it('keeps a row-minimized rail as a strip', () => {
    const node = group(['work'], { id: 'grp-work', minimized: true })

    expect(fixedTrackSize(node, 'row', ctx)).toBe(MINIMIZED_TRACK)
  })
})

describe('work slot with a preview showing', () => {
  const node = group(['work', 'preview-tile:file:x'], { id: 'grp-work' })

  it('stays 36vw when the work pane is hidden and the preview declares a width', () => {
    const ctx: TrackContext = {
      overrides: {},
      paneFor: id =>
        ({
          data: { maxWidth: '50vw', minWidth: '22rem', placement: 'right', width: '36vw' },
          id
        }) as never,
      paneGone: id => id === 'work'
    }

    expect(fixedTrackSize(node, 'row', ctx)).toBe('36vw')
  })

  it('flexes, and will eat the chat, when the shown preview has no width', () => {
    const ctx: TrackContext = {
      overrides: {},
      paneFor: id =>
        ({
          data:
            id === 'work'
              ? { maxWidth: '50vw', placement: 'right', width: '36vw' }
              : { maxWidth: '50vw', minWidth: '22rem', placement: 'right' },
          id
        }) as never,
      paneGone: id => id === 'work'
    }

    expect(fixedTrackSize(node, 'row', ctx)).toBeNull()
  })
})
