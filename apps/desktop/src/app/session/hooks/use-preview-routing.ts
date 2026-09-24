import type { GatewayEvent } from '@hermes/shared'
import { useCallback, useEffect } from 'react'

import { gatewayEventCompletedFileDiff } from '@/lib/gateway-events'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { reachablePreviewUrl } from '@/lib/preview-reach'
import {
  $previewTabs,
  beginPreviewServerRestart,
  closePreviewMatchingForSession,
  closeRightRail,
  completePreviewServerRestart,
  openPreview,
  progressPreviewServerRestart,
  renderedHtmlTarget,
  requestPreviewReload
} from '@/store/preview'
import { $activeSessionId, $currentCwd } from '@/store/session'
import { $focusedRuntimeId, $sessionTiles } from '@/store/session-states'

type EventHandler = (event: GatewayEvent) => void

interface PreviewRoutingOptions {
  baseHandleGatewayEvent: EventHandler
  currentCwd: string
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function sessionIsOnScreen(sessionId: string): boolean {
  return (
    sessionId === $focusedRuntimeId.get() ||
    sessionId === $activeSessionId.get() ||
    $sessionTiles.get().some(tile => tile.runtimeId === sessionId)
  )
}

/** Hide-on-leave, don't close. Per-session buckets already isolate the rail. */
export function pruneOffscreenSessionPreviews() {}

export function usePreviewRouting({ baseHandleGatewayEvent, currentCwd, requestGateway }: PreviewRoutingOptions) {
  const restartPreviewServer = useCallback(
    async (url: string, context?: string) => {
      const sessionId = $focusedRuntimeId.get()

      if (!sessionId) {
        throw new Error('No active session for background restart')
      }

      const cwd = $currentCwd.get() || currentCwd || ''

      const result = await requestGateway<{ task_id?: string }>('preview.restart', {
        context: context || undefined,
        cwd: cwd || undefined,
        session_id: sessionId,
        url
      })

      const taskId = result.task_id || ''

      if (!taskId) {
        throw new Error('Background restart did not return a task id')
      }

      beginPreviewServerRestart(taskId, url)

      return taskId
    },
    [currentCwd, requestGateway]
  )

  useEffect(() => {
    const offs = [
      $focusedRuntimeId.listen(pruneOffscreenSessionPreviews),
      $activeSessionId.listen(pruneOffscreenSessionPreviews),
      $sessionTiles.listen(pruneOffscreenSessionPreviews)
    ]

    return () => {
      for (const off of offs) {
        off()
      }
    }
  }, [])

  const handleDesktopGatewayEvent = useCallback<EventHandler>(
    event => {
      baseHandleGatewayEvent(event)

      if (event.type === 'preview.open') {
        // Agent-driven open. Store it on the thread that created it — never
        // the chat that happens to be focused. Off-screen / other-tile opens
        // stay in that session's bucket and only appear when you switch to it.
        const { url, label } = asRecord(event.payload)
        const target = typeof url === 'string' ? url.trim() : ''

        if (target) {
          void normalizeOrLocalPreviewTarget(target, $currentCwd.get() || currentCwd || undefined).then(
            async resolved => {
              if (!resolved) {
                return
              }

              const trimmedLabel = typeof label === 'string' ? label.trim() : ''
              // The agent's loopback is the GATEWAY's loopback. Give the pane a
              // URL this machine can load, keeping the original as the label so
              // the user still sees the address the agent named.
              const url = resolved.kind === 'url' ? await reachablePreviewUrl(resolved.url) : resolved.url
              const reached = url === resolved.url ? resolved : { ...resolved, label: resolved.label || target, url }

              openPreview(
                renderedHtmlTarget(trimmedLabel ? { ...reached, label: trimmedLabel } : reached),
                'tool-result',
                event.session_id
              )
            }
          )
        }

        return
      }

      if (event.type === 'preview.close') {
        // Close the tab on the thread that opened it. Never wipe the focused
        // chat because a background session asked to close its own preview.
        const { url } = asRecord(event.payload)
        const target = typeof url === 'string' ? url.trim() : ''

        if (!target) {
          if (!event.session_id || sessionIsOnScreen(event.session_id)) {
            closeRightRail()
          }

          return
        }

        if (closePreviewMatchingForSession(event.session_id, target)) {
          return
        }

        void normalizeOrLocalPreviewTarget(target, $currentCwd.get() || currentCwd || undefined).then(
          async resolved => {
            const candidates = [target]

            if (resolved) {
              candidates.push(resolved.source, resolved.url)

              if (resolved.kind === 'url') {
                candidates.push(await reachablePreviewUrl(resolved.url))
              }
            }

            closePreviewMatchingForSession(event.session_id, ...candidates)
          }
        )

        return
      }

      if (event.type === 'preview.restart.complete') {
        const { task_id, text } = asRecord(event.payload)

        if (typeof task_id === 'string' && task_id) {
          completePreviewServerRestart(task_id, typeof text === 'string' ? text : '')
        }
      } else if (event.type === 'preview.restart.progress') {
        const { task_id, text } = asRecord(event.payload)

        if (typeof task_id === 'string' && task_id) {
          progressPreviewServerRestart(task_id, typeof text === 'string' ? text : '')
        }
      }

      if (event.session_id && event.session_id !== $focusedRuntimeId.get()) {
        return
      }

      // Only refresh an already-open live preview when a file changes; never
      // open one unprompted. (Preview links are surfaced from the tool row into
      // the status stack — see tool-fallback.tsx.)
      if ($previewTabs.get().some(tab => tab.target.kind === 'url') && gatewayEventCompletedFileDiff(event)) {
        requestPreviewReload()
      }
    },
    [baseHandleGatewayEvent, currentCwd]
  )

  return { handleDesktopGatewayEvent, restartPreviewServer }
}
