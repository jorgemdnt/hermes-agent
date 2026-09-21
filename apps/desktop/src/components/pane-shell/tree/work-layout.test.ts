import { describe, expect, it } from 'vitest'

import { group, split } from './model'
import { treeLooksLikeWork } from './work-layout'

describe('treeLooksLikeWork', () => {
  it('accepts sessions | chat-over-terminal | work', () => {
    const tree = split(
      'row',
      [
        group(['sessions']),
        split('column', [group(['workspace']), group(['terminal'])]),
        group(['work'])
      ]
    )

    expect(treeLooksLikeWork(tree)).toBe(true)
  })

  it('rejects stock Default with files', () => {
    const tree = split('row', [group(['sessions']), group(['workspace']), group(['files', 'terminal'])])

    expect(treeLooksLikeWork(tree)).toBe(false)
  })
})
