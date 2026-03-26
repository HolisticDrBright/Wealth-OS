'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import type { Asset, Transaction } from '@/lib/types'
import { ChevronDown, ChevronUp, Heart, TrendingUp, Shield, Target, Wallet, PieChart } from 'lucide-react'

interface Props {
  assets: Asset[]
  transactions: Transaction[]
  savingsRate: number
  totalAssets: number
}

interface ScoreFactor {
  label: string
  score: number
  max: number
  description: string
  tip: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-indigo-400'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-indigo-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 50) return 'Fair'
  if (score >= 30) return 'Needs Work'
  return 'Critical'
}

function GaugeArc({ score }: { score: number }) {
  // SVG semi-circle gauge
  const r = 54
  const cx = 70
  const cy = 70
  const startAngle = 180
  const endAngle = 180 + (score / 100) * 180
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy + r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy + r * Math.sin(toRad(endAngle))
  const largeArc = endAngle - startAngle > 180 ? 1 : 0

  const trackX1 = cx + r * Math.cos(toRad(180))
  const trackY1 = cy + r * Math.sin(toRad(180))
  const trackX2 = cx + r * Math.cos(toRad(360))
  const trackY2 = cy + r * Math.sin(toRad(360))

  const fillColor =
    score >= 80 ? '#10b981' : score >= 60 ? '#6366f1' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <svg viewBox="0 0 140 80" className="w-48 mx-auto">
      {/* Track */}
      <path
        d={`M ${trackX1} ${trackY1} A ${r} ${r} 0 0 1 ${trackX2} ${trackY2}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Fill */}
      {score > 0 && (
        <path
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none"
          stroke={fillColor}
          strokeWidth="10"
          strokeLinecap="round"
        />
      )}
      {/* Score text */}
      <text x={cx} y={cy - 4} textAnchor="middle" className="fill-white" fontSize="24" fontWeight="bold" fill="white">
        {score}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="#6b7280">
        out of 100
      </text>
    </svg>
  )
}

export function HealthScore({ assets, transactions, savingsRate, totalAssets }: Props) {
  const [expanded, setExpanded] = useState(false)

  const factors = useMemo((): ScoreFactor[] => {
    // 1. Savings rate (25 pts)
    const savingsScore = Math.min(25, Math.round((savingsRate / 20) * 25))
    const savingsTip =
      savingsRate >= 20
        ? 'Great savings rate! Keep it up.'
        : savingsRate >= 10
        ? 'Aim for 20%+ to build wealth faster.'
        : 'Try to cut expenses to increase your savings rate.'

    // 2. Emergency fund (20 pts): 3+ months of expenses in cash
    const monthlyExpenses = transactions
      .filter(t => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0)
    const cashAssets = assets
      .filter(a => a.category === 'cash')
      .reduce((s, a) => s + a.current_value, 0)
    const monthsCovered = monthlyExpenses > 0 ? cashAssets / monthlyExpenses : 0
    const emergencyScore = Math.min(20, Math.round((monthsCovered / 6) * 20))
    const emergencyTip =
      monthsCovered >= 6
        ? 'Excellent emergency fund coverage.'
        : monthsCovered >= 3
        ? 'Good start — aim for 6 months of expenses.'
        : `You have ${monthsCovered.toFixed(1)} months covered. Build up to 3–6 months.`

    // 3. Diversification (20 pts): multiple asset categories
    const categories = new Set(assets.map(a => a.category)).size
    const diversScore = Math.min(20, categories * 4)
    const diversTip =
      categories >= 4
        ? 'Well diversified across asset classes.'
        : categories >= 2
        ? 'Consider adding more asset types (bonds, real estate, etc.).'
        : 'Diversify into multiple asset classes to reduce risk.'

    // 4. Net worth growth (20 pts): based on total assets
    const assetScore = Math.min(20,
      totalAssets >= 500000 ? 20 :
      totalAssets >= 250000 ? 16 :
      totalAssets >= 100000 ? 12 :
      totalAssets >= 50000 ? 8 :
      totalAssets >= 10000 ? 4 : 2
    )
    const assetTip =
      totalAssets >= 500000 ? 'Excellent asset base — focus on preservation and growth.'
        : totalAssets >= 100000 ? 'Strong foundation — continue building.'
        : 'Focus on growing your asset base through consistent investing.'

    // 5. Goal tracking (15 pts): has financial goals set
    const hasGoals = transactions.length > 0
    const goalScore = hasGoals ? 15 : 0
    const goalTip = hasGoals
      ? 'Good — you have financial goals to work toward.'
      : 'Set financial goals in the Planning section to score points here.'

    return [
      {
        label: 'Savings Rate',
        score: savingsScore,
        max: 25,
        description: `${savingsRate.toFixed(1)}% of income saved`,
        tip: savingsTip,
        icon: Wallet,
        color: 'text-emerald-400',
      },
      {
        label: 'Emergency Fund',
        score: emergencyScore,
        max: 20,
        description: `${monthsCovered.toFixed(1)} months covered (${formatCurrency(cashAssets)} cash)`,
        tip: emergencyTip,
        icon: Shield,
        color: 'text-blue-400',
      },
      {
        label: 'Diversification',
        score: diversScore,
        max: 20,
        description: `${categories} asset ${categories === 1 ? 'category' : 'categories'} held`,
        tip: diversTip,
        icon: PieChart,
        color: 'text-purple-400',
      },
      {
        label: 'Asset Base',
        score: assetScore,
        max: 20,
        description: `${formatCurrency(totalAssets)} total assets`,
        tip: assetTip,
        icon: TrendingUp,
        color: 'text-indigo-400',
      },
      {
        label: 'Goal Planning',
        score: goalScore,
        max: 15,
        description: hasGoals ? 'Goals are being tracked' : 'No goals set yet',
        tip: goalTip,
        icon: Target,
        color: 'text-amber-400',
      },
    ]
  }, [assets, transactions, savingsRate, totalAssets])

  const totalScore = factors.reduce((s, f) => s + f.score, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-400" />
              Financial Health Score
            </CardTitle>
            <CardDescription>Based on your savings, assets, and habits</CardDescription>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors rounded-lg px-3 py-1.5 hover:bg-white/5"
          >
            {expanded ? 'Less detail' : 'See breakdown'}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Gauge */}
          <div className="shrink-0 text-center">
            <GaugeArc score={totalScore} />
            <p className={`-mt-2 text-sm font-semibold ${scoreColor(totalScore)}`}>
              {scoreLabel(totalScore)}
            </p>
          </div>

          {/* Factor bars */}
          <div className="flex-1 w-full space-y-3">
            {factors.map(f => (
              <div key={f.label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <f.icon className={`h-3.5 w-3.5 ${f.color}`} />
                    <span className="text-xs font-medium text-gray-300">{f.label}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    <span className={`font-semibold ${scoreColor((f.score / f.max) * 100)}`}>{f.score}</span>
                    /{f.max}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${scoreBg((f.score / f.max) * 100)}`}
                    style={{ width: `${(f.score / f.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expanded breakdown */}
        {expanded && (
          <div className="mt-6 pt-5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {factors.map(f => (
              <div key={f.label} className="rounded-xl bg-white/5 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <f.icon className={`h-4 w-4 ${f.color}`} />
                  <p className="text-xs font-semibold text-white">{f.label}</p>
                  <span className={`ml-auto text-xs font-bold ${scoreColor((f.score / f.max) * 100)}`}>
                    {f.score}/{f.max}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{f.description}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{f.tip}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
