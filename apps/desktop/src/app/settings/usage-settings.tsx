import { compactNumber } from '@hermes/shared'
import { useCallback, useEffect, useState } from 'react'

import { getAccountLimits, getUsageAnalytics } from '@/api/models'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { AlertCircle, BarChart3, RefreshCw } from '@/lib/icons'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { AccountLimitSnapshot, AccountLimitsResponse, AnalyticsResponse } from '@/types/hermes'

import { SectionHeading, SettingsContent } from './primitives'

const PERIODS = [7, 30, 90] as const
type Period = (typeof PERIODS)[number]

function usedLabel(percent: number | null): string | null {
  if (percent == null || Number.isNaN(percent)) {
    return null
  }

  return `${Math.round(percent)}%`
}

function QuotaCard({ snapshot }: { snapshot: AccountLimitSnapshot }) {
  const { t } = useI18n()
  const copy = t.settings.usagePage
  const title = snapshot.plan ? `${snapshot.provider} · ${snapshot.plan}` : snapshot.provider

  return (
    <div className="rounded-[6px] border border-(--ui-stroke-tertiary) px-3 py-2.5">
      <div className="text-[length:var(--conversation-text-font-size)] font-semibold">{title}</div>
      {snapshot.unavailable_reason || snapshot.windows.length === 0 ? (
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {copy.unavailable}
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          {snapshot.windows.map(window => {
            const used = usedLabel(window.used_percent)
            const reset = window.resets_at ? fmtDateTime.format(new Date(window.resets_at)) : null

            return (
              <div key={`${snapshot.provider}:${window.label}`}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[length:var(--conversation-caption-font-size)]">
                  <span>{window.label}</span>
                  <span className="text-(--ui-text-secondary)">{used ? copy.used(used) : window.detail}</span>
                </div>
                {used && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
                    <div
                      className={cn('h-full bg-primary', (window.used_percent ?? 0) >= 90 && 'bg-destructive')}
                      style={{ width: `${Math.min(100, Math.max(0, window.used_percent ?? 0))}%` }}
                    />
                  </div>
                )}
                {reset && (
                  <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                    {copy.resets(reset)}
                  </p>
                )}
              </div>
            )
          })}
          {snapshot.details.map(line => (
            <p
              className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)"
              key={line}
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function UsageSettings() {
  const { t } = useI18n()
  const copy = t.settings.usagePage
  const [period, setPeriod] = useState<Period>(30)
  const [limits, setLimits] = useState<AccountLimitsResponse | null>(null)
  const [usage, setUsage] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [nextLimits, nextUsage] = await Promise.all([getAccountLimits(), getUsageAnalytics(period)])
      setLimits(nextLimits)
      setUsage(nextUsage)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  const totals = usage?.totals
  const models = usage?.by_model ?? []

  return (
    <SettingsContent>
      <SectionHeading
        aside={
          <Button disabled={loading} onClick={() => void load()} size="xs" type="button" variant="text">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {copy.refresh}
          </Button>
        }
        icon={BarChart3}
        page
        title={copy.quotas}
      />
      {error && (
        <p className="mb-3 inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      )}
      <div className="grid gap-2">
        {(limits?.providers ?? []).length === 0 && !loading ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {copy.noProviders}
          </p>
        ) : (
          (limits?.providers ?? []).map(snapshot => <QuotaCard key={snapshot.provider} snapshot={snapshot} />)
        )}
      </div>

      <div className="mt-6">
        <SectionHeading
          aside={
            <SegmentedControl
              onChange={id => setPeriod(Number(id) as Period)}
              options={PERIODS.map(days => ({ id: String(days), label: copy.days(days) }))}
              value={String(period)}
            />
          }
          icon={BarChart3}
          title={copy.consumption}
        />
        {!totals ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{copy.empty}</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <Stat label={copy.tokens} value={compactNumber((totals.total_input || 0) + (totals.total_output || 0))} />
              <Stat label={copy.cost} value={`$${(totals.total_estimated_cost || 0).toFixed(2)}`} />
              <Stat label={copy.calls} value={compactNumber(totals.total_api_calls || 0)} />
            </div>
            <div className="grid gap-1">
              {models.map(row => (
                <div
                  className="flex items-baseline justify-between gap-3 text-[length:var(--conversation-caption-font-size)]"
                  key={row.model}
                >
                  <span className="truncate">{row.model}</span>
                  <span className="shrink-0 text-(--ui-text-secondary)">
                    {compactNumber((row.input_tokens || 0) + (row.output_tokens || 0))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SettingsContent>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{label}</div>
      <div className="text-[length:var(--conversation-text-font-size)] font-semibold">{value}</div>
    </div>
  )
}
