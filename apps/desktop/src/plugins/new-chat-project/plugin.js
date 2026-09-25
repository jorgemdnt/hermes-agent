/**
 * Project + Worktree on a blank chat (composer.top).
 *
 * ⌘N stays stock session.new (a draft — never session.create/openSession).
 * First send homes the session with session.workspace.move (project folder
 * or a new worktree). Core then drills the sidebar into that project
 * (followActiveSessionCwd). Stay on the PROJECTS overview by exiting that
 * scope through the project store — never by clicking "Show projects".
 *
 * Never persist hermes.desktop.projectScope. Never click "New session in …"
 * (that path also enterProject). Never return null from middleware.
 */
import React, { useEffect } from 'react'
import {
  COMPOSER_AREAS,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  atom,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { $projectScope, ALL_PROJECTS, exitProjectScope } from '@/store/project-scope'

const PREFS = 'prefs'
const NONE_ID = ''

const $projects = atom([])
const $projectId = atom(NONE_ID)
const $worktree = atom(false)
const $pendingCwd = atom('')

let stopScopeGuard = null

function startOverviewGuard() {
  stopOverviewGuard()
  exitProjectScope()
  // followActiveSessionCwd drills in after the move. Exit again when it does,
  // instead of polling the DOM for the "Show projects" button.
  stopScopeGuard = $projectScope.subscribe(scope => {
    if (scope !== ALL_PROJECTS) {
      exitProjectScope()
    }
  })
}

function stopOverviewGuard() {
  if (typeof stopScopeGuard === 'function') {
    stopScopeGuard()
    stopScopeGuard = null
  }
}

function h(type, props, ...children) {
  return React.createElement(type, props, ...children)
}

function folderOf(project) {
  return (project?.path || project?.repos?.find(repo => repo.path)?.path || '').trim()
}

function displayPath(path) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

function slug(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  )
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'also', 'just', 'please', 'can', 'you', 'we', 'i', 'im',
  'me', 'my', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'to', 'of', 'into', 'onto', 'and', 'or', 'but', 'so', 'if', 'as',
  'at', 'on', 'in', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'do', 'does', 'did', 'should', 'would', 'could', 'have', 'has',
  'had', 'not', 'no', 'never', 'happen', 'happening', 'seeing', 'see', 'seing',
  'something', 'anything', 'everything'
])

function intentPrefix(text) {
  const t = String(text || '').toLowerCase()
  if (/\b(fix|bug|broken|leak|wrong|should never|shouldn'?t|doesn'?t|isn'?t|cannot|can't)\b/.test(t)) {
    return 'fix'
  }
  if (/\b(refactor|rename|cleanup|clean up)\b/.test(t)) {
    return 'chore'
  }
  return 'feat'
}

/** Git-style branch from a prompt: interpret the job, don't slug the whole sentence. */
function branchNameFromPrompt(text) {
  const first = String(text || '')
    .trim()
    .split(/[\n.!?]/)[0]
    .replace(/https?:\/\/\S+/g, ' ')
    .slice(0, 240)
  const lower = first.toLowerCase()
  const prefix = intentPrefix(lower)
  const fromAnother = lower.match(/\b([a-z][a-z0-9-]{1,24})\s+from another\s+([a-z][a-z0-9-]{1,24})/)

  if (fromAnother) {
    return `${prefix}/${fromAnother[1]}-from-another-${fromAnother[2]}`
  }

  const unique = []
  for (const word of lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (word.length > 1 && !STOPWORDS.has(word) && unique[unique.length - 1] !== word) {
      unique.push(word)
    }
    if (unique.length >= 6) break
  }

  return `${prefix}/${(unique.join('-') || slug(first)).slice(0, 48).replace(/^-+|-+$/g, '')}`
}

function usageStarted(usage) {
  if (!usage) return false
  return (usage.calls | 0) > 0 || (usage.input | 0) > 0 || (usage.output | 0) > 0
}

function isFresh() {
  return !host.state.focusedStoredSessionId.get() && !usageStarted(host.state.focusedUsage.get())
}

function pickBest(projects, wanted) {
  if (wanted === NONE_ID || wanted == null) return { id: NONE_ID }
  return projects.find(p => p.id === wanted) || { id: NONE_ID }
}

async function loadTree() {
  try {
    const tree = await host.request('projects.tree', { preview_limit: 0 })
    const projects = (tree?.projects || []).filter(p => p && !p.isNoProject)
    $projects.set(projects)
    return { projects, activeId: tree?.active_id || '' }
  } catch {
    $projects.set([])
    return { projects: [], activeId: '' }
  }
}

