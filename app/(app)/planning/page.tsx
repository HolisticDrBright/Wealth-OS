'use client'

import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { formatCurrency } from '@/lib/utils'
import { mockGoals } from '@/lib/mock-data'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Target, Home, GraduationCap, Shield, Plane, Star } from 'lucide-react'

const goalIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  retirement: Star,
  home: Home,
  education: GraduationCap,
  emergency: Shield,
  vacation: Plane,
  other: Target,
}

const goalColors: Record<string, string> = {
  retirement: 'text-indigo-400 bg-indigo-500/10',
  home: 'text-emerald-400 bg-emerald-500/10',
  education: 'text-purple-400 bg-purple-500/10',
  emergency: 'text-amber-400 bg-amber-500/10',
  vacation: 'text-pink-400 bg-pink-500/10',
  other: 'text-gray-400 bg-gray-500/10',
}

const goalBarColors: Record<string, string> = {
  retirement: 'bg-indigo-500',
  home: 'bg-emerald-500',
  education: 'bg-purple-500',
  emergency: 'bg-amber-500',
  vacation: 'bg-pink-500',
  other: 'bg-gray-500',
}

// Retirement projection data (compound growth at 7% annually)
function buildRetirementProjection() {
  const data = []
  let value = 125000
  const startYear = 2026
  const endYear = 2046
  for (let y = startYear; y <= endYear; y++) {
    value = value * 1.07 + 23500 // 7% growth + annual contribution
    data.push({ year: String(y), conservative: Math.round(value * 0.85), moderate: Math.round(value), aggressive: Math.round(value * 1.15) })
  }
  return data
}

const retirementData = buildRetirementProjection()

export default function PlanningPage() {
  const totalGoalTarget = mockGoals.reduce((s, g) => s + g.target_amount, 0)
  const totalGoalCurrent = mockGoals.reduce((s, g) => s + g.current_amount, 0)
  const overallProgress = (totalGoalCurrent / totalGoalTarget) * 100

  return (
    <div>
      <Topbar title="Wealth Planning" subtitle="Goals, projections, and milestones" />

      <div className="p-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Active Goals</p>
            <p className="mt-2 text-2xl font-bold text-white">{mockGoals.length}</p>
            <p className="mt-1 text-xs text-gray-500">Across {new Set(mockGoals.map(g => g.category)).size} categories</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Targeted</p>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(totalGoalTarget)}</p>
            <div className="mt-2">
              <Progress value={totalGoalCurrent} max={totalGoalTarget} />
              <p className="mt-1 text-xs text-gray-500">{formatCurrency(totalGoalCurrent)} saved ({overallProgress.toFixed(0)}%)</p>
            </div>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Next Milestone</p>
            <p className="mt-2 text-base font-bold text-white">Emergency Fund</p>
            <p className="mt-1 text-xs text-gray-500">80% complete · Due Dec 2026</p>
            <Progress value={40000} max={50000} barClassName="bg-amber-500" className="mt-2" />
          </Card>
        </div>

        {/* Retirement Projection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle>Retirement Projection</CardTitle>
                <CardDescription>Portfolio growth to 2046 — 3 scenarios</CardDescription>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-indigo-300" />
                  <span className="text-gray-400">Conservative (6%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  <span className="text-gray-400">Moderate (7%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-purple-400" />
                  <span className="text-gray-400">Aggressive (8%)</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={retirementData}>
                <defs>
                  <linearGradient id="aggressiveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="moderateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="conservativeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="year" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  formatter={(value) => [formatCurrency(Number(value)), '']}
                />
                <Area type="monotone" dataKey="aggressive" stroke="#a855f7" strokeWidth={1.5} fill="url(#aggressiveGrad)" name="Aggressive" />
                <Area type="monotone" dataKey="moderate" stroke="#6366f1" strokeWidth={2} fill="url(#moderateGrad)" name="Moderate" />
                <Area type="monotone" dataKey="conservative" stroke="#818cf8" strokeWidth={1.5} fill="url(#conservativeGrad)" name="Conservative" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Goals Grid */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Financial Goals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mockGoals.map((goal) => {
              const Icon = goalIcons[goal.category]
              const colors = goalColors[goal.category]
              const barColor = goalBarColors[goal.category]
              const pct = (goal.current_amount / goal.target_amount) * 100
              const remaining = goal.target_amount - goal.current_amount
              const targetDate = new Date(goal.target_date)
              const monthsLeft = Math.max(0, Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)))
              const monthlyNeeded = monthsLeft > 0 ? remaining / monthsLeft : 0

              return (
                <Card key={goal.id}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">{goal.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{goal.category}</p>
                      </div>
                    </div>
                    <Badge variant={pct >= 100 ? 'success' : pct >= 75 ? 'info' : 'default'}>
                      {pct.toFixed(0)}%
                    </Badge>
                  </div>

                  <Progress value={goal.current_amount} max={goal.target_amount} barClassName={barColor} />

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Saved</p>
                      <p className="text-sm font-semibold text-white">{formatCurrency(goal.current_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Target</p>
                      <p className="text-sm font-semibold text-white">{formatCurrency(goal.target_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Target Date</p>
                      <p className="text-sm font-semibold text-white">{targetDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Monthly Needed</p>
                      <p className="text-sm font-semibold text-indigo-400">{formatCurrency(monthlyNeeded)}</p>
                    </div>
                  </div>

                  {goal.notes && (
                    <p className="mt-3 text-xs text-gray-600 border-t border-white/5 pt-3">{goal.notes}</p>
                  )}
                </Card>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
