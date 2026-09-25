import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { type CredentialPoolProvider, listCredentialPool, removeCredentialPoolEntry, setCredentialPoolStrategy } from '@/api/config'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { KeyRound, Trash2 } from '@/lib/icons'
import { confirm } from '@/store/confirm'
import { $desktopOnboarding, startManualProviderOAuth } from '@/store/onboarding'

import { SectionHeading } from './primitives'

const STRATEGIES = ['fill_first', 'round_robin', 'least_used', 'random'] as const
type Strategy = (typeof STRATEGIES)[number]

export const CAN_ADD_SUBSCRIPTION = new Set(['openai-codex', 'xai-oauth'])

export function PoolAccounts({
  connected = [],
  profile
}: {
  connected?: Array<{ id: string; name?: string }>
  profile?: string
}) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const flow = useStore($desktopOnboarding).flow
  const [providers, setProviders] = useState<CredentialPoolProvider[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await listCredentialPool(profile)
      setProviders(next.providers ?? [])
    } catch {
      setProviders([])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (flow.status === 'success' && CAN_ADD_SUBSCRIPTION.has(flow.provider.id)) {
      void load()
    }
  }, [flow, load])

  const remove = useCallback(async (provider: string, index: number, label: string) => {
    const ok = await confirm({
      confirmLabel: t.common.remove,
      destructive: true,
      title: copy.removeConfirm(label)
    })

    if (!ok) {return}
    setRemoving(`${provider}:${index}`)

    try {
      await removeCredentialPoolEntry(provider, index, profile)
      await load()
    } finally {
      setRemoving(null)
    }
  }, [copy, load, profile, t.common.remove])

  const labels: Record<Strategy, string> = {
    fill_first: copy.rotationFillFirst,
    least_used: copy.rotationLeastUsed,
    random: copy.rotationRandom,
    round_robin: copy.rotationRoundRobin
  }

  const names = new Map(connected.map(item => [item.id, item.name ?? item.id]))
  const known = new Map(providers.map(group => [group.provider, group]))

  for (const item of connected) {
    if (!CAN_ADD_SUBSCRIPTION.has(item.id) || known.has(item.id)) {continue}
    known.set(item.id, { entries: [], provider: item.id, strategy: 'fill_first' })
  }

  const groups = [...known.values()]

  return (
    <section className="mt-6 grid gap-3">
      <SectionHeading icon={KeyRound} title={copy.rotation} />
      {groups.length === 0 ? (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{copy.poolEmpty}</p>
      ) : (
        groups.map(group => {
          const strategy = (STRATEGIES as readonly string[]).includes(group.strategy ?? '')
            ? (group.strategy as Strategy)
            : 'fill_first'

          return (
            <div className="rounded-[6px] border border-(--ui-stroke-tertiary) px-3 py-2.5" key={group.provider}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-semibold">{names.get(group.provider) ?? group.provider}</span>
                {CAN_ADD_SUBSCRIPTION.has(group.provider) && (
                  <Button
                    onClick={() => startManualProviderOAuth(group.provider, profile, { append: true })}
                    size="xs"
                    type="button"
                    variant="text"
                  >
                    {copy.addSubscription}
                  </Button>
                )}
              </div>
              <ul className="mb-2 grid gap-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
                {group.entries.length === 0 ? (
                  <li>{copy.poolEmpty}</li>
                ) : (
                  group.entries.map(entry => (
                    <li className="flex items-center justify-between gap-2" key={entry.id}>
                      <span className="min-w-0 truncate">
                        {entry.label}
                        {entry.last_status ? ` · ${entry.last_status}` : ''}
                      </span>
                      <Button
                        aria-label={`${t.common.remove} ${entry.label}`}
                        disabled={removing === `${group.provider}:${entry.index}`}
                        onClick={() => void remove(group.provider, entry.index, entry.label)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </li>
                  ))
                )}
              </ul>
              <SegmentedControl
                onChange={id => {
                  void setCredentialPoolStrategy(group.provider, id, profile).then(() => load())
                }}
                options={STRATEGIES.map(id => ({ id, label: labels[id] }))}
                value={strategy}
              />
            </div>
          )
        })
      )}
    </section>
  )
}
