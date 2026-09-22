import { GlyphSpinner } from '@/components/ui/glyph-spinner'

import { useBots } from './i18n'

/** Center stand-in while the bots tab is up and the roster has not answered. */
export function BotsLoadingPage() {
  const b = useBots()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-(--dt-card) text-(--ui-text-tertiary)">
      <GlyphSpinner spinner="breathe" />
      <p className="max-w-sm px-6 text-center text-sm">{b.roster.waitingForGateway}</p>
    </div>
  )
}
