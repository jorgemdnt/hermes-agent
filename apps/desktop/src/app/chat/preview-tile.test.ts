import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./right-rail/preview', () => ({
  PreviewTilePane: () => null
}))

vi.mock('./right-rail/preview-console-store', () => ({
  forgetPreviewConsole: () => undefined
}))

import { registry } from '@/contrib/registry'
import { $previewTabs, closeRightRail, noteBrowserPage, openPreview } from '@/store/preview'

import { browserTabExternalUrl, browserTabLabel, watchPreviewTiles } from './preview-tile'

beforeAll(() => {
  watchPreviewTiles()
})

afterEach(() => {
  closeRightRail()
})

describe('browserTabLabel', () => {
  const target = { kind: 'url', label: 'Browser', source: 'about:blank', url: 'about:blank' } as const

  it('names the tab after the page', () => {
    expect(browserTabLabel(target, { title: 'Hacker News', url: 'https://news.ycombinator.com/' })).toBe('Hacker News')
  })

  // Chromium hands back the address as the title when the page never set one,
  // which is a worse tab label than the host it came from.
  it('falls back to the host when the page has no title of its own', () => {
    expect(browserTabLabel(target, { title: '', url: 'https://www.example.com/a/b' })).toBe('example.com')
    expect(browserTabLabel(target, { title: 'https://example.com/a', url: 'https://example.com/a' })).toBe(
      'example.com'
    )
  })

  it('falls back to the surface when there is no page and no host', () => {
    expect(browserTabLabel(target)).toBe('Browser')
    expect(browserTabLabel(target, { title: '', url: 'about:blank' })).toBe('Browser')
  })

  // A tab restored from storage has reported nothing yet, so its target is all
  // there is to name it by.
  it('names an unreported tab from its target', () => {
    expect(browserTabLabel({ ...target, url: 'https://github.com/nous' })).toBe('github.com')
  })
})

describe('browserTabExternalUrl', () => {
  const openBrowser = (url: string) => {
    openPreview({ kind: 'url', label: 'Browser', source: url, url })

    return $previewTabs.get().find(tab => tab.target.kind === 'url')!.id
  }

  it('hands the live page to the OS browser, not the address the tab was opened with', () => {
    const tabId = openBrowser('https://example.com')

    noteBrowserPage(tabId, { title: 'Hacker News', url: 'https://news.ycombinator.com/' })

    expect(browserTabExternalUrl(tabId)).toBe('https://news.ycombinator.com/')
  })

  it('falls back to the target when the tab has not reported a page yet', () => {
    expect(browserTabExternalUrl(openBrowser('https://github.com/nous'))).toBe('https://github.com/nous')
  })

  it('refuses about:blank and other non-pages', () => {
    expect(browserTabExternalUrl(openBrowser('about:blank'))).toBeNull()
  })

  it('is null for a file peek', () => {
    openPreview(fileTarget('/tmp/a.ts'))

    expect(browserTabExternalUrl('file:/tmp/a.ts')).toBeNull()
  })
})

type DockData =
  | {
      collapsible?: boolean
      dock?: { pane?: string; pos?: string }
      lifecycleKeepAlive?: boolean
      placement?: string
    }
  | undefined

function paneDataOf(paneId: string) {
  return registry.getArea('panes').find(entry => entry.id === paneId)?.data as DockData
}

function dockOf(paneId: string) {
  return paneDataOf(paneId)?.dock
}

const fileTarget = (path: string) =>
  ({ kind: 'file', label: path.split('/').at(-1) ?? path, path, source: path, url: path }) as const

// The zone reads this flag off the registered pane to offer Hide (kept-mounted,
// inert body) instead of Minimize — so it has to come through the mirror, not
// just be declared on the tile.
describe('preview tiles keep a live page alive across Hide', () => {
  it('registers a Browser tab with lifecycleKeepAlive while a text peek stays evictable', () => {
    openPreview({ kind: 'url', label: 'Browser', source: 'https://example.com', url: 'https://example.com' })
    openPreview(fileTarget('/tmp/a.ts'))

    const browserId = $previewTabs.get().find(tab => tab.target.kind === 'url')!.id

    expect(paneDataOf(`preview-tile:${browserId}`)?.lifecycleKeepAlive).toBe(true)
    expect(paneDataOf('preview-tile:file:/tmp/a.ts')?.lifecycleKeepAlive).toBeFalsy()
  })
})

