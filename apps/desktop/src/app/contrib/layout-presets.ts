import { group, split } from '@/components/pane-shell/tree/model'
import { WORK_LAYOUT_ID } from '@/components/pane-shell/tree/work-layout'
import { registry } from '@/contrib/registry'
import { isOnboardingEnabled } from '@/lib/onboarding-enabled'

export { WORK_LAYOUT_ID }

// ---------------------------------------------------------------------------
// Layout presets — CHAT (main) always dominates.
// ---------------------------------------------------------------------------

// Stock Default: sessions left, chat main, right column review | files over
// terminal. Reset restores this. The Work layout below is the Codex-style
// fork preset and is NOT this tree.
export const DEFAULT_TREE = split(
  'row',
  [
    group(['sessions'], { id: 'grp-sessions' }),
    group(['workspace'], { id: 'grp-main' }),
    split(
      'column',
      [
        split(
          'row',
          [group(['review'], { id: 'grp-review' }), group(['files'], { id: 'grp-files' })],
          [1, 1.2],
          'spl-rail'
        ),
        group(['terminal'], { id: 'grp-terminal' })
      ],
      [1.6, 1],
      'spl-right'
    )
  ],
  [1, 3.4, 1.25],
  'spl-root'
)

// Sessions | chat stacked over a bottom terminal | work slot. Preview tiles
// stack into work. File tree stays command-only (`view.showFiles`).
export const WORK_TREE = split(
  'row',
  [
    group(['sessions'], { id: 'grp-sessions' }),
    split(
      'column',
      [group(['workspace'], { id: 'grp-main' }), group(['terminal'], { id: 'grp-terminal' })],
      [3.2, 1],
      'spl-center'
    ),
    group(['work'], { id: 'grp-work' })
  ],
  [1, 3.4, 1.25],
  'spl-root'
)

const FOCUS_TREE = split('row', [group(['sessions']), group(['workspace', 'files', 'review', 'terminal'])], [1, 4.6])

const BASIC_TREE = split('row', [group(['sessions']), group(['workspace'])], [1, 4.6])

const TERMINAL_TREE = split(
  'column',
  [
    split('row', [group(['sessions']), group(['workspace']), group(['files', 'review'])], [1, 3.2, 1.2]),
    group(['terminal'])
  ],
  [3, 1]
)

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['sessions', 'files']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['review'])], [1.4, 1])
  ],
  [3, 1]
)

export function registerLayoutPresets() {
  return registry.registerMany([
    { id: 'default', area: 'layouts', title: 'Default', order: 0, data: DEFAULT_TREE },
    { id: WORK_LAYOUT_ID, area: 'layouts', title: 'Work', order: 1, data: WORK_TREE },
    ...(isOnboardingEnabled() ? [{ id: 'basic', area: 'layouts', title: 'Basic', order: 5, data: BASIC_TREE }] : []),
    { id: 'focus', area: 'layouts', title: 'Focus', order: 10, data: FOCUS_TREE },
    { id: 'terminal-deck', area: 'layouts', title: 'Terminal deck', order: 20, data: TERMINAL_TREE },
    { id: 'quad', area: 'layouts', title: 'Quad', order: 30, data: QUAD_TREE }
  ])
}
