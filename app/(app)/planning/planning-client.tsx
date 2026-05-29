'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { GoalForm } from '@/components/forms/goal-form'
import { formatCurrency } from '@/lib/utils'
import { deleteGoal } from '@/lib/actions/goals'
import type { Goal } from '@/lib/types'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Target, Home, GraduationCap, Shield, Plane, Star, Plus, Pencil, Trash2, Info } from 'lucide-react'

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

function buildRetirementProjection(startValue: number) {
  const data = []
  let value = startValue || 125000
  const startYear = new Date().getFullYear()
  for (let y = startYear; y <= startYear + 20; y++) {
    value = value * 1.07 + 23500
    data.push({
      year: String(y),
      conservative: Math.round(value * 0.85),
      moderate: Math.round(value),
      aggressive: Math.round(value * 1.15),
    })
  }
  return data
}

interface Props {
  goals: Goal[]
  isDemo: boolean
}

export function PlanningClient({ goals: initialGoals, isDemo }: Props) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals)
  const [showForm, setShowForm] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [isPending, startTransition] = useTransition()
  // Read the clock once at mount for goal countdown math (preserves prior behavior).
  const [now] = useState(() => Date.now())

  const retirementGoal = goals.find(g => g.category === 'retirement')
  const retirementData = buildRetirementProjection(retirementGoal?.current_amount ?? 125000)

  const totalGoalTarget = goals.reduce((s, g) => s + g.target_amount, 0)
  const totalGoalCurrent = goals.reduce((s, g) => s + g.current_amount, 0)
  const overallProgress = totalGoalTarget > 0 ? (totalGoalCurrent / totalGoalTarget) * 100 : 0

  const nextGoal = goals
    .filter(g => g.current_amount < g.target_amount && g.target_date)
    .sort((a, b) => new Date(a.target_date!).getTime() - new Date(b.target_date!).getTime())[0]

  function handleDelete(id: string) {
    if (!confirm('Delete this goal?')) return
    startTransition(async () => {
      const result = await deleteGoal(id)
      if (!result.error) {
        setGoals(prev => prev.filter(g => g.id !== id))
      }
    })
  }

  function handleFormClose() {
    setShowForm(false)
    setEditingGoal(null)
  }

  return (
    <div className="p-6 space-y-6">
      {isDemo && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            Showing <strong className="text-indigo-400">demo data</strong>. Add your real financial goals to track progress.
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Active Goals</p>
          <p className="mt-2 text-2xl font-bold text-white">{goals.length}</p>
          <p className="mt-1 text-xs text-gray-500">
            {new Set(goals.map(g => g.category)).size} categories
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Targeted</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(totalGoalTarget)}</p>
          <div className="mt-2">
            <Progress value={totalGoalCurrent} max={totalGoalTarget || 1} />
            <p className="mt-1 text-xs text-gray-500">
              {formatCurrency(totalGoalCurrent)} saved ({overallProgress.toFixed(0)}%)
            </p>
          </div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Next Deadline</p>
          {nextGoal ? (
            <>
              <p className="mt-2 text-base font-bold text-white">{nextGoal.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {((nextGoal.current_amount / nextGoal.target_amount) * 100).toFixed(0)}% complete ·{' '}
                {nextGoal.target_date && new Date(nextGoal.target_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </p>
              <Progress
                value={nextGoal.current_amount}
                max={nextGoal.target_amount}
                barClassName="bg-amber-500"
                className="mt-2"
              />
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">No upcoming deadlines</p>
          )}
        </Card>
      </div>

      {/* Retirement Projection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Retirement Projection</CardTitle>
              <CardDescription>Portfolio growth over 20 years — 3 scenarios</CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {[
                { label: 'Conservative (6%)', color: '#818cf8' },
                { label: 'Moderate (7%)', color: '#6366f1' },
                { label: 'Aggressive (8%)', color: '#a855f7' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-gray-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={retirementData}>
              <defs>
                {[
                  { id: 'aggressiveGrad', color: '#a855f7' },
                  { id: 'moderateGrad', color: '#6366f1' },
                  { id: 'conservativeGrad', color: '#818cf8' },
                ].map(({ id, color }) => (
                  <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Financial Goals</h2>
          <Button size="sm" onClick={() => { setEditingGoal(null); setShowForm(true) }}>
            <Plus className="h-4 w-4" /> Add Goal
          </Button>
        </div>

        {goals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
            <Target className="h-10 w-10 text-gray-600 mx-auto mb-4" />
            <p className="text-sm font-medium text-white mb-1">No goals yet</p>
            <p className="text-xs text-gray-500 mb-4">Set your first financial goal to start tracking progress</p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Add Your First Goal
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {goals.map((goal) => {
              const Icon = goalIcons[goal.category]
              const colors = goalColors[goal.category]
              const barColor = goalBarColors[goal.category]
              const pct = goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0
              const remaining = goal.target_amount - goal.current_amount
              const targetDate = goal.target_date ? new Date(goal.target_date) : null
              const monthsLeft = targetDate
                ? Math.max(0, Math.ceil((targetDate.getTime() - now) / (1000 * 60 * 60 * 24 * 30)))
                : null
              const monthlyNeeded = monthsLeft && monthsLeft > 0 ? remaining / monthsLeft : null

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
                    <div className="flex items-center gap-1">
                      <Badge variant={pct >= 100 ? 'success' : pct >= 75 ? 'info' : 'default'}>
                        {pct.toFixed(0)}%
                      </Badge>
                      <button
                        onClick={() => { setEditingGoal(goal); setShowForm(true) }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(goal.id)}
                        disabled={isPending}
                        className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <Progress value={goal.current_amount} max={goal.target_amount || 1} barClassName={barColor} />

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Saved</p>
                      <p className="text-sm font-semibold text-white">{formatCurrency(goal.current_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Target</p>
                      <p className="text-sm font-semibold text-white">{formatCurrency(goal.target_amount)}</p>
                    </div>
                    {targetDate && (
                      <div>
                        <p className="text-xs text-gray-500">Target Date</p>
                        <p className="text-sm font-semibold text-white">
                          {targetDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {monthlyNeeded !== null && (
                      <div>
                        <p className="text-xs text-gray-500">Monthly Needed</p>
                        <p className="text-sm font-semibold text-indigo-400">{formatCurrency(monthlyNeeded)}</p>
                      </div>
                    )}
                  </div>

                  {goal.notes && (
                    <p className="mt-3 text-xs text-gray-600 border-t border-white/5 pt-3">{goal.notes}</p>
                  )}
                </Card>
              )
            })}

            <button
              onClick={() => { setEditingGoal(null); setShowForm(true) }}
              className="rounded-xl border border-dashed border-white/20 p-6 text-center hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-colors group"
            >
              <Plus className="h-5 w-5 text-gray-600 group-hover:text-indigo-400 mx-auto mb-2 transition-colors" />
              <p className="text-xs text-gray-600 group-hover:text-indigo-400 transition-colors">Add New Goal</p>
            </button>
          </div>
        )}
      </div>

      <GoalForm open={showForm} onClose={handleFormClose} goal={editingGoal} />
    </div>
  )
}