describe('preview tiles stack, not split (#93610)', () => {
  it('docks the first preview right and stacks the second as a center tab in the same zone', () => {
    openPreview(fileTarget('/tmp/a.ts'))

    const first = dockOf('preview-tile:file:/tmp/a.ts')

    expect(first?.pos).toBe('right')

    openPreview(fileTarget('/tmp/b.ts'))

    const second = dockOf('preview-tile:file:/tmp/b.ts')

    expect(second?.pos).toBe('center')
    expect(second?.pane).toBe('preview-tile:file:/tmp/a.ts')

    // The first pane's registration is untouched — one preview zone, two tabs.
    expect(dockOf('preview-tile:file:/tmp/a.ts')?.pos).toBe('right')
  })

  it('stacks an artifact opened after a file into the same preview zone', () => {
    openPreview(fileTarget('/tmp/a.ts'))
    openPreview({ kind: 'artifact', label: 'Chart', source: 'artifact-1', url: 'artifact-1' })

    const artifact = dockOf('preview-tile:artifact:artifact-1')

    expect(artifact?.pos).toBe('center')
    expect(artifact?.pane).toBe('preview-tile:file:/tmp/a.ts')
  })

  it('lets a lone preview open its own right-docked zone again after all tabs closed', () => {
    openPreview(fileTarget('/tmp/a.ts'))
    openPreview(fileTarget('/tmp/b.ts'))
    closeRightRail()

    openPreview(fileTarget('/tmp/c.ts'))

    expect(dockOf('preview-tile:file:/tmp/c.ts')?.pos).toBe('right')
  })

  it('stacks the first preview into the work slot when that pane is in the tree', async () => {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')

    tree.declareDefaultTree(model.group(['work'], { id: 'grp-work' }))

    try {
      openPreview(fileTarget('/tmp/a.ts'))

      expect(dockOf('preview-tile:file:/tmp/a.ts')).toMatchObject({ pane: 'work', pos: 'center' })
    } finally {
      tree.$layoutTree.set(null)
    }
  })
})

describe('preview tiles stay a right rail', () => {
  it('does not register a Browser as placement main (that makes ⌘J a no-op)', () => {
    openPreview(
      { kind: 'url', label: 'Browser', source: 'about:blank', url: 'about:blank' }
    )

    const tabId = $previewTabs.get().find(tab => tab.target.kind === 'url')!.id

    expect(paneDataOf(`preview-tile:${tabId}`)).toMatchObject({ placement: 'right' })
  })

  // The work pane hides while a preview is showing. fixedTrackSize only sees
  // shown panes, so a tile with a cap and no width turns the slot into a flex
  // track and it eats the chat.
  it('declares the work-slot width so a preview does not flex-eat the chat', () => {
    openPreview(fileTarget('/tmp/plan.html'))

    expect(paneDataOf('preview-tile:file:/tmp/plan.html')).toMatchObject({
      maxWidth: '50vw',
      placement: 'right',
      width: '36vw'
    })
  })

  it('keeps the work column on the right after a Browser opens into it', async () => {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')

    const disposeWorkspace = registry.register({
      area: 'panes',
      data: { placement: 'main' },
      id: 'workspace',
      render: () => null,
      title: 'Chat'
    })

    const disposeWork = registry.register({
      area: 'panes',
      data: { placement: 'right' },
      id: 'work',
      render: () => null,
      title: 'Preview'
    })

    tree.declareDefaultTree(
      model.split(
        'row',
        [
          model.group(['workspace'], { id: 'grp-main' }),
          model.group(['work'], { id: 'grp-work' })
        ],
        [3.4, 1.25],
        'spl-root'
      )
    )

    try {
      openPreview(
        { kind: 'url', label: 'Browser', source: 'about:blank', url: 'about:blank' }
      )
      const tabId = $previewTabs.get().find(tab => tab.target.kind === 'url')!.id

      expect(tree.paneRootSide('work')).toBe('right')
      expect(tree.paneRootSide(`preview-tile:${tabId}`)).toBe('right')
      expect(tree.layoutHasRootSide('right')).toBe(true)
    } finally {
      disposeWorkspace()
      disposeWork()
      tree.$layoutTree.set(null)
    }
  })
})

