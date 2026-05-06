'use client'

import { useState, useTransition } from 'react'
import { AlertCircle, Lock, Sliders } from 'lucide-react'
import {
  upsertUserProfile,
  updateUiMode,
  updateStrategyOverride,
  updateAssetClassOverride,
  updateAutoExecuteThreshold,
} from '@/lib/actions/risk-profile'
import type { ProfileKey } from '@/lib/strategies/profile-params'
import type { UserRiskProfileRow } from '@/lib/actions/risk-profile'

interface StrategyDef {
  strategy_key: string
  layman_name: string
  plain_english_description: string
  enabled_in_profiles: string[]
  asset_class: string
  requires_advanced_warning: boolean
}

interface ProfileMeta {
  profileKey: ProfileKey
  displayName: string
  description: string
  sort_order: number
}

interface Props {
  profiles: ProfileMeta[]
  userProfile: UserRiskProfileRow | null
  strategyDefs: StrategyDef[]
}

const PROFILE_COLORS: Record<ProfileKey, string> = {
  vault:        'border-blue-600 bg-blue-950/30 text-blue-300',
  conservative: 'border-teal-600 bg-teal-950/30 text-teal-300',
  balanced:     'border-gray-400 bg-gray-900/60 text-gray-200',
  growth:       'border-orange-500 bg-orange-950/30 text-orange-300',
  speculative:  'border-red-600 bg-red-950/30 text-red-300',
}

const ASSET_CLASSES = ['stocks', 'options', 'crypto', 'forex', 'polymarket', 'multi-asset']