function Picker({ storage }) {
  const storedId = useValue(host.state.focusedStoredSessionId)
  const usage = useValue(host.state.focusedUsage)
  const projectId = useValue($projectId)
  const worktree = useValue($worktree)
  const projects = useValue($projects)
  const fresh = !storedId && !usageStarted(usage)

  useEffect(() => {
    if (!fresh) return undefined
    void loadTree().then(({ projects: list }) => {
      const prefs = storage.get(PREFS, {})
      const wanted = Object.prototype.hasOwnProperty.call(prefs, 'projectId') ? prefs.projectId : $projectId.get()
      $projectId.set(pickBest(list, wanted).id)
      if (typeof prefs.worktree === 'boolean') $worktree.set(prefs.worktree)
    })
    return undefined
  }, [fresh, storage])

  if (!fresh) return null

  const none = !projectId
  const selected = none ? null : projects.find(p => p.id === projectId)
  const label = none ? 'No project' : selected?.label || 'Project'
  const path = none ? '' : folderOf(selected)

  return h(
    'div',
    {
      className:
        'coding-status-bar flex min-h-7 shrink-0 items-center gap-1 rounded-t-[inherit] border-b border-(--ui-stroke-tertiary) px-3.5 py-1.5',
      style: {
        marginLeft: 'calc(-1 * var(--composer-surface-pad-x))',
        marginRight: 'calc(-1 * var(--composer-surface-pad-x))',
        marginTop: 'calc(-1 * var(--composer-surface-pad-y))',
        width: 'calc(100% + 2 * var(--composer-surface-pad-x))'
      }
    },
    h(
      'span',
      { className: 'flex size-3.5 shrink-0 items-center justify-center' },
      h(Codicon, {
        className: none ? 'text-muted-foreground/70' : 'text-(--ui-green)',
        name: none ? 'home' : 'folder',
        size: '0.8rem'
      })
    ),
    h(
      DropdownMenu,
      null,
      h(
        DropdownMenuTrigger,
        { asChild: true },
        h(
          'button',
          {
            className:
              'inline-flex h-4 min-w-0 items-center bg-transparent p-0 text-left text-xs font-normal leading-4 text-muted-foreground/92 outline-none',
            type: 'button'
          },
          h('span', { className: 'min-w-0 truncate' }, label)
        )
      ),
      h(
        DropdownMenuContent,
        { align: 'start', className: 'min-w-40', side: 'top' },
        h(
          DropdownMenuItem,
          {
            key: NONE_ID,
            onSelect: () => {
              $projectId.set(NONE_ID)
              $worktree.set(false)
              storage.set(PREFS, { projectId: NONE_ID, worktree: false })
            }
          },
          'No project'
        ),
        ...projects.map(p =>
          h(
            DropdownMenuItem,
            {
              key: p.id,
              onSelect: () => {
                $projectId.set(p.id)
                storage.set(PREFS, { projectId: p.id, worktree: $worktree.get() })
              }
            },
            p.label
          )
        )
      )
    ),
    path
      ? h(
          'span',
          { className: 'min-w-0 truncate font-mono text-[0.62rem] leading-4 text-muted-foreground/50' },
          displayPath(path)
        )
      : null,
    none
      ? null
      : h(
          'button',
          {
            className: worktree
              ? 'ml-auto h-4 shrink-0 bg-transparent p-0 text-[0.68rem] leading-4 text-muted-foreground/75'
              : 'ml-auto h-4 shrink-0 bg-transparent p-0 text-[0.68rem] leading-4 text-muted-foreground/50 hover:text-muted-foreground/75',
            onClick: event => {
              event.preventDefault()
              const next = !worktree
              $worktree.set(next)
              storage.set(PREFS, { projectId: $projectId.get(), worktree: next })
            },
            type: 'button'
          },
          'worktree'
        )
  )
}

export default {
  id: 'new-chat-project',
  name: 'New chat project',
  description: 'Project + Worktree on a blank chat. Stays on the PROJECTS overview.',
  register(ctx) {
    ctx.onDispose(stopOverviewGuard)
    startOverviewGuard()

    const onShortcut = () => {
      void loadTree().then(({ projects }) => {
        const prefs = ctx.storage.get(PREFS, {})
        const wanted = Object.prototype.hasOwnProperty.call(prefs, 'projectId') ? prefs.projectId : NONE_ID
        $projectId.set(pickBest(projects, wanted).id)
        if (typeof prefs.worktree === 'boolean') $worktree.set(prefs.worktree)
      })
    }
    window.addEventListener('hermes:new-session-shortcut', onShortcut)
    ctx.onDispose(() => window.removeEventListener('hermes:new-session-shortcut', onShortcut))

    ctx.onDispose(
      host.state.focusedStoredSessionId.subscribe(id => {
        const cwd = $pendingCwd.get()
        if (!id || !cwd) return
        $pendingCwd.set('')
        startOverviewGuard()
        host.request('session.workspace.move', { session_key: id, cwd }).catch(() => {
          $pendingCwd.set(cwd)
          const live = host.state.focusedSessionId.get()
          if (live) {
            host.request('session.cwd.set', { session_id: live, cwd }).catch(() => undefined)
          }
        })
      })
    )

    ctx.register({
      id: 'picker',
      area: COMPOSER_AREAS.top,
      render: () => h(Picker, { storage: ctx.storage })
    })

    ctx.register({
      id: 'worktree',
      area: COMPOSER_AREAS.middleware,
      data: {
        handler: async draft => {
          if (!isFresh()) return draft
          const project = $projects.get().find(p => p.id === $projectId.get())
          const repo = folderOf(project)
          if (!repo) return draft
          let cwd = repo
          $pendingCwd.set(cwd)
          const git = window.hermesDesktop?.git
          if ($worktree.get() && typeof git?.worktreeAdd === 'function') {
            try {
              const name = branchNameFromPrompt(draft.text || '')
              const result = await git.worktreeAdd(repo, { branch: name, name: name.replaceAll('/', '-') })
              if (result?.path) cwd = result.path
            } catch (err) {
              host.notify({ kind: 'warning', message: String(err?.message || err) })
            }
          }
          $pendingCwd.set(cwd)
          startOverviewGuard()
          return draft
        }
      }
    })
  }
}
