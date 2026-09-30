import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'

import { useI18n } from '@/i18n'
import { $navigationAvailability, travelNavigation } from '@/store/navigation-history'

import { Button } from './button'
import { Codicon } from './codicon'

/** Dialog headers remain inside the modal's pointer and focus boundary. */
export function NavigationButtons(props: ComponentProps<'div'>) {
  const { t } = useI18n()
  const history = useStore($navigationAvailability)
  const actions = [
    { label: t.preview.web.goBack, icon: 'arrow-left', available: history.back, direction: -1 },
    { label: t.preview.web.goForward, icon: 'arrow-right', available: history.forward, direction: 1 }
  ] as const

  return (
    <div className="flex items-center gap-0.5" {...props}>
      {actions.map(action => (
        <Button
          aria-label={action.label}
          disabled={!action.available}
          key={action.direction}
          onClick={() => travelNavigation(action.direction)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name={action.icon} />
        </Button>
      ))}
    </div>
  )
}