export function RiskProfileClient({ profiles, userProfile, strategyDefs }: Props) {
  const [isPending, startTransition] = useTransition()
  const [currentProfile, setCurrentProfile] = useState<ProfileKey>(
    userProfile?.profileKey ?? 'balanced'
  )
  const [uiMode, setUiModeState] = useState<'basic' | 'advanced'>(
    userProfile?.uiMode ?? 'basic'
  )
  const [strategyOverrides, setStrategyOverrides] = useState<Record<string, boolean>>(
    userProfile?.customStrategyOverrides ?? {}
  )
  const [assetOverrides, setAssetOverrides] = useState<Record<string, boolean>>(
    userProfile?.assetClassOverrides ?? {}
  )
  const [autoThreshold, setAutoThreshold] = useState<number>(
    userProfile?.autoExecuteThresholdUsd ?? 0
  )
  const [showModeConfirm, setShowModeConfirm] = useState<'basic' | 'advanced' | null>(null)

  function handleProfileChange(key: ProfileKey) {
    setCurrentProfile(key)
    startTransition(async () => {
      await upsertUserProfile(key)
    })
  }

  function handleModeToggle(target: 'basic' | 'advanced') {
    setShowModeConfirm(target)
  }

  function confirmModeChange() {
    if (!showModeConfirm) return
    const target = showModeConfirm
    setShowModeConfirm(null)
    setUiModeState(target)
    startTransition(async () => { await updateUiMode(target) })
  }

  function handleStrategyToggle(key: string, enabled: boolean) {
    setStrategyOverrides(prev => ({ ...prev, [key]: enabled }))
    startTransition(async () => { await updateStrategyOverride(key, enabled) })
  }

  function handleAssetToggle(assetClass: string, enabled: boolean) {
    setAssetOverrides(prev => ({ ...prev, [assetClass]: enabled }))
    startTransition(async () => { await updateAssetClassOverride(assetClass, enabled) })
  }

  function handleAutoThresholdChange(val: number) {
    setAutoThreshold(val)
    startTransition(async () => { await updateAutoExecuteThreshold(val > 0 ? val : null) })
  }

  // Determine which strategies are enabled for the current profile
  function isEnabledByProfile(def: StrategyDef): boolean {
    return def.enabled_in_profiles.includes(currentProfile)
  }

  function effectiveEnabled(def: StrategyDef): boolean {
    if (uiMode === 'basic') {
      const assetOk = assetOverrides[def.asset_class] !== false
      return isEnabledByProfile(def) && assetOk
    }
    const override = strategyOverrides[def.strategy_key]
    const byProfile = override !== undefined ? override : isEnabledByProfile(def)
    const assetOk = assetOverrides[def.asset_class] !== false
    return byProfile && assetOk
  }

  const groupedStrategies = ASSET_CLASSES.map(cls => ({
    assetClass: cls,
    strategies: strategyDefs.filter(d => d.asset_class === cls),
  })).filter(g => g.strategies.length > 0)

  return (
    <div className="px-6 pb-16 max-w-3xl space-y-8">

      {/* Mode toggle */}
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-white">Interface Mode</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Basic uses your profile defaults. Advanced lets you override individual strategies.
            </p>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {(['basic', 'advanced'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => uiMode !== mode && handleModeToggle(mode)}
                className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
                  uiMode === mode
                    ? 'bg-white text-black'
                    : 'bg-transparent text-gray-400 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        {uiMode === 'advanced' && (
          <div className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-950/30 border border-yellow-800 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Advanced mode — your strategy overrides are active. Switching to Basic will preserve
              overrides but ignore them until you return to Advanced.
            </span>
          </div>
        )}
      </div>

      {/* Mode change confirmation modal */}
      {showModeConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <p className="font-semibold text-white text-lg">
              Switch to {showModeConfirm === 'basic' ? 'Basic' : 'Advanced'} mode?
            </p>
            <p className="text-sm text-gray-400">
              {showModeConfirm === 'basic'
                ? 'Your custom strategy overrides will be preserved but ignored until you return to Advanced mode.'
                : 'You will be able to override individual strategies and parameters on top of your profile baseline.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowModeConfirm(null)}
                className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-white transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmModeChange}
                className="flex-1 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-100 transition-colors text-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile picker */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Risk Profile</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profiles.map(p => (
            <button
              key={p.profileKey}
              onClick={() => handleProfileChange(p.profileKey)}
              disabled={isPending}
              className={`text-left px-5 py-4 rounded-xl border transition-all ${
                currentProfile === p.profileKey
                  ? PROFILE_COLORS[p.profileKey]
                  : 'border-gray-700 bg-gray-900/40 hover:border-gray-500'
              }`}
            >
              <p className="font-semibold text-sm">{p.displayName}</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{p.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Asset class exclusions */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Asset Classes</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ASSET_CLASSES.map(cls => {
            const enabled = assetOverrides[cls] !== false
            return (
              <button
                key={cls}
                onClick={() => handleAssetToggle(cls, !enabled)}
                className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors capitalize ${
                  enabled
                    ? 'border-green-700 bg-green-950/30 text-green-300'
                    : 'border-gray-700 bg-gray-900/40 text-gray-500 line-through'
                }`}
              >
                {cls.replace('-', ' ')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Auto-execute threshold */}
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 space-y-4">
        <div>
          <p className="font-semibold text-white">Auto-Execute Threshold</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Trades below this notional size execute automatically. Set to $0 to review all.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={10000}
            step={100}
            value={autoThreshold}
            onChange={e => handleAutoThresholdChange(Number(e.target.value))}
            className="flex-1 accent-green-500"
          />
          <span className="font-mono text-green-400 w-20 text-right text-sm">
            {autoThreshold === 0 ? 'Manual' : `$${autoThreshold.toLocaleString()}`}
          </span>
        </div>
      </div>

      {/* Strategy list */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Strategies</p>
          {uiMode === 'advanced' && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-950/30 border border-yellow-800 rounded px-2 py-0.5">
              <Sliders className="w-3 h-3" />
              Override mode active
            </span>
          )}
        </div>

        {groupedStrategies.map(({ assetClass, strategies }) => {
          const assetEnabled = assetOverrides[assetClass] !== false
          return (
            <div key={assetClass} className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-widest capitalize">
                {assetClass.replace('-', ' ')}
                {!assetEnabled && (
                  <span className="ml-2 text-red-400">(asset class excluded)</span>
                )}
              </p>
              {strategies.map(def => {
                const active = effectiveEnabled(def)
                const hasOverride = uiMode === 'advanced' && strategyOverrides[def.strategy_key] !== undefined
                return (
                  <div
                    key={def.strategy_key}
                    className={`rounded-xl border p-4 flex items-start justify-between gap-4 transition-colors ${
                      active
                        ? 'border-gray-600 bg-gray-900/50'
                        : 'border-gray-800 bg-gray-950 opacity-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white">{def.layman_name}</p>
                        {def.requires_advanced_warning && (
                          <span className="text-xs bg-yellow-950/60 border border-yellow-800 text-yellow-400 rounded px-1.5 py-0.5">
                            Advanced
                          </span>
                        )}
                        {hasOverride && (
                          <span className="text-xs bg-purple-950/60 border border-purple-700 text-purple-300 rounded px-1.5 py-0.5">
                            Override
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                        {def.plain_english_description}
                      </p>
                    </div>
                    {uiMode === 'advanced' && assetEnabled ? (
                      <button
                        onClick={() => handleStrategyToggle(def.strategy_key, !effectiveEnabled(def))}
                        className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${
                          active ? 'bg-green-600' : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                            active ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    ) : (
                      <Lock className="w-4 h-4 text-gray-700 shrink-0 mt-0.5" />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
