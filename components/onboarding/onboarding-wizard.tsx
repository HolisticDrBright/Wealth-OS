'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createAsset } from '@/lib/actions/assets'
import { createTransaction } from '@/lib/actions/transactions'
import { createGoal } from '@/lib/actions/goals'
import {
  Sparkles,
  DollarSign,
  TrendingUp,
  Target,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
} from 'lucide-react'

const STORAGE_KEY = 'wealth-os-onboarding-done'

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'income', label: 'Income' },
  { id: 'asset', label: 'Assets' },
  { id: 'goal', label: 'Goals' },
  { id: 'done', label: 'Done' },
]

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {STEPS.map((s, i) => (
        <div
          key={s.id}
          className={`rounded-full transition-all duration-300 ${
            i < current
              ? 'h-2 w-2 bg-indigo-500'
              : i === current
              ? 'h-2 w-6 bg-indigo-500'
              : 'h-2 w-2 bg-white/10'
          }`}
        />
      ))}
    </div>
  )
}

// Step 0: Welcome
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-500/20 mx-auto">
        <Sparkles className="h-10 w-10 text-indigo-400" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">Welcome to Wealth OS</h2>
        <p className="mt-2 text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">
          Let&apos;s set up your financial dashboard in just 3 quick steps. It only takes 2 minutes.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          { icon: DollarSign, label: 'Track income' },
          { icon: TrendingUp, label: 'Log assets' },
          { icon: Target, label: 'Set goals' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="rounded-xl bg-white/5 p-3 space-y-2">
            <Icon className="h-5 w-5 text-indigo-400 mx-auto" />
            <p className="text-gray-400">{label}</p>
          </div>
        ))}
      </div>
      <Button onClick={onNext} className="w-full">
        Get Started <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
      <button
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, 'true')
          window.location.reload()
        }}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        Skip setup — I&apos;ll add data manually
      </button>
    </div>
  )
}

// Step 1: Income
function IncomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = await createTransaction(fd)
      if (result && 'error' in result && result.error) {
        setError(result.error)
      } else {
        onNext()
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 mx-auto mb-3">
          <DollarSign className="h-6 w-6 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Add your income</h2>
        <p className="mt-1 text-sm text-gray-400">What&apos;s your primary source of income?</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="income" />
        <input type="hidden" name="date" value={new Date().toISOString().split('T')[0]} />
        <Input label="Description" name="description" placeholder="e.g. Monthly Salary" required />
        <Input label="Monthly amount ($)" name="amount" type="number" min="1" step="0.01" placeholder="5000" required />
        <Select
          label="Category"
          name="category"
          options={[
            { value: 'salary', label: 'Salary' },
            { value: 'freelance', label: 'Freelance' },
            { value: 'business', label: 'Business' },
            { value: 'investments', label: 'Investments' },
            { value: 'rental', label: 'Rental Income' },
            { value: 'other', label: 'Other' },
          ]}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button type="submit" disabled={isPending} className="flex-1">
            {isPending ? 'Saving...' : 'Continue'}
            {!isPending && <ChevronRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>
      </form>
    </div>
  )
}

// Step 2: Asset
function AssetStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = await createAsset(fd)
      if (result && 'error' in result && result.error) {
        setError(result.error)
      } else {
        onNext()
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 mx-auto mb-3">
          <TrendingUp className="h-6 w-6 text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Add your first asset</h2>
        <p className="mt-1 text-sm text-gray-400">Savings, investments, real estate — anything you own</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Asset name" name="name" placeholder="e.g. Emergency Fund, Apple Stock" required />
        <Select
          label="Category"
          name="category"
          options={[
            { value: 'cash', label: 'Cash / Savings' },
            { value: 'stock', label: 'Stocks / ETFs' },
            { value: 'crypto', label: 'Crypto' },
            { value: 'real_estate', label: 'Real Estate' },
            { value: 'bond', label: 'Bonds' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Input label="Current value ($)" name="current_value" type="number" min="0" step="0.01" placeholder="10000" required />
        <Input label="Ticker symbol (optional)" name="symbol" placeholder="e.g. AAPL, BTC" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button type="submit" disabled={isPending} className="flex-1">
            {isPending ? 'Saving...' : 'Continue'}
            {!isPending && <ChevronRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>
      </form>
    </div>
  )
}

// Step 3: Goal
function GoalStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      const result = await createGoal(fd)
      if (result && 'error' in result && result.error) {
        setError(result.error)
      } else {
        onNext()
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/20 mx-auto mb-3">
          <Target className="h-6 w-6 text-purple-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Set a financial goal</h2>
        <p className="mt-1 text-sm text-gray-400">What are you working towards?</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="current_amount" value="0" />
        <Input label="Goal name" name="name" placeholder="e.g. Emergency Fund, House Down Payment" required />
        <Select
          label="Category"
          name="category"
          options={[
            { value: 'emergency', label: 'Emergency Fund' },
            { value: 'retirement', label: 'Retirement' },
            { value: 'home', label: 'Home Purchase' },
            { value: 'education', label: 'Education' },
            { value: 'vacation', label: 'Vacation' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Input label="Target amount ($)" name="target_amount" type="number" min="1" step="0.01" placeholder="25000" required />
        <Input label="Target date" name="target_date" type="date" required />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button type="submit" disabled={isPending} className="flex-1">
            {isPending ? 'Saving...' : 'Finish Setup'}
            {!isPending && <ChevronRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>
      </form>
    </div>
  )
}

// Step 4: Done
function DoneStep() {
  const router = useRouter()

  function finish() {
    localStorage.setItem(STORAGE_KEY, 'true')
    router.refresh()
  }

  return (
    <div className="text-center space-y-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/20 mx-auto">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">You&apos;re all set!</h2>
        <p className="mt-2 text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">
          Your financial data is saved. Your dashboard will now show your real numbers.
        </p>
      </div>
      <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-left space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">What to explore next</p>
        {[
          'Portfolio → Add more assets & track live prices',
          'Budget → Log expenses and set monthly limits',
          'Planning → Track goal progress',
          'Tax Advisor → Get AI-powered tax strategies',
        ].map(tip => (
          <div key={tip} className="flex items-start gap-2 text-sm text-gray-300">
            <ChevronRight className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
            {tip}
          </div>
        ))}
      </div>
      <Button onClick={finish} className="w-full">
        View My Dashboard <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  )
}

export function OnboardingWizard() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // localStorage is only available on the client, so this read must stay in an
    // effect (it cannot be a lazy useState initializer without breaking SSR).
    // Defer setVisible off the synchronous effect body to avoid a cascading
    // synchronous setState; the visibility flip still happens right after mount.
    const done = localStorage.getItem(STORAGE_KEY)
    if (!done) queueMicrotask(() => setVisible(true))
  }, [])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1117] shadow-2xl p-8">
        <StepDots current={step} />

        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && (
          <IncomeStep
            onNext={() => setStep(2)}
            onSkip={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <AssetStep
            onNext={() => setStep(3)}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <GoalStep
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
          />
        )}
        {step === 4 && <DoneStep />}
      </div>
    </div>
  )
}
