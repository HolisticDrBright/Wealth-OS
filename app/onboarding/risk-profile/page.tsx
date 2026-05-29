'use client'

/**
 * 5-step risk profile onboarding wizard.
 *
 * State machine:
 *   step 1: investment goal   (A-E maps to base profile index 0-4)
 *   step 2: drawdown reaction (-1 / 0 / +1 adjustment)
 *   step 3: time horizon      (may cap profile)
 *   step 4: asset preferences (optional exclusions)
 *   step 5: time commitment   (optional)
 *   final:  recommendation + confirm
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveOnboardedProfile, saveStateOfResidence } from '@/lib/actions/risk-profile'
import type { ProfileKey } from '@/lib/strategies/profile-params'

const PROFILES: ProfileKey[] = ['vault', 'conservative', 'balanced', 'growth', 'speculative']

const PROFILE_LABELS: Record<ProfileKey, string> = {
  vault:        'Vault',
  conservative: 'Conservative',
  balanced:     'Balanced',
  growth:       'Growth',
  speculative:  'Speculative',
}

const PROFILE_DESCRIPTIONS: Record<ProfileKey, string> = {
  vault:        'Capital preservation above all else. Very low risk, very low volatility.',
  conservative: 'Slow, steady income with minimal drawdown. Sleep-well-at-night money.',
  balanced:     'Equal emphasis on growth and protection. The sensible default.',
  growth:       'Prioritise returns over stability. Comfortable with larger swings.',
  speculative:  'Maximum upside. Full strategy access. Only with money you can afford to lose.',
}

type AssetClass = 'stocks' | 'options' | 'crypto' | 'forex' | 'polymarket'

interface WizardState {
  step: number
  baseIndex: number          // 0=vault … 4=speculative
  adjustment: number
  excludedAssets: Set<AssetClass>
  autoExecuteUsd: number | null
  stateOfResidence: string | null
}

function computeRecommendation(state: WizardState): ProfileKey {
  const idx = Math.min(4, Math.max(0, state.baseIndex + state.adjustment))
  return PROFILES[idx]
}

const ASSET_OPTIONS: Array<{ key: AssetClass; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'options', label: 'Options' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'forex', label: 'Forex' },
  { key: 'polymarket', label: 'Prediction Markets' },
]

export default function RiskProfileWizard() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<WizardState>({
    step: 1,
    baseIndex: 2,
    adjustment: 0,
    excludedAssets: new Set(),
    autoExecuteUsd: null,
    stateOfResidence: null,
  })
  const [confirmed, setConfirmed] = useState(false)

  const recommended = computeRecommendation(state)

  function next() {
    setState(s => ({ ...s, step: s.step + 1 }))
  }

  function setBase(index: number) {
    setState(s => ({ ...s, baseIndex: index }))
    next()
  }

  function setAdjustment(adj: number) {
    setState(s => ({ ...s, adjustment: adj }))
    next()
  }

  function applyHorizonCap(cap: number | null, adj: number) {
    setState(s => {
      let baseIndex = s.baseIndex + s.adjustment + adj
      if (cap !== null) baseIndex = Math.min(baseIndex, cap)
      return { ...s, baseIndex, adjustment: 0, step: s.step + 1 }
    })
  }

  function toggleAsset(key: AssetClass) {
    setState(s => {
      const next = new Set(s.excludedAssets)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...s, excludedAssets: next }
    })
  }

  function handleConfirm() {
    startTransition(async () => {
      const assetClassOverrides = Object.fromEntries(
        ASSET_OPTIONS.map(a => [a.key, !state.excludedAssets.has(a.key)])
      )
      void assetClassOverrides // will be saved separately after onboarding
      await Promise.all([
        saveOnboardedProfile(recommended, state.autoExecuteUsd ?? undefined),
        state.stateOfResidence ? saveStateOfResidence(state.stateOfResidence) : Promise.resolve({}),
      ])
      setConfirmed(true)
      setTimeout(() => router.push('/settings/risk-profile'), 1500)
    })
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl">&#10003;</div>
          <p className="text-white text-xl font-semibold">Profile saved</p>
          <p className="text-gray-400 text-sm">Redirecting to settings&#8230;</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-8">
        {/* Progress */}
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full ${
                n < state.step ? 'bg-green-500' : n === state.step ? 'bg-white' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Goal */}
        {state.step === 1 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">What is your primary goal?</h1>
            <div className="space-y-3">
              {[
                { label: 'Preserve my capital above all else', index: 0 },
                { label: 'Grow steadily with minimal risk', index: 1 },
                { label: 'Balance growth with protection', index: 2 },
                { label: 'Maximise long-term returns', index: 3 },
                { label: 'Aggressive upside — I know the risks', index: 4 },
              ].map(opt => (
                <button
                  key={opt.index}
                  onClick={() => setBase(opt.index)}
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Drawdown reaction */}
        {state.step === 2 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">
              Your portfolio drops 20% in a month. You&#8230;
            </h1>
            <div className="space-y-3">
              {[
                { label: 'Panic. I would sell immediately.', adj: -1 },
                { label: 'Hold. I would wait it out.', adj: 0 },
                { label: 'Buy more. Great opportunity.', adj: 1 },
              ].map(opt => (
                <button
                  key={opt.adj}
                  onClick={() => setAdjustment(opt.adj)}
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Time horizon */}
        {state.step === 3 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">When do you need access to this money?</h1>
            <div className="space-y-3">
              {[
                { label: 'Within 1 year', cap: 1, adj: 0 },
                { label: '1-3 years', cap: 2, adj: 0 },
                { label: '3-7 years', cap: null, adj: 0 },
                { label: '7+ years', cap: null, adj: 1 },
              ].map((opt, i) => (
                <button
                  key={i}
                  onClick={() => applyHorizonCap(opt.cap, opt.adj)}
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Asset preferences */}
        {state.step === 4 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Any asset classes you want to exclude?</h1>
            <p className="text-gray-400 text-sm">Optional. You can change this later.</p>
            <div className="space-y-3">
              {ASSET_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => toggleAsset(opt.key)}
                  className={`w-full text-left px-5 py-4 rounded-xl border transition-colors flex items-center justify-between ${
                    state.excludedAssets.has(opt.key)
                      ? 'border-red-600 bg-red-950/30 text-red-300'
                      : 'border-gray-700 hover:border-gray-500'
                  }`}
                >
                  <span>{opt.label}</span>
                  {state.excludedAssets.has(opt.key) && (
                    <span className="text-xs text-red-400">Excluded</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={next}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-100 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 5: Time commitment */}
        {state.step === 5 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Auto-execute trades under a threshold?</h1>
            <p className="text-gray-400 text-sm">
              Trades below this size execute without requiring your approval. Set to $0 to review
              all trades manually.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Always ask me first ($0)', value: 0 },
                { label: 'Auto-execute up to $500', value: 500 },
                { label: 'Auto-execute up to $1,000', value: 1000 },
                { label: 'Auto-execute up to $5,000', value: 5000 },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setState(s => ({ ...s, autoExecuteUsd: opt.value || null, step: 6 }))
                  }}
                  // step 6 = state-of-residence; final recommendation at step >= 7
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 6: State of residence */}
        {state.step === 6 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">What US state do you live in?</h1>
            <p className="text-gray-400 text-sm">
              Some prediction market venues are restricted by state law. We use this to
              automatically disable unavailable strategies. Optional — skip if outside the US.
            </p>
            <select
              value={state.stateOfResidence ?? ''}
              onChange={e => setState(s => ({ ...s, stateOfResidence: e.target.value || null }))}
              className="w-full px-4 py-3 rounded-xl border border-gray-700 bg-gray-900 text-white focus:border-white outline-none"
            >
              <option value="">— Select state / Not in US —</option>
              {[
                ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
                ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
                ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],
                ['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],
                ['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
                ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
                ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
                ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
                ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],
                ['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
                ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
                ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],
                ['WI','Wisconsin'],['WY','Wyoming'],
              ].map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <button
              onClick={() => setState(s => ({ ...s, step: 7 }))}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-100 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Final: Recommendation */}
        {state.step >= 7 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Your recommended profile</h1>
            <div className="rounded-2xl border border-white/20 bg-gray-900 p-6 space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-widest">Recommended</p>
              <p className="text-3xl font-bold text-green-400">{PROFILE_LABELS[recommended]}</p>
              <p className="text-gray-300 text-sm">{PROFILE_DESCRIPTIONS[recommended]}</p>
              {state.excludedAssets.size > 0 && (
                <p className="text-xs text-gray-500">
                  Excluded: {Array.from(state.excludedAssets).join(', ')}
                </p>
              )}
              {state.autoExecuteUsd != null && state.autoExecuteUsd > 0 && (
                <p className="text-xs text-gray-500">
                  Auto-execute up to ${state.autoExecuteUsd.toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="w-full py-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving&#8230;' : 'Confirm and continue'}
            </button>
            <button
              onClick={() => setState(s => ({ ...s, step: 1, adjustment: 0, baseIndex: 2, stateOfResidence: null }))}
              className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
