import { describe, expect, it } from 'vitest'

import { botsLandingAction, centerIsWorkspacePage, firstOpenableBot } from './bots-landing'
import type { RosterRow } from './types'

const bot = { name: 'frodo' } as RosterRow

describe('bots landing', () => {
  it('treats a restored skills page as a workspace page', () => {
    expect(centerIsWorkspacePage('#/capabilities')).toBe(true)
    expect(centerIsWorkspacePage('/capabilities?tab=skills')).toBe(true)
    expect(centerIsWorkspacePage('#/session/bot-chat')).toBe(false)
  })

  it('shows loading instead of the skills page while the roster has not answered', () => {
    expect(
      botsLandingAction({
        paneVisible: true,
        groupOpen: false,
        rosterHydrated: false,
        hasBot: false,
        centerIsWorkspacePage: true
      })
    ).toBe('loading')
  })

  it('opens the first bot once the roster answers', () => {
    expect(firstOpenableBot([bot], null)).toBe(bot)
    expect(
      botsLandingAction({
        paneVisible: true,
        groupOpen: false,
        rosterHydrated: true,
        hasBot: true,
        centerIsWorkspacePage: true
      })
    ).toBe('open')
  })

  it('does not claim the center when the bots tab is hidden', () => {
    expect(
      botsLandingAction({
        paneVisible: false,
        groupOpen: false,
        rosterHydrated: true,
        hasBot: true,
        centerIsWorkspacePage: true
      })
    ).toBe('leave')
  })
})
