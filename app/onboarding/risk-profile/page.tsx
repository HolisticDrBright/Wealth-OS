'use client'

/**
 * Goal-first onboarding wizard (Phase 2.2).
 *
 * State machine:
 *   step 1: what the money is for   (goal_type + default name)
 *   step 2: goal name, target amount and date
 *   step 3: monthly contribution
 *   step 4: investment goal   (A-E maps to base profile index 0-4)
 *   step 5: drawdown reaction (-1 / 0 / +1 adjustment)
 *   step 6: time horizon      (may cap profile)
 *   step 7: asset preferences (optional exclusions)
 *   step 8: time commitment   (optional)
 *   step 9: state of residence
 *   final:  recommendation + confirm (saves goal + profile, gates /dashboard)
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveOnboardedProfile, saveStateOfResidence } from '@/lib/actions/risk-profile'
import { saveOnboardingGoal } from '@/lib/actions/onboarding'
import { setUiMode } from '@/lib/actions/ui-prefs'
import type { ProfileKey } from '@/lib/strategies/profile-params'
import type { HouseholdGoal } from '@/lib/types'

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

const GOAL_PURPOSES: Array<{ label: string; goalType: HouseholdGoal['goal_type']; defaultName: string }> = [
  { label: 'A home',                goalType: 'home',       defaultName: 'Home down payment' },
  { label: 'Retirement',            goalType: 'retirement', defaultName: 'Retirement' },
  { label: 'Education',             goalType: 'education',  defaultName: 'Education fund' },
  { label: 'A safety cushion',      goalType: 'emergency',  defaultName: 'Safety cushion' },
  { label: 'Growing my wealth',     goalType: 'general',    defaultName: 'Grow my wealth' },
]

interface WizardState {
  step: number
  // Goal (steps 1-3)
  goalType: HouseholdGoal['goal_type']
  goalName: string
  targetAmountUsd: string     // text inputs keep strings; parsed on save
  targetDate: string          // yyyy-mm-dd or ''
  monthlyContributionUsd: string
  // Risk (steps 4-9)
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

const TOTAL_SEGMENTS = 9

export default function RiskProfileWizard() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<WizardState>({
    step: 1,
    goalType: 'general',
    goalName: '',
    targetAmountUsd: '',
    targetDate: '',
    monthlyContributionUsd: '',
    baseIndex: 2,
    adjustment: 0,
    excludedAssets: new Set(),
    autoExecuteUsd: null,
    stateOfResidence: null,
  })
  const [confirmed, setConfirmed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const recommended = computeRecommendation(state)

  function next() {
    setState(s => ({ ...s, step: s.step + 1 }))
  }

  function pickPurpose(p: typeof GOAL_PURPOSES[number]) {
    setState(s => ({ ...s, goalType: p.goalType, goalName: s.goalName || p.defaultName, step: 2 }))
  }

  const amountValid = Number(state.targetAmountUsd) > 0
  const contributionValid = state.monthlyContributionUsd !== '' && Number(state.monthlyContributionUsd) >= 0

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
    setSaveError(null)
    startTransition(async () => {
      const assetClassOverrides = Object.fromEntries(
        ASSET_OPTIONS.map(a => [a.key, !state.excludedAssets.has(a.key)])
      )
      void assetClassOverrides // will be saved separately after onboarding

      // Goal first — if it fails, surface the error and do NOT mark onboarded.
      const goal = await saveOnboardingGoal({
        name: state.goalName,
        goalType: state.goalType,
        targetAmountUsd: Number(state.targetAmountUsd),
        targetDate: state.targetDate || null,
        monthlyContributionUsd: Number(state.monthlyContributionUsd || 0),
      })
      if (!goal.ok) {
        setSaveError(goal.error ?? 'Could not save your goal')
        return
      }

      const [profileRes] = await Promise.all([
        saveOnboardedProfile(recommended, state.autoExecuteUsd ?? undefined),
        state.stateOfResidence ? saveStateOfResidence(state.stateOfResidence) : Promise.resolve({}),
      ])
      if (profileRes?.error) {
        setSaveError(profileRes.error)
        return
      }
      // New users start in Simple mode (existing users keep Pro — their
      // ui_mode is unset and reads as 'pro').
      await setUiMode('simple').catch(() => ({ ok: false }))
      setConfirmed(true)
      setTimeout(() => router.push('/dashboard'), 1200)
    })
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl">&#10003;</div>
          <p className="text-white text-xl font-semibold">You&#8217;re set up</p>
          <p className="text-text-1 text-sm">Taking you to your dashboard&#8230;</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-8">
        {/* Progress */}
        <div className="flex gap-2">
          {Array.from({ length: TOTAL_SEGMENTS }, (_, i) => i + 1).map(n => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full ${
                n < state.step ? 'bg-green-500' : n === state.step ? 'bg-white' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Step 1: What is the money for? */}
        {state.step === 1 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">What is this money for?</h1>
            <p className="text-text-1 text-sm">
              Everything Wealth OS does is aimed at a goal you choose. You can add more goals later.
            </p>
            <div className="space-y-3">
              {GOAL_PURPOSES.map(opt => (
                <button
                  key={opt.goalType}
                  onClick={() => pickPurpose(opt)}
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Name, target amount, target date */}
        {state.step === 2 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">How much, and by when?</h1>
            <div className="space-y-4">
              <div>
                <label htmlFor="goal-name" className="mb-1.5 block text-sm text-text-1">Goal name</label>
                <input
                  id="goal-name"
                  type="text"
                  value={state.goalName}
                  onChange={e => setState(s => ({ ...s, goalName: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-700 bg-gray-900 text-white focus:border-white outline-none"
                />
              </div>
              <div>
                <label htmlFor="goal-amount" className="mb-1.5 block text-sm text-text-1">Target amount (USD)</label>
                <input
                  id="goal-amount"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="80000"
                  value={state.targetAmountUsd}
                  onChange={e => setState(s => ({ ...s, targetAmountUsd: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-700 bg-gray-900 text-white focus:border-white outline-none"
                />
              </div>
              <div>
                <label htmlFor="goal-date" className="mb-1.5 block text-sm text-text-1">
                  Target date <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  id="goal-date"
                  type="date"
                  value={state.targetDate}
                  onChange={e => setState(s => ({ ...s, targetDate: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-700 bg-gray-900 text-white focus:border-white outline-none"
                />
              </div>
            </div>
            <button
              onClick={next}
              disabled={!amountValid || !state.goalName.trim()}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-100 disabled:opacity-40 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 3: Monthly contribution */}
        {state.step === 3 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">How much can you put in each month?</h1>
            <p className="text-text-1 text-sm">
              A steady monthly amount matters more than picking perfect investments. $0 is fine — you can change it anytime.
            </p>
            <div>
              <label htmlFor="goal-monthly" className="mb-1.5 block text-sm text-text-1">Monthly contribution (USD)</label>
              <input
                id="goal-monthly"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="500"
                value={state.monthlyContributionUsd}
                onChange={e => setState(s => ({ ...s, monthlyContributionUsd: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-gray-700 bg-gray-900 text-white focus:border-white outline-none"
              />
            </div>
            <button
              onClick={next}
              disabled={!contributionValid}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-100 disabled:opacity-40 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 4: Investment goal (risk) */}
        {state.step === 4 && (
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

        {/* Step 5: Drawdown reaction */}
        {state.step === 5 && (
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

        {/* Step 6: Time horizon */}
        {state.step === 6 && (
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

        {/* Step 7: Asset preferences */}
        {state.step === 7 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Any asset classes you want to exclude?</h1>
            <p className="text-text-1 text-sm">Optional. You can change this later.</p>
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

        {/* Step 8: Time commitment */}
        {state.step === 8 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Auto-execute trades under a threshold?</h1>
            <p className="text-text-1 text-sm">
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
                    setState(s => ({ ...s, autoExecuteUsd: opt.value || null, step: 9 }))
                  }}
                  className="w-full text-left px-5 py-4 rounded-xl border border-gray-700 hover:border-white hover:bg-gray-900 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 9: State of residence */}
        {state.step === 9 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">What US state do you live in?</h1>
            <p className="text-text-1 text-sm">
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
              onClick={() => setState(s => ({ ...s, step: 10 }))}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-100 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Final: Recommendation */}
        {state.step >= 10 && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold">Your recommended profile</h1>
            <div className="rounded-2xl border border-white/20 bg-gray-900 p-6 space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-widest">Recommended</p>
              <p className="text-3xl font-bold text-green-400">{PROFILE_LABELS[recommended]}</p>
              <p className="text-gray-300 text-sm">{PROFILE_DESCRIPTIONS[recommended]}</p>
              <p className="text-xs text-gray-500">
                Goal: {state.goalName} — ${Number(state.targetAmountUsd).toLocaleString()}
                {state.targetDate ? ` by ${state.targetDate}` : ''}
                {Number(state.monthlyContributionUsd) > 0 ? ` · $${Number(state.monthlyContributionUsd).toLocaleString()}/mo` : ''}
              </p>
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
            {saveError && (
              <p className="rounded-xl border border-red-600/40 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                {saveError}
              </p>
            )}
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="w-full py-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving&#8230;' : 'Confirm and continue'}
            </button>
            <button
              onClick={() => setState(s => ({ ...s, step: 1, adjustment: 0, baseIndex: 2, stateOfResidence: null }))}
              className="w-full py-3 text-text-1 text-sm hover:text-white transition-colors"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
