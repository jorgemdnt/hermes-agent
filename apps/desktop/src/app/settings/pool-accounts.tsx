import { useCallback, useEffect, useState } from 'react'

import { listCredentialPool, setCredentialPoolStrategy, type CredentialPoolProvider } from '@/api/config'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { KeyRound } from '@/lib/icons'
import { startManualProviderOAuth } from '@/store/onboarding'

import { SectionHeading } from './primitives'

const STRATEGIES = ['fill_first', 'round_robin', 'least_used', 'random'] as const
type Strategy = (typeof STRATEGIES)[number]

export function PoolAccounts({ connected = [], profile }: { connected?: string[]; profile?: string }) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const [providers, setProviders] = useState<CredentialPoolProvider[]>([])

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

  const labels: Record<Strategy, string> = {
    fill_first: copy.rotationFillFirst,
    least_used: copy.rotationLeastUsed,
    random: copy.rotationRandom,
    round_robin: copy.rotationRoundRobin
  }

  const known = new Map(providers.map(group => [group.provider, group]))
  for (const id of connected) {
    if (!known.has(id)) {
      known.set(id, { entries: [], provider: id, strategy: 'fill_first' })
    }
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
                <span className="font-semibold">{group.provider}</span>
                <Button
                  onClick={() => startManualProviderOAuth(group.provider, profile, { append: true })}
                  size="xs"
                  type="button"
                  variant="text"
                >
                  {copy.addSubscription}
                </Button>
              </div>
              <ul className="mb-2 grid gap-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
                {group.entries.map(entry => (
                  <li key={entry.id}>
                    {entry.label}
                    {entry.last_status ? ` · ${entry.last_status}` : ''}
                  </li>
                ))}
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