// ---------------------------------------------------------------------------
// Session-scoped rail (#73890): only the FOCUSED session's tabs (plus pins)
// become panes, so switching sessions swaps the drawer, and pinning a tab
// surfaces it in every session.
// ---------------------------------------------------------------------------

describe('preview tiles mirror the visible session tabs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const preview = await import('@/store/preview')
    const session = await import('@/store/session')
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')
    const { watchPreviewTiles } = await import('./preview-tile')

    registry.register({
      area: 'panes',
      data: { placement: 'main', uncloseable: true },
      id: 'workspace',
      render: () => null,
      title: 'workspace'
    })
    tree.declareDefaultTree(model.group(['workspace'], { active: 'workspace', id: 'grp-main' }))
    // The app root wires registry changes into the tree; mirror it here.
    tree.watchContributedPanes()
    watchPreviewTiles()

    return { model, preview, session, tree }
  }

  const htmlTarget = (path: string) =>
    ({
      kind: 'file',
      label: path.split('/').at(-1) ?? path,
      path,
      previewKind: 'html',
      source: path,
      url: `file://${path}`
    }) as const

  it('renders only the focused session previews, pinning spans sessions', async () => {
    const { preview, session, tree } = await setup()

    session.$selectedStoredSessionId.set('sess-1')
    preview.openPreview(htmlTarget('/work/a.html'))

    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(1)

    // Switching sessions hides the pane (the tab stays open in the store).
    session.$selectedStoredSessionId.set('sess-2')
    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(0)
    expect(preview.$previewTabs.get()).toHaveLength(1)

    // Pinning makes it visible again in the new session.
    preview.setPreviewTabPinned(preview.$previewTabs.get()[0]!.id, true)
    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(1)

    // And closing the tab removes the pane for good.
    preview.closeRightRailTab(preview.$previewTabs.get()[0]!.id)
    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(0)
  })

  it('fronts the tab a session last had in front when switching back to it', async () => {
    const { preview, session } = await setup()
    const layout = await import('@/store/layout')

    session.$selectedStoredSessionId.set('sess-1')
    preview.openPreview(htmlTarget('/work/a.html'))
    preview.openPreview(htmlTarget('/work/b.html'))
    const bId = layout.$rightRailActiveTabId.get()

    preview.openPreview(htmlTarget('/work/a.html'))
    layout.selectRightRailTab(bId)

    session.$selectedStoredSessionId.set('sess-2')
    preview.openPreview(htmlTarget('/work/c.html'))

    session.$selectedStoredSessionId.set('sess-1')
    expect(layout.$rightRailActiveTabId.get()).toBe(bId)
  })

  const browserTarget = (url: string) => ({ kind: 'url', label: url, source: url, url }) as const

  it('unmounts only the longest-hidden live page past the cap, and reopens it on return', async () => {
    const { preview, session, tree } = await setup()
    const { registry } = await import('@/contrib/registry')
    const contribution = (id: string) => registry.getArea('panes').find(pane => pane.id === `preview-tile:${id}`)
    const ids: string[] = []

    for (let index = 0; index < 10; index++) {
      session.$selectedStoredSessionId.set(`sess-cap-${index}`)
      preview.openPreview(browserTarget(`https://cap-${index}.example`))
      ids.push(preview.$previewTabs.get().at(-1)!.id)
    }

    // Nine hidden, eight kept: the first session's page was let go.
    expect(contribution(ids[0]!)).toBeUndefined()
    ids.slice(1).forEach(id => expect(contribution(id)).toBeDefined())
    expect(preview.$previewTabs.get()).toHaveLength(10)

    session.$selectedStoredSessionId.set('sess-cap-0')
    expect(contribution(ids[0]!)).toBeDefined()
    expect(tree.treePanesWithPrefix('preview-tile:')).toEqual([`preview-tile:${ids[0]}`])
  })

  it('does not create panes for another session tabs', async () => {
    const { preview, session, tree } = await setup()

    session.$selectedStoredSessionId.set('sess-1')
    preview.openPreview(htmlTarget('/work/a.html'))

    session.$selectedStoredSessionId.set('sess-2')
    preview.openPreview(htmlTarget('/work/b.html'))

    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(1)

    session.$selectedStoredSessionId.set('sess-1')
    expect(tree.treePanesWithPrefix('preview-tile:')).toHaveLength(1)
  })
})
