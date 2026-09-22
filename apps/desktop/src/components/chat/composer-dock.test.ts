import { describe, expect, it } from 'vitest'

import {
  composerDockCard,
  composerFill,
  composerInputSurface,
  composerPanelCard
} from '@/components/chat/composer-dock'

const hasBackdropFilter = (classes: string) =>
  classes.includes('backdrop-blur-[') || classes.includes('backdrop-saturate') || classes.includes('backdrop-filter:blur')

describe('composer surface treatments', () => {
  it('keeps the frequently repainting input surface free of backdrop filters, glass stays on the chrome', () => {
    expect(composerInputSurface).toContain(composerFill)
    expect(hasBackdropFilter(composerInputSurface)).toBe(false)
    expect(hasBackdropFilter(composerDockCard())).toBe(true)
    expect(hasBackdropFilter(composerPanelCard)).toBe(false)
    expect(composerPanelCard).toContain('bg-(--dt-card)')
    expect(composerPanelCard).toContain('backdrop-blur-none')
    expect(composerPanelCard).not.toContain('transparent')
  })
})
