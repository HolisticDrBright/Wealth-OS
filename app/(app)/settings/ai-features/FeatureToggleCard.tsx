'use client'

import { useState, useTransition, useOptimistic } from 'react'
import { updateAIFeatureFlag } from '@/lib/actions/settings'
import { formatCostCents, formatCostRange } from '@/lib/utils/format-cost'
import type { AIFeatureDefinition, AIFeatureFlag, AIUsageSummary } from '@/lib/actions/settings'

interface Props {
  definition: AIFeatureDefinition
  flag: AIFeatureFlag | undefined
  usage: AIUsageSummary | undefined
}

const ALERT_OPTIONS = [50, 70, 80, 90, 95]

export function FeatureToggleCard({ definition: def, flag, usage }: Props) {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const initialState = {
    enabled: flag?.enabled ?? false,
    budgetUsd: flag?.monthly_budget_usd ?? def.default_budget_usd,
    alertPct: flag?.alert_threshold_pct ?? 80,
  }

  const [optimistic, setOptimistic] = useOptimistic(initialState)

  const [budgetInput, setBudgetInput] = useState(
    String(Math.round(flag?.monthly_budget_usd ?? def.default_budget_usd))
  )

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function save(patch: Partial<typeof initialState>) {
    const next = { ...optimistic, ...patch }
    startTransition(async () => {
      setOptimistic(next)
      const result = await updateAIFeatureFlag(def.feature_key, {
        enabled: next.enabled,
        monthly_budget_usd: next.budgetUsd,
        alert_threshold_pct: next.alertPct,
      })
      if (result?.error) {
        showToast(`Error: ${result.error}`, false)
      } else {
        showToast('Saved', true)
      }
    })
  }

  const spentUsd = usage?.spend_usd ?? 0
  const budgetUsd = optimistic.budgetUsd
  const spentCents = Math.round(spentUsd * 100)
  const budgetCents = Math.round(budgetUsd * 100)
  const pct = budgetCents > 0 ? Math.min(100, (spentCents / budgetCents) * 100) : 0
  const remaining = Math.max(0, budgetCents - spentCents)

  // Rough monthly estimate: cost_per_use × estimated calls/month
  const estimatedLowCents = Math.round(def.cost_per_use_usd * 100 * 10)
  const estimatedHighCents = Math.round(def.cost_per_use_usd * 100 * 100)

  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-violet-500'

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-200 ${
        optimistic.enabled
          ? 'border-violet-500/30 bg-violet-500/5'
          : 'border-white/10 bg-white/5'
      } ${isPending ? 'opacity-60' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{def.display_name}</p>
            {/* Estimated $/mo badge */}
            <span className="inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-400 leading-tight">
              {formatCostRange(estimatedLowCents, estimatedHighCents)}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{def.description}</p>
          <p className="text-[10px] text-gray-600 mt-1">
            ~{formatCostCents(Math.round(def.cost_per_use_usd * 100))} / {def.cost_unit}
          </p>
        </div>

        {/* Toggle */}
        <button
          onClick={() => save({ enabled: !optimistic.enabled })}
          disabled={isPending}
          className={`shrink-0 relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
            optimistic.enabled ? 'bg-violet-600' : 'bg-white/15'
          }`}
          role="switch"
          aria-checked={optimistic.enabled}
          aria-label={`Toggle ${def.display_name}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              optimistic.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Expanded controls (only when enabled) */}
      {optimistic.enabled && (
        <div className="mt-4 space-y-3">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>This month: {formatCostCents(spentCents)}</span>
              <span>
                Remaining: {formatCostCents(remaining)} / {formatCostCents(budgetCents)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Monthly cap input */}
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-gray-400 w-24">Monthly cap</label>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                min={1}
                step={1}
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                onBlur={() => {
                  const v = Math.max(1, parseInt(budgetInput, 10) || 1)
                  setBudgetInput(String(v))
                  save({ budgetUsd: v })
                }}
                className="w-20 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-white focus:border-violet-500 focus:outline-none"
                aria-label={`Monthly cap for ${def.display_name} in dollars`}
              />
              <span className="text-[10px] text-gray-600">USD</span>
            </div>
          </div>

          {/* Alert threshold select */}
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-xs text-gray-400 w-24">Alert at</label>
            <select
              value={optimistic.alertPct}
              onChange={e => save({ alertPct: Number(e.target.value) })}
              className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-white focus:border-violet-500 focus:outline-none"
              aria-label={`Alert threshold for ${def.display_name}`}
            >
              {ALERT_OPTIONS.map(pct => (
                <option key={pct} value={pct} className="bg-gray-900">
                  {pct}% of cap
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <p className={`mt-2 text-[10px] ${toast.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {toast.msg}
        </p>
      )}
    </div>
  )
}
