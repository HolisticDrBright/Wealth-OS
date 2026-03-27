'use client'

import { useState, useTransition } from 'react'
import { createHousehold, updateHousehold, addMember, removeMember, addHouseholdGoal, updateHouseholdGoal } from '@/lib/actions/household'
import type { Household, HouseholdMember, HouseholdGoal } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Home, Users, Target, Plus, Trash2, CheckCircle, Edit3, X } from 'lucide-react'

interface Props { initialHousehold: Household | null }

const ROLE_COLORS: Record<string, string> = {
  owner: 'text-indigo-400 bg-indigo-400/10',
  spouse: 'text-pink-400 bg-pink-400/10',
  dependent: 'text-blue-400 bg-blue-400/10',
  trustee: 'text-yellow-400 bg-yellow-400/10',
  beneficiary: 'text-green-400 bg-green-400/10',
  advisor: 'text-orange-400 bg-orange-400/10',
}

const GOAL_TYPE_ICONS: Record<string, string> = {
  retirement: '🏖️', education: '🎓', home: '🏠', estate: '📜',
  trust: '🔒', charitable: '💝', emergency: '🚨', other: '📌', general: '🎯',
}

export function HouseholdClient({ initialHousehold }: Props) {
  const [household, setHousehold] = useState(initialHousehold)
  const [pending, startTransition] = useTransition()
  const [tab, setTab] = useState<'overview' | 'members' | 'goals'>('overview')

  // Create household form
  const [householdName, setHouseholdName] = useState('')
  const [householdType, setHouseholdType] = useState<Household['household_type']>('family')

  // Add member form
  const [showMemberForm, setShowMemberForm] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberRole, setMemberRole] = useState<HouseholdMember['role']>('spouse')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberBirthYear, setMemberBirthYear] = useState('')
  const [memberNetWorth, setMemberNetWorth] = useState('')

  // Add goal form
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [goalName, setGoalName] = useState('')
  const [goalType, setGoalType] = useState<HouseholdGoal['goal_type']>('general')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [goalNotes, setGoalNotes] = useState('')

  function handleCreateHousehold() {
    if (!householdName.trim()) return
    startTransition(async () => {
      const h = await createHousehold({ name: householdName.trim(), household_type: householdType })
      if (h) setHousehold({ ...h, members: [], goals: [] })
    })
  }

  function handleAddMember() {
    if (!memberName.trim() || !household) return
    startTransition(async () => {
      const m = await addMember(household.id, {
        name: memberName.trim(),
        role: memberRole,
        email: memberEmail || undefined,
        birth_year: memberBirthYear ? Number(memberBirthYear) : undefined,
        net_worth_usd: memberNetWorth ? Number(memberNetWorth) : 0,
      })
      if (m) {
        setHousehold(h => h ? { ...h, members: [...(h.members ?? []), m] } : h)
        setShowMemberForm(false)
        setMemberName('')
        setMemberEmail('')
        setMemberBirthYear('')
        setMemberNetWorth('')
      }
    })
  }

  function handleRemoveMember(id: string) {
    startTransition(async () => {
      await removeMember(id)
      setHousehold(h => h ? { ...h, members: (h.members ?? []).filter(m => m.id !== id) } : h)
    })
  }

  function handleAddGoal() {
    if (!goalName.trim() || !goalTarget || !household) return
    startTransition(async () => {
      const g = await addHouseholdGoal(household.id, {
        name: goalName.trim(),
        goal_type: goalType,
        target_amount_usd: Number(goalTarget),
        target_date: goalDate || undefined,
        notes: goalNotes || undefined,
      })
      if (g) {
        setHousehold(h => h ? { ...h, goals: [...(h.goals ?? []), g] } : h)
        setShowGoalForm(false)
        setGoalName('')
        setGoalTarget('')
        setGoalDate('')
        setGoalNotes('')
      }
    })
  }

  const totalNetWorth = (household?.members ?? []).reduce((s, m) => s + (m.net_worth_usd ?? 0), 0)
  const totalIncome = (household?.members ?? []).reduce((s, m) => s + (m.income_usd ?? 0), 0)
  const totalGoalTarget = (household?.goals ?? []).filter(g => g.status === 'active').reduce((s, g) => s + g.target_amount_usd, 0)
  const totalGoalCurrent = (household?.goals ?? []).filter(g => g.status === 'active').reduce((s, g) => s + g.current_amount_usd, 0)

  if (!household) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Family Office</h1>
          <p className="text-sm text-gray-400 mt-1">Set up your household to manage family finances together</p>
        </div>
        <div className="max-w-md flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="font-semibold text-white">Create Your Household</p>
          <input value={householdName} onChange={e => setHouseholdName(e.target.value)}
            placeholder="e.g. The Smith Family"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
          <select value={householdType} onChange={e => setHouseholdType(e.target.value as Household['household_type'])}
            className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="family">Family</option>
            <option value="couple">Couple</option>
            <option value="individual">Individual</option>
            <option value="trust">Trust</option>
            <option value="foundation">Foundation</option>
          </select>
          <button onClick={handleCreateHousehold} disabled={pending || !householdName.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            Create Household
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Home className="h-6 w-6 text-indigo-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">{household.name}</h1>
          <p className="text-sm text-gray-400 capitalize">{household.household_type} · {(household.members ?? []).length} members</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Household Net Worth</p>
          <p className="text-2xl font-bold text-white mt-1">${totalNetWorth.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Combined Income</p>
          <p className="text-2xl font-bold text-green-400 mt-1">${totalIncome.toLocaleString()}/yr</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Active Goals</p>
          <p className="text-2xl font-bold text-indigo-400 mt-1">{(household.goals ?? []).filter(g => g.status === 'active').length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Goal Progress</p>
          <p className="text-2xl font-bold text-white mt-1">
            {totalGoalTarget > 0 ? `${((totalGoalCurrent / totalGoalTarget) * 100).toFixed(0)}%` : '—'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-px">
        {(['overview', 'members', 'goals'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
              tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-white')}>
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {(household.members ?? []).length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-gray-300 mb-3">Members</p>
              <div className="flex flex-col gap-2">
                {(household.members ?? []).map(m => (
                  <div key={m.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize', ROLE_COLORS[m.role] ?? 'text-gray-400 bg-gray-400/10')}>{m.role}</span>
                      <span className="text-sm text-white">{m.name}</span>
                      {m.birth_year && <span className="text-xs text-gray-500">b. {m.birth_year}</span>}
                    </div>
                    <span className="text-sm font-mono text-gray-300">${(m.net_worth_usd ?? 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(household.goals ?? []).length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-gray-300 mb-3">Goals</p>
              <div className="flex flex-col gap-3">
                {(household.goals ?? []).filter(g => g.status === 'active').map(g => {
                  const pct = g.target_amount_usd > 0 ? Math.min(100, (g.current_amount_usd / g.target_amount_usd) * 100) : 0
                  return (
                    <div key={g.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white flex items-center gap-2">
                          <span>{GOAL_TYPE_ICONS[g.goal_type] ?? '🎯'}</span>
                          {g.name}
                        </span>
                        <span className="text-xs text-gray-400">${g.current_amount_usd.toLocaleString()} / ${g.target_amount_usd.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {(household.estate_plan_notes) && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-sm font-semibold text-yellow-300 mb-2">Estate Plan Notes</p>
              <p className="text-sm text-gray-300">{household.estate_plan_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Members tab */}
      {tab === 'members' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <button onClick={() => setShowMemberForm(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              <Plus className="h-4 w-4" /> Add Member
            </button>
          </div>
          {showMemberForm && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Name</label>
                  <input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Role</label>
                  <select value={memberRole} onChange={e => setMemberRole(e.target.value as HouseholdMember['role'])}
                    className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="spouse">Spouse</option>
                    <option value="dependent">Dependent</option>
                    <option value="trustee">Trustee</option>
                    <option value="beneficiary">Beneficiary</option>
                    <option value="advisor">Advisor</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Birth Year</label>
                  <input type="number" value={memberBirthYear} onChange={e => setMemberBirthYear(e.target.value)} placeholder="1985"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Email</label>
                  <input type="email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="email@example.com"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Net Worth ($)</label>
                  <input type="number" value={memberNetWorth} onChange={e => setMemberNetWorth(e.target.value)} placeholder="250000"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddMember} disabled={pending || !memberName.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Add</button>
                <button onClick={() => setShowMemberForm(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">Cancel</button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {(household.members ?? []).map(m => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-white">{m.name}</p>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize', ROLE_COLORS[m.role] ?? 'text-gray-400 bg-gray-400/10')}>{m.role}</span>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    {m.email && <span>{m.email}</span>}
                    {m.birth_year && <span>Born {m.birth_year}</span>}
                    <span>Net worth: ${(m.net_worth_usd ?? 0).toLocaleString()}</span>
                    {m.income_usd > 0 && <span>Income: ${m.income_usd.toLocaleString()}/yr</span>}
                  </div>
                </div>
                <button onClick={() => handleRemoveMember(m.id)} disabled={pending}
                  className="text-gray-600 hover:text-red-400 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Goals tab */}
      {tab === 'goals' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <button onClick={() => setShowGoalForm(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              <Plus className="h-4 w-4" /> Add Goal
            </button>
          </div>
          {showGoalForm && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Goal Name</label>
                  <input value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="e.g. College Fund for Emma"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select value={goalType} onChange={e => setGoalType(e.target.value as HouseholdGoal['goal_type'])}
                    className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="general">General</option>
                    <option value="retirement">Retirement</option>
                    <option value="education">Education</option>
                    <option value="home">Home Purchase</option>
                    <option value="estate">Estate</option>
                    <option value="charitable">Charitable</option>
                    <option value="emergency">Emergency Fund</option>
                    <option value="trust">Trust</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Target Amount ($)</label>
                  <input type="number" value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="500000"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Target Date</label>
                  <input type="date" value={goalDate} onChange={e => setGoalDate(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <input value={goalNotes} onChange={e => setGoalNotes(e.target.value)} placeholder="Optional notes"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddGoal} disabled={pending || !goalName.trim() || !goalTarget}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Add Goal</button>
                <button onClick={() => setShowGoalForm(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">Cancel</button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {(household.goals ?? []).map(goal => {
              const pct = goal.target_amount_usd > 0 ? Math.min(100, (goal.current_amount_usd / goal.target_amount_usd) * 100) : 0
              return (
                <div key={goal.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{GOAL_TYPE_ICONS[goal.goal_type] ?? '🎯'}</span>
                      <div>
                        <p className="font-medium text-white">{goal.name}</p>
                        {goal.target_date && (
                          <p className="text-xs text-gray-500">Target: {new Date(goal.target_date).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize',
                      goal.status === 'achieved' ? 'text-green-400 bg-green-400/10' :
                      goal.status === 'active' ? 'text-indigo-400 bg-indigo-400/10' :
                      'text-gray-400 bg-gray-400/10')}>
                      {goal.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-400">${goal.current_amount_usd.toLocaleString()} saved</span>
                    <span className="text-white font-medium">${goal.target_amount_usd.toLocaleString()} target</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{pct.toFixed(1)}% complete</p>
                  {goal.notes && <p className="text-xs text-gray-500 mt-2">{goal.notes}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
