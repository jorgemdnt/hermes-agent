import { group, split } from '@/components/pane-shell/tree/model'
import { registry } from '@/contrib/registry'
import { isOnboardingEnabled } from '@/lib/onboarding-enabled'

// ---------------------------------------------------------------------------
// Layout presets — CHAT (main) always dominates.
// ---------------------------------------------------------------------------

// The REAL default: sessions left, chat main, and the right sidebars in column
// order main | … | review | work (work slot outermost). Each is its OWN zone.
// Review collapses to nothing while its pane is hidden (⌘G off).
//
// The work slot is the Codex-style right split: empty until you open a browser
// tab, a file, or a preview. Preview tiles stack into that zone as tabs — they
// are not a second column beside a file tree. The file tree is a command
// (`view.showFiles`), not the identity of "Show right sidebar".
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
          [group(['review'], { id: 'grp-review' }), group(['work'], { id: 'grp-work' })],
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

const FOCUS_TREE = split('row', [group(['sessions']), group(['workspace', 'work', 'review', 'terminal'])], [1, 4.6])

// Basic starts with sessions and chat so first-run users need not learn
// terminal, work or review panes before using Hermes.
const BASIC_TREE = split('row', [group(['sessions']), group(['workspace'])], [1, 4.6])

const TERMINAL_TREE = split(
  'column',
  [
    split('row', [group(['sessions']), group(['workspace']), group(['work', 'review'])], [1, 3.2, 1.2]),
    group(['terminal'])
  ],
  [3, 1]
)

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['sessions', 'work']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['review'])], [1.4, 1])
  ],
  [3, 1]
)

export function registerLayoutPresets() {
  return registry.registerMany([
    { id: 'default', area: 'layouts', title: 'Default', order: 0, data: DEFAULT_TREE },
    ...(isOnboardingEnabled() ? [{ id: 'basic', area: 'layouts', title: 'Basic', order: 5, data: BASIC_TREE }] : []),
    { id: 'focus', area: 'layouts', title: 'Focus', order: 10, data: FOCUS_TREE },
    { id: 'terminal-deck', area: 'layouts', title: 'Terminal deck', order: 20, data: TERMINAL_TREE },
    { id: 'quad', area: 'layouts', title: 'Quad', order: 30, data: QUAD_TREE }
  ])
}
