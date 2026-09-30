import { cardReference, type CardSummary, resolveCard } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { useNavigate } from 'react-router'

import { pluginRest } from '@/api/plugins'
import { navigateToWorkspacePage } from '@/app/routes'
import { setPluginEnabled } from '@/contrib/plugins-store'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'

export function CardLink({ href }: { href: string }) {
  const reference = cardReference(href)!
  const scope = useStore($activeConnectionId)
  const profile = useStore($activeGatewayProfile)
  const navigate = useNavigate()

  const { data: card } = useQuery({
    queryKey: ['card-reference', scope, profile, reference.board ?? '', reference.id],
    queryFn: () =>
      resolveCard(
        reference,
        '',
        (id, board) =>
          pluginRest<{ task: CardSummary }>(
            'kanban',
            `/tasks/${id}${board ? `?board=${encodeURIComponent(board)}` : ''}`
          ),
        () => pluginRest('kanban', '/boards')
      ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false
  })

  const query = new URLSearchParams({ task: reference.id })

  if (card?.board || reference.board) {
    query.set('board', card?.board || reference.board!)
  }

  return (
    <a
      className="ref inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 align-baseline text-[.92em] no-underline"
      data-card-id={reference.id}
      data-status={card?.status}
      href={`/m/board/${reference.id}`}
      onClick={event => {
        event.preventDefault()
        void setPluginEnabled('kanban', true).then(() => {
          navigateToWorkspacePage(navigate, `/kanban?${query}`)
        })
      }}
      title={card ? `${card.title} · ${card.status}` : reference.id}
    >
      <span className="wrap-anywhere">{card?.title || reference.id}</span>
      {card && <small className="shrink-0 text-[.78em] text-muted-foreground">{card.status}</small>}
    </a>
  )
}

/** User/notice prose uses the same card component without interpreting code. */
export function CardMentions({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>]+|\bt_[0-9a-f]{8}\b)/g)

  return (
    <>
      {parts.map((part, index) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
        const href = link?.[2] || part

        return cardReference(href) ? <CardLink href={href} key={index} /> : <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}
