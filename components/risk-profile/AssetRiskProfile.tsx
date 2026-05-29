'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Lock, Sliders } from 'lucide-react'
import {
  upsertUserProfile,
  updateUiMode,
  updateStrategyOverride,
  updateAssetClassOverride,
  updateAutoExecuteThreshold,
} from '@/lib/actions/risk-profile'
import type { RiskProfileRow, StrategyDefRow, UserRiskProfileRow } from '@/lib/actions/asset-risk-profile'

// ─── Profile display metadata ─────────────────────────────────────────────────

const PROFILE_KEYS = ['vault', 'conservative', 'balanced', 'growth', 'speculative'] as const
type ProfileKey = typeof PROFILE_KEYS[number]

const PROFILE_STYLES: Record<ProfileKey, { ring: string; dot: string; badge: string }> = {
  vault:        { ring: 'ring-blue-500  border-blue-600  bg-blue-950/40',  dot: 'bg-blue-400',   badge: 'text-blue-300' },
  conservative: { ring: 'ring-teal-500  border-teal-600  bg-teal-950/40',  dot: 'bg-teal-400',   badge: 'text-teal-300' },
  balanced:     { ring: 'ring-gray-400  border-gray-500  bg-gray-800/60',  dot: 'bg-gray-300',   badge: 'text-gray-200' },
  growth:       { ring: 'ring-orange-500 border-orange-600 bg-orange-950/40', dot: 'bg-orange-400', badge: 'text-orange-300' },
  speculative:  { ring: 'ring-red-500   border-red-600   bg-red-950/40',   dot: 'bg-red-400',    badge: 'text-red-300' },
}

const PROFILE_DOTS: Record<ProfileKey, number> = {
  vault: 1, conservative: 2, balanced: 3, growth: 4, speculative: 5,
}

const RETURN_TARGETS: Record<ProfileKey, string> = {
  vault: '4-6%/yr', conservative: '8-12%/yr', balanced: '12-20%/yr',
  growth: '20-35%/yr', speculative: 'Uncapped',
}

const MAX_DD: Record<ProfileKey, string> = {
  vault: '5%', conservative: '10%', balanced: '20%', growth: '35%', speculative: '50%+',
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  stocks: 'Stocks', crypto: 'Crypto', options: 'Options',
  forex: 'Forex', polymarket: 'Prediction Markets', 'multi-asset': 'Multi-Asset', all: 'All Assets',
}

// ─── Confirmation modal ───────────────────────────────────────────────────────

