import { describe, expect, it } from 'vitest'

import { isPreviewableTarget } from './targets'

describe('isPreviewableTarget', () => {
  it('accepts project html and localhost', () => {
    expect(isPreviewableTarget('/work/app/index.html')).toBe(true)
    expect(isPreviewableTarget('http://localhost:5174')).toBe(true)
  })

  it('rejects agent scratch html under ~/.hermes/tmp', () => {
    expect(isPreviewableTarget('/Users/jorgemodesto/.hermes/tmp/pr-5154-artie-drawing.html')).toBe(false)
    expect(isPreviewableTarget('file:///Users/x/.hermes/tmp/x.html')).toBe(false)
  })
})
