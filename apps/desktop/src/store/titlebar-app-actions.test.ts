import { beforeEach, describe, expect, it } from 'vitest'

import {
  $titlebarAppActionsSide,
  setTitlebarAppActionsSide,
  TITLEBAR_APP_ACTIONS_DEFAULT,
  titlebarAppActionsClusterCounts
} from './titlebar-app-actions'

describe('titlebarAppActionsClusterCounts', () => {
  it('puts Settings and HUD on the right by default', () => {
    expect(titlebarAppActionsClusterCounts('right')).toEqual({ left: 1, right: 3 })
    expect(titlebarAppActionsClusterCounts('left')).toEqual({ left: 3, right: 1 })
  })

  it('adds extras to the cluster they belong to', () => {
    expect(titlebarAppActionsClusterCounts('right', 1, 2)).toEqual({ left: 2, right: 5 })
    expect(titlebarAppActionsClusterCounts('left', 1, 2)).toEqual({ left: 4, right: 3 })
  })
})

describe('$titlebarAppActionsSide', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setTitlebarAppActionsSide(TITLEBAR_APP_ACTIONS_DEFAULT)
  })

  it('defaults to right', () => {
    expect($titlebarAppActionsSide.get()).toBe('right')
  })

  it('persists left', () => {
    setTitlebarAppActionsSide('left')
    expect($titlebarAppActionsSide.get()).toBe('left')
    expect(window.localStorage.getItem('hermes.desktop.titlebarAppActions')).toBe('left')
  })
})
