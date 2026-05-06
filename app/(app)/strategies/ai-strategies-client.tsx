'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, DollarSign, Zap, Lock, CheckCircle2 } from 'lucide-react'
import { upsertUserProfile, updateStrategyOverride } from '@/lib/actions/risk-profile'
import type { ProfileKey } from '@/lib/strategies/profile-params'
import type { UserRiskProfileRow } from '@/lib/actions/risk-profile'

// ─── API cost reference ───────────────────────────────────────────────────────

const API_COST_INFO: Record<string, { label: string; cost: string; worth: string }> = {
  POLYGON_API_KEY: {
    label: 'Polygon.io',
    cost: '~$30/mo',
    worth: 'Worth it for active stock strategies — higher signal quality on momentum and breakout trades.',
  },
  GLASSNODE_API_KEY: {
    label: 'Glassnode',
    cost: '~$40/mo',
    worth: 'Worth it for crypto — provides on-chain whale movements and miner data unavailable elsewhere.',
  },
  QUIVER_QUANT_API_KEY: {
    label: 'QuiverQuant',
    cost: '~$50/mo',
    worth: 'Niche but powerful — congressional trade data. Only worth it if you run the Congressional strategy.',
  },
  FINNHUB_API_KEY: {
    label: 'Finnhub',
    cost: 'Free tier available',
    worth: 'Free tier is sufficient for the Earnings Drift strategy. No cost to get started.',
  },
  KALSHI_API_KEY: {
    label: 'Kalshi',
    cost: 'Free account',
    worth: 'No cost — just sign up. Required for weather market arbitrage against Polymarket.',
  },
  KALSHI_API_SECRET: {
    label: 'Kalshi',
    cost: 'Free account',
    worth: 'No cost — just sign up. Required for weather market arbitrage against Polymarket.',
  },
  PINNACLE_API_KEY: {
    label: 'Pinnacle Sportsbook',
    cost: 'Custom pricing',
    worth: 'Only relevant for speculative sportsbook arb. Requires a Pinnacle account in a supported jurisdiction.',
  },
  FRED_API_KEY: {
    label: 'FRED (Federal Reserve)',
    cost: 'Completely free',
    worth: 'No cost at all — free government data. Improves macro signal quality.',
  },
  OANDA_API_KEY: {
    label: 'OANDA',
    cost: 'Free with account',
    worth: 'Required for all forex strategies. Free — you just need an OANDA trading account.',
  },
  OANDA_ACCOUNT_ID: {
    label: 'OANDA',
    cost: 'Free with account',
    worth: 'Required for all forex strategies. Free — you just need an OANDA trading account.',
  },
  POLYMARKET_PRIVATE_KEY: {
    label: 'Polymarket Wallet',
    cost: 'No cost',
    worth: 'Just your crypto wallet. No subscription — you are the market maker earning the spread.',
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StrategyDef {
  strategy_key: string
  layman_name: string
  plain_english_description: string
  enabled_in_profiles: string[]
  asset_class: string
  requires_advanced_warning: boolean
  optionalEnv: string[]
  requiredEnv: string[]
}

interface ProfileMeta {
  profileKey: ProfileKey
  displayName: string
  description: string
}

interface Props {
  profiles: ProfileMeta[]
  userProfile: UserRiskProfileRow | null
  strategyDefs: StrategyDef[]
  currentProfileKey: ProfileKey
}

// ─── Profile colors ───────────────────────────────────────────────────────────

const PROFILE_RING: Record<ProfileKey, string> = {
  vault:        'ring-blue-500 bg-blue-950/40 text-blue-300',
  conservative: 'ring-teal-500 bg-teal-950/40 text-teal-300',
  balanced:     'ring-gray-400 bg-gray-800/60 text-gray-200',
  growth:       'ring-orange-500 bg-orange-950/40 text-orange-300',
  speculative:  'ring-red-500 bg-red-950/40 text-red-300',
}

const PROFILE_DOTS: Record<ProfileKey, number> = {
  vault: 1, conservative: 2, balanced: 3, growth: 4, speculative: 5,
}

const DOT_COLOR: Record<ProfileKey, string> = {
  vault: 'bg-blue-400', conservative: 'bg-teal-400', balanced: 'bg-gray-300',
  growth: 'bg-orange-400', speculative: 'bg-red-400',
}

const ASSET_LABELS: Record<string, string> = {
  stocks: 'Stocks',
  options: 'Options',
  crypto: 'Crypto',
  forex: 'Forex',
  polymarket: 'Prediction Markets',
  'multi-asset': 'Multi-Asset',
}

const ASSET_ICONS: Record<string, string> = {
  stocks: 'S', options: 'O', crypto: 'C', forex: 'FX', polymarket: 'PM', 'multi-asset': 'MA',
}

// ─── API cost badge ───────────────────────────────────────────────────────────

function ApiCostBadges({ envKeys, profileKey }: { envKeys: string[]; profileKey: ProfileKey }) {
  const unique = [...new Set(envKeys)]
  const seen = new Set<string>()
  const items = unique.flatMap(k => {
    const info = API_COST_INFO[k]
    if (!info || seen.has(info.label)) return []
    seen.add(info.label)
    return [{ key: k, ...info }]
  })
  if (items.length === 0) return null

  const isFree = items.every(i => i.cost.toLowerCase().includes('free'))
  const profileIndex = PROFILE_DOTS[profileKey]

  return (
    <div className="mt-2 space-y-1">
      {items.map(item => (
        <div key={item.key} className="flex items-start gap-2 text-xs">
          <DollarSign className={`w-3 h-3 mt-0.5 shrink-0 ${isFree ? 'text-green-400' : 'text-yellow-400'}`} />
          <div>
            <span className={`font-medium ${isFree ? 'text-green-400' : 'text-yellow-300'}`}>
              {item.label} — {item.cost}
            </span>
            {profileIndex >= 3 && (
              <p className="text-gray-500 mt-0.5">{item.worth}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Strategy card ────────────────────────────────────────────────────────────

function StrategyCard({
  def, active, profileKey, canOverride, overrideValue, onToggle,
}: {
  def: StrategyDef
  active: boolean
  profileKey: ProfileKey
  canOverride: boolean
  overrideValue: boolean | undefined
  onToggle: (key: string, val: boolean) => void
}) {
  const allEnv = [...(def.requiredEnv ?? []), ...(def.optionalEnv ?? [])]
  const hasOverride = overrideValue !== undefined

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      active ? 'border-gray-600 bg-gray-900/50' : 'border-gray-800 bg-gray-950 opacity-40'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-sm font-semibold text-white">{def.layman_name}</span>
            {def.requires_advanced_warning && (
              <span className="text-xs bg-yellow-950/60 border border-yellow-800/60 text-yellow-400 rounded px-1.5 py-0.5">
                Advanced
              </span>
            )}
            {hasOverride && (
              <span className="text-xs bg-purple-950/60 border border-purple-700/60 text-purple-300 rounded px-1.5 py-0.5">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{def.plain_english_description}</p>
          {allEnv.length > 0 && (
            <ApiCostBadges envKeys={allEnv} profileKey={profileKey} />
          )}
        </div>
        {canOverride ? (
          <button
            onClick={() => onToggle(def.strategy_key, !active)}
            className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${
              active ? 'bg-green-600' : 'bg-gray-700'
            }`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              active ? 'translate-x-5' : 'translate-x-1'
            }`} />
          </button>
        ) : (
          active
            ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            : <Lock className="w-4 h-4 text-gray-700 shrink-0 mt-0.5" />
        )}
      </div>
    </div>
  )
}

// ─── Asset class section ──────────────────────────────────────────────────────

function AssetSection({
  assetClass, strategies, profileKey, uiMode, strategyOverrides, onToggle,
}: {
  assetClass: string
  strategies: StrategyDef[]
  profileKey: ProfileKey
  uiMode: 'basic' | 'advanced'
  strategyOverrides: Record<string, boolean>
  onToggle: (key: string, val: boolean) => void
}) {
  const [open, setOpen] = useState(false)

  const activeByProfile = strategies.filter(s => s.enabled_in_profiles.includes(profileKey))
  const active = strategies.filter(s => {
    const override = strategyOverrides[s.strategy_key]
    const byProfile = override !== undefined ? override : s.enabled_in_profiles.includes(profileKey)
    return byProfile
  })
  const inactive = strategies.filter(s => !active.includes(s))

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400">
            {ASSET_ICONS[assetClass] ?? assetClass.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-white text-sm">{ASSET_LABELS[assetClass] ?? assetClass}</p>
            <p className="text-xs text-gray-500">
              {active.length} of {strategies.length} strategies active
              {uiMode === 'basic' && ` under ${profileKey}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? 'Hide' : 'Show all'}
        </button>
      </div>

      {/* Basic summary — active strategy chips */}
      {!open && active.length > 0 && (
        <div className="px-5 pb-4 flex flex-wrap gap-2">
          {active.map(s => (
            <span
              key={s.strategy_key}
              className="inline-flex items-center gap-1 text-xs bg-green-950/40 border border-green-800/50 text-green-300 rounded-full px-2.5 py-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
              {s.layman_name}
            </span>
          ))}
        </div>
      )}

      {/* Advanced expanded view */}
      {open && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-3">
          {uiMode === 'advanced' && (
            <p className="text-xs text-yellow-400 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-3 py-2">
              Advanced mode — toggle individual strategies. Overrides apply on top of your profile.
            </p>
          )}
          {strategies.map(def => {
            const override = strategyOverrides[def.strategy_key]
            const byProfile = def.enabled_in_profiles.includes(profileKey)
            const isActive = uiMode === 'advanced'
              ? (override !== undefined ? override : byProfile)
              : byProfile
            return (
              <StrategyCard
                key={def.strategy_key}
                def={def}
                active={isActive}
                profileKey={profileKey}
                canOverride={uiMode === 'advanced'}
                overrideValue={override}
                onToggle={onToggle}
              />
            )
          })}
          {inactive.length > 0 && uiMode === 'basic' && (
            <p className="text-xs text-gray-600 text-center pt-1">
              {inactive.length} more strategies unlock at higher profiles
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIStrategiesClient({ profiles, userProfile, strategyDefs, currentProfileKey }: Props) {
  const [isPending, startTransition] = useTransition()
  const [profileKey, setProfileKey] = useState<ProfileKey>(currentProfileKey)
  const [uiMode, setUiMode] = useState<'basic' | 'advanced'>(userProfile?.uiMode ?? 'basic')
  const [overrides, setOverrides] = useState<Record<string, boolean>>(
    userProfile?.customStrategyOverrides ?? {}
  )

  function handleProfileChange(key: ProfileKey) {
    setProfileKey(key)
    startTransition(async () => { await upsertUserProfile(key) })
  }

  function handleToggle(stratKey: string, val: boolean) {
    setOverrides(prev => ({ ...prev, [stratKey]: val }))
    startTransition(async () => { await updateStrategyOverride(stratKey, val) })
  }

  // Group strategies by asset class
  const ORDER = ['stocks', 'crypto', 'options', 'forex', 'polymarket', 'multi-asset']
  const byClass = ORDER.map(cls => ({
    assetClass: cls,
    strategies: strategyDefs.filter(d => d.asset_class === cls),
  })).filter(g => g.strategies.length > 0)

  const totalActive = strategyDefs.filter(d => d.enabled_in_profiles.includes(profileKey)).length

  return (
    <div className="px-6 pb-16 space-y-8 max-w-3xl">

      {/* Profile picker */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest">Risk Profile</p>
            <p className="text-sm text-gray-400 mt-0.5">
              {totalActive} strategies active &middot; AI manages the rest automatically
            </p>
          </div>
          <button
            onClick={() => {
              const next = uiMode === 'basic' ? 'advanced' : 'basic'
              setUiMode(next)
            }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              uiMode === 'advanced'
                ? 'border-yellow-700 bg-yellow-950/30 text-yellow-300'
                : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {uiMode === 'advanced' ? 'Advanced mode on' : 'Advanced mode'}
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {profiles.map(p => {
            const isActive = profileKey === p.profileKey
            const dots = PROFILE_DOTS[p.profileKey]
            const dotColor = DOT_COLOR[p.profileKey]
            return (
              <button
                key={p.profileKey}
                onClick={() => handleProfileChange(p.profileKey)}
                disabled={isPending}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center ${
                  isActive
                    ? `ring-2 ${PROFILE_RING[p.profileKey]} border-transparent`
                    : 'border-gray-700 bg-gray-900/40 hover:border-gray-500'
                }`}
              >
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <div
                      key={n}
                      className={`w-1.5 h-1.5 rounded-full ${n <= dots && isActive ? dotColor : n <= dots ? 'bg-gray-500' : 'bg-gray-800'}`}
                    />
                  ))}
                </div>
                <span className="text-xs font-medium leading-tight">{p.displayName}</span>
              </button>
            )
          })}
        </div>

        {/* Profile description */}
        {profiles.find(p => p.profileKey === profileKey) && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${PROFILE_RING[profileKey]} ring-0`}>
            <p className="text-gray-300 leading-relaxed">
              {profiles.find(p => p.profileKey === profileKey)?.description}
            </p>
          </div>
        )}
      </div>

      {/* Asset class sections */}
      <div className="space-y-4">
        {byClass.map(({ assetClass, strategies }) => (
          <AssetSection
            key={assetClass}
            assetClass={assetClass}
            strategies={strategies}
            profileKey={profileKey}
            uiMode={uiMode}
            strategyOverrides={overrides}
            onToggle={handleToggle}
          />
        ))}
      </div>

      {/* API cost explainer */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <p className="text-sm font-semibold text-white">About paid data APIs</p>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          Some strategies use third-party data providers to improve signal quality. These are always
          optional — strategies run without them but may produce fewer or weaker signals. Expand any
          asset class above to see which APIs each strategy uses and whether they make sense for your
          profile. Free APIs are shown in green; paid ones in yellow.
        </p>
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          {[
            { name: 'Polygon.io', cost: '~$30/mo', who: 'Active stock traders (Balanced+)' },
            { name: 'Glassnode', cost: '~$40/mo', who: 'Crypto-heavy portfolios (Balanced+)' },
            { name: 'QuiverQuant', cost: '~$50/mo', who: 'Congressional strategy only (Growth+)' },
            { name: 'OANDA', cost: 'Free', who: 'Anyone trading Forex' },
            { name: 'Finnhub', cost: 'Free tier', who: 'Earnings strategies (Balanced+)' },
            { name: 'FRED', cost: 'Free', who: 'All profiles (macro data)' },
          ].map(api => (
            <div key={api.name} className="flex items-start gap-2 text-xs">
              <DollarSign className={`w-3 h-3 mt-0.5 shrink-0 ${api.cost === 'Free' || api.cost === 'Free tier' ? 'text-green-400' : 'text-yellow-400'}`} />
              <div>
                <span className="text-gray-300 font-medium">{api.name}</span>
                <span className="text-gray-600 mx-1">&mdash;</span>
                <span className={api.cost === 'Free' || api.cost === 'Free tier' ? 'text-green-400' : 'text-yellow-300'}>{api.cost}</span>
                <p className="text-gray-500">{api.who}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