function ConfirmModal({
  title, body, onConfirm, onCancel,
}: {
  title: string; body: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
        <p className="font-semibold text-white">{title}</p>
        <p className="text-sm text-gray-400">{body}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-white transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-100 transition-colors">
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Strategy chip / card ─────────────────────────────────────────────────────

function StrategyItem({
  def, isActive, isInProfile, profileKey, canToggle, hasOverride, onToggle,
}: {
  def: StrategyDefRow
  isActive: boolean
  isInProfile: boolean
  profileKey: ProfileKey
  canToggle: boolean
  hasOverride: boolean
  onToggle: (key: string, val: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const overrideColor = hasOverride
    ? isActive && !isInProfile ? 'border-orange-700/60 bg-orange-950/20'
    : !isActive && isInProfile ? 'border-blue-700/60 bg-blue-950/20'
    : ''
    : ''

  const minProfileRequired = PROFILE_KEYS.find(p =>
    def.enabled_in_profiles.includes(p)
  ) ?? 'speculative'

  return (
    <div className={`rounded-xl border transition-all ${
      isActive
        ? `border-gray-600 bg-gray-900/50 ${overrideColor}`
        : 'border-gray-800 bg-gray-950/60 opacity-50'
    }`}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-white">{def.layman_name}</span>
            {def.requires_advanced_warning && (
              <span className="text-xs bg-yellow-950/60 border border-yellow-800/50 text-yellow-400 rounded px-1.5 py-0.5">
                High risk
              </span>
            )}
            {hasOverride && isActive && !isInProfile && (
              <span className="text-xs bg-orange-950/60 border border-orange-700/50 text-orange-300 rounded px-1.5 py-0.5">
                More risk than profile
              </span>
            )}
            {hasOverride && !isActive && isInProfile && (
              <span className="text-xs bg-blue-950/60 border border-blue-700/50 text-blue-300 rounded px-1.5 py-0.5">
                Safer than profile
              </span>
            )}
            {!isInProfile && !hasOverride && (
              <span className="text-xs text-gray-600">
                Unlocks at {minProfileRequired}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-gray-600 hover:text-gray-400 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {canToggle ? (
            <button
              onClick={() => onToggle(def.strategy_key, !isActive)}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${isActive ? 'bg-green-600' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          ) : (
            isActive
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <Lock className="w-4 h-4 text-gray-700" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 text-xs text-gray-400 leading-relaxed border-t border-gray-800 pt-2">
          {def.plain_english_description}
        </div>
      )}
    </div>
  )
}

// ─── Asset class group (for assetClass="all" view) ───────────────────────────

function AssetGroup({
  label, strategies, profileKey, uiMode, overrides, onToggle,
}: {
  label: string
  strategies: StrategyDefRow[]
  profileKey: ProfileKey
  uiMode: 'basic' | 'advanced'
  overrides: Record<string, boolean>
  onToggle: (key: string, val: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const activeCount = strategies.filter(d => {
    const ov = overrides[d.strategy_key]
    return uiMode === 'advanced'
      ? (ov !== undefined ? ov : d.enabled_in_profiles.includes(profileKey))
      : d.enabled_in_profiles.includes(profileKey)
  }).length

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/30 transition-colors"
      >
        <div>
          <span className="text-sm font-semibold text-white">{label}</span>
          <span className="text-xs text-gray-500 ml-2">{activeCount}/{strategies.length} active</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-gray-800">
          {strategies.map(def => {
            const ov = overrides[def.strategy_key]
            const inProfile = def.enabled_in_profiles.includes(profileKey)
            const active = uiMode === 'advanced' ? (ov !== undefined ? ov : inProfile) : inProfile
            return (
              <StrategyItem
                key={def.strategy_key}
                def={def}
                isActive={active}
                isInProfile={inProfile}
                profileKey={profileKey}
                canToggle={uiMode === 'advanced'}
                hasOverride={ov !== undefined}
                onToggle={onToggle}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  assetClass: string
  profiles: RiskProfileRow[]
  userProfile: UserRiskProfileRow | null
  strategyDefs: StrategyDefRow[]
  migrationApplied: boolean
}

export function AssetRiskProfile({ assetClass, profiles, userProfile, strategyDefs, migrationApplied }: Props) {
  const [isPending, startTransition] = useTransition()
  const [profileKey, setProfileKey] = useState<ProfileKey>(
    (userProfile?.profile_key ?? 'balanced') as ProfileKey
  )
  const [uiMode, setUiModeState] = useState<'basic' | 'advanced'>(userProfile?.ui_mode ?? 'basic')
  const [overrides, setOverrides] = useState<Record<string, boolean>>(
    userProfile?.custom_strategy_overrides ?? {}
  )
  const [assetEnabled, setAssetEnabled] = useState<boolean>(
    (userProfile?.asset_class_overrides ?? {})[assetClass] !== false
  )
  const [autoThreshold, setAutoThreshold] = useState<number>(
    userProfile?.auto_execute_threshold_usd ?? 0
  )
  const [showThreshold, setShowThreshold] = useState(false)
  const [confirmProfile, setConfirmProfile] = useState<ProfileKey | null>(null)
  const [confirmMode, setConfirmMode] = useState<'basic' | 'advanced' | null>(null)

  // Not-applied state
  if (!migrationApplied) {
    return (
      <div className="mx-4 mb-4 rounded-xl border border-yellow-700/60 bg-yellow-950/20 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-yellow-300">Risk Profile system not initialized</p>
          <p className="text-xs text-yellow-500 mt-1">
            Run the migration SQL in your Supabase dashboard. Copy from{' '}
            <code className="bg-yellow-950 px-1 rounded">supabase/schema.sql</code> starting at
            the &quot;Risk Profile System&quot; section.
          </p>
        </div>
      </div>
    )
  }

  function handleProfileSelect(key: ProfileKey) {
    setConfirmProfile(key)
  }

  function confirmProfileChange() {
    if (!confirmProfile) return
    const key = confirmProfile
    setConfirmProfile(null)
    setProfileKey(key)
    startTransition(async () => { await upsertUserProfile(key) })
  }

  function handleModeClick(mode: 'basic' | 'advanced') {
    if (mode === uiMode) return
    setConfirmMode(mode)
  }

  function confirmModeChange() {
    if (!confirmMode) return
    const mode = confirmMode
    setConfirmMode(null)
    setUiModeState(mode)
    startTransition(async () => { await updateUiMode(mode) })
  }

  function handleStrategyToggle(key: string, val: boolean) {
    setOverrides(prev => ({ ...prev, [key]: val }))
    startTransition(async () => { await updateStrategyOverride(key, val) })
  }

  function handleAssetToggle() {
    const next = !assetEnabled
    setAssetEnabled(next)
    startTransition(async () => { await updateAssetClassOverride(assetClass, next) })
  }

  function handleThresholdChange(val: number) {
    setAutoThreshold(val)
    startTransition(async () => { await updateAutoExecuteThreshold(val > 0 ? val : null) })
  }

  const style = PROFILE_STYLES[profileKey]
  const assetLabel = ASSET_CLASS_LABELS[assetClass] ?? assetClass

  // For assetClass="all" group by asset class
  const assetGroups = assetClass === 'all'
    ? ['stocks', 'crypto', 'options', 'forex', 'polymarket', 'multi-asset'].map(cls => ({
        cls,
        defs: strategyDefs.filter(d => d.asset_class === cls),
      })).filter(g => g.defs.length > 0)
    : null

  const activeCount = strategyDefs.filter(d => {
    const ov = overrides[d.strategy_key]
    return uiMode === 'advanced'
      ? (ov !== undefined ? ov : d.enabled_in_profiles.includes(profileKey))
      : d.enabled_in_profiles.includes(profileKey)
  }).length

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 space-y-5">
      {/* Confirmation modals */}
      {confirmProfile && (
        <ConfirmModal
          title={`Switch to ${profiles.find(p => p.profile_key === confirmProfile)?.display_name}?`}
          body="This affects new trades only. Open positions keep their original settings."
          onConfirm={confirmProfileChange}
          onCancel={() => setConfirmProfile(null)}
        />
      )}
      {confirmMode && (
        <ConfirmModal
          title={`Switch to ${confirmMode === 'basic' ? 'Basic' : 'Advanced'} mode?`}
          body={confirmMode === 'basic'
            ? 'Your strategy overrides will be preserved but ignored until you return to Advanced mode.'
            : 'You can override individual strategies on top of your profile baseline.'}
          onConfirm={confirmModeChange}
          onCancel={() => setConfirmMode(null)}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-0.5">
            Risk profile for {assetLabel}
          </p>
          <p className="text-sm text-gray-400">
            {assetClass === 'all'
              ? `${activeCount} strategies active across all asset classes`
              : assetEnabled
                ? `${activeCount} of ${strategyDefs.length} strategies active`
                : `${assetLabel} strategies disabled`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Asset class toggle (not shown for "all") */}
          {assetClass !== 'all' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{assetLabel} on</span>
              <button
                onClick={handleAssetToggle}
                disabled={isPending}
                className={`w-10 h-5 rounded-full transition-colors relative ${assetEnabled ? 'bg-green-600' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${assetEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
            {(['basic', 'advanced'] as const).map(m => (
              <button
                key={m}
                onClick={() => handleModeClick(m)}
                className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                  uiMode === m ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Profile cards */}
      <div className="grid grid-cols-5 gap-2">
        {profiles.map(p => {
          const key = p.profile_key as ProfileKey
          const s = PROFILE_STYLES[key] ?? PROFILE_STYLES.balanced
          const dots = PROFILE_DOTS[key] ?? 3
          const active = profileKey === key
          return (
            <button
              key={key}
              onClick={() => handleProfileSelect(key)}
              disabled={isPending}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                active ? `ring-2 ${s.ring} border-transparent` : 'border-gray-700 hover:border-gray-500 bg-gray-900/40'
              }`}
            >
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(n => (
                  <div key={n} className={`w-1.5 h-1.5 rounded-full ${n <= dots && active ? s.dot : n <= dots ? 'bg-gray-600' : 'bg-gray-800'}`} />
                ))}
              </div>
              <span className={`text-xs font-semibold leading-tight ${active ? s.badge : 'text-gray-400'}`}>
                {p.display_name}
              </span>
              {active && (
                <div className="text-center space-y-0.5">
                  <p className="text-xs text-gray-500">Target: {RETURN_TARGETS[key]}</p>
                  <p className="text-xs text-gray-600">Max DD: {MAX_DD[key]}</p>
                  <p className="text-xs text-gray-600">Confluence: {p.confluence_threshold}+</p>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Profile description */}
      {profiles.find(p => p.profile_key === profileKey) && (
        <p className="text-xs text-gray-400 leading-relaxed">
          {profiles.find(p => p.profile_key === profileKey)!.description}
        </p>
      )}

      {/* Advanced mode notice */}
      {uiMode === 'advanced' && (
        <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-3 py-2">
          <Sliders className="w-3.5 h-3.5 shrink-0" />
          Advanced mode: toggle individual strategies. Orange = more risk than profile. Blue = safer than profile.
        </div>
      )}

      {/* Strategies */}
      {assetEnabled && (
        <>
          {assetClass === 'all' && assetGroups ? (
            <div className="space-y-2">
              {assetGroups.map(({ cls, defs }) => (
                <AssetGroup
                  key={cls}
                  label={ASSET_CLASS_LABELS[cls] ?? cls}
                  strategies={defs}
                  profileKey={profileKey}
                  uiMode={uiMode}
                  overrides={overrides}
                  onToggle={handleStrategyToggle}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {strategyDefs.map(def => {
                const ov = overrides[def.strategy_key]
                const inProfile = def.enabled_in_profiles.includes(profileKey)
                const active = uiMode === 'advanced' ? (ov !== undefined ? ov : inProfile) : inProfile
                return (
                  <StrategyItem
                    key={def.strategy_key}
                    def={def}
                    isActive={active}
                    isInProfile={inProfile}
                    profileKey={profileKey}
                    canToggle={uiMode === 'advanced'}
                    hasOverride={ov !== undefined}
                    onToggle={handleStrategyToggle}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {!assetEnabled && assetClass !== 'all' && (
        <div className="text-center py-4 text-sm text-gray-600">
          {assetLabel} strategies are disabled. Toggle above to re-enable.
        </div>
      )}

      {/* Auto-execute threshold (collapsible) */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowThreshold(t => !t)}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {showThreshold ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Auto-execute threshold
          {autoThreshold > 0 && (
            <span className="text-green-400 ml-1">
              (under ${autoThreshold.toLocaleString()})
            </span>
          )}
        </button>
        {showThreshold && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-500">
              Trades below this size execute automatically without approval.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range" min={0} max={10000} step={500}
                value={autoThreshold}
                onChange={e => handleThresholdChange(Number(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="font-mono text-green-400 text-sm w-24 text-right">
                {autoThreshold === 0 ? 'Manual only' : `< $${autoThreshold.toLocaleString()}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
