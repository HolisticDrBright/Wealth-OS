'use client'

import { useState, useTransition } from 'react'
import { JurisdictionModal } from './jurisdiction-modal'
import { toggleStrategyAction } from '@/lib/actions/polymarket'
import type { SignalStrategy, SettingsResponse } from '@/lib/meta-poly/types'
import { cn } from '@/lib/utils'

interface StrategyDef {
  id: SignalStrategy
  label: string
  description: string
}

const STRATEGIES: StrategyDef[] = [
  { id: 'entropy',     label: 'Entropy screener', description: 'Shannon entropy + KL divergence edge' },
  { id: 'ensemble_ai', label: 'Ensemble AI',       description: 'Claude + ensemble model probability' },
  { id: 'avellaneda',  label: 'Avellaneda',        description: 'Market-making mean-reversion' },
  { id: 'theta',       label: 'Theta harvester',   description: 'Time-decay close-to-expiry positions' },
  { id: 'binance_arb', label: 'Binance Arb',       description: 'YES+NO arbitrage vs Binance futures' },
]

const SETTINGS_KEY: Partial<Record<SignalStrategy, keyof SettingsResponse>> = {
  entropy:     'entropy_enabled',
  ensemble_ai: 'ensemble_enabled',
  avellaneda:  'avellaneda_enabled',
  theta:       'theta_enabled',
  binance_arb: 'binance_arb_enabled',
}

interface Props {
  initialSettings: SettingsResponse | null
}

export function StrategyToggles({ initialSettings }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    initialSettings
      ? {
          entropy:     initialSettings.entropy_enabled,
          ensemble_ai: initialSettings.ensemble_enabled,
          avellaneda:  initialSettings.avellaneda_enabled,
          theta:       initialSettings.theta_enabled,
          binance_arb: initialSettings.binance_arb_enabled,
        }
      : {}
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  // Jurisdiction modal state
  const [jurisdictionAcked, setJurisdictionAcked] = useState(false)
  const [pendingToggle, setPendingToggle] = useState<{ id: SignalStrategy; value: boolean } | null>(null)

  function handleToggle(id: SignalStrategy, nextValue: boolean) {
    // Only gate on enabling — disabling never needs jurisdiction check
    if (nextValue && !jurisdictionAcked) {
      setPendingToggle({ id, value: nextValue })
      return
    }
    applyToggle(id, nextValue)
  }

  function applyToggle(id: SignalStrategy, nextValue: boolean) {
    setEnabled(prev => ({ ...prev, [id]: nextValue }))
    setErrors(prev => ({ ...prev, [id]: '' }))

    startTransition(async () => {
      const result = await toggleStrategyAction(id, nextValue)
      if (result.error) {
        // Revert on error
        setEnabled(prev => ({ ...prev, [id]: !nextValue }))
        setErrors(prev => ({ ...prev, [id]: result.error! }))
      }
    })
  }

  function onJurisdictionConfirm() {
    setJurisdictionAcked(true)
    if (pendingToggle) {
      applyToggle(pendingToggle.id, pendingToggle.value)
    }
    setPendingToggle(null)
  }

  return (
    <>
      {pendingToggle && (
        <JurisdictionModal
          onConfirm={onJurisdictionConfirm}
          onCancel={() => setPendingToggle(null)}
        />
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Strategy toggles
        </p>

        {initialSettings === null && (
          <p className="mb-3 text-xs text-amber-400">
            Could not load current strategy state — toggles start optimistically enabled.
          </p>
        )}

        <div className="space-y-3">
          {STRATEGIES.map(({ id, label, description }) => {
            const isOn = enabled[id] ?? true
            const err = errors[id]
            const settingsKey = SETTINGS_KEY[id]
            const unavailable = settingsKey === undefined

            return (
              <div key={id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                  {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
                </div>
                {unavailable ? (
                  <span className="shrink-0 text-xs text-gray-600">no toggle</span>
                ) : (
                  <button
                    role="switch"
                    aria-checked={isOn}
                    aria-label={`Toggle ${label}`}
                    disabled={pending}
                    onClick={() => handleToggle(id, !isOn)}
                    className={cn(
                      'relative shrink-0 h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0f1117]',
                      isOn ? 'bg-indigo-600' : 'bg-white/10',
                      pending && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        isOn && 'translate-x-5'
                      )}
                    />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
