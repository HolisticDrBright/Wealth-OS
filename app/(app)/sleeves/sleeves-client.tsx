'use client'

import { useState, useTransition } from 'react'
import { createSleeve, haltSleeve, resumeSleeve, approveRequest, rejectRequest } from '@/lib/actions/sleeves'
import type { PortfolioSleeve, SleeveApprovalRequest } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Layers, Plus, AlertTriangle, CheckCircle, XCircle, ChevronRight, Play, Pause, Clock } from 'lucide-react'

interface Props {
  initialSleeves: PortfolioSleeve[]
  initialPendingApprovals: SleeveApprovalRequest[]
}

const TYPE_COLORS: Record<string, string> = {
  autonomous:      'text-indigo-400 bg-indigo-400/10',
  manual:          'text-gray-400 bg-gray-400/10',
  advisor_managed: 'text-blue-400 bg-blue-400/10',
  trust:           'text-yellow-400 bg-yellow-400/10',
}

export function SleevesClient({ initialSleeves, initialPendingApprovals }: Props) {
  const [sleeves, setSleeves] = useState(initialSleeves)
  const [approvals, setApprovals] = useState(initialPendingApprovals)
  const [showForm, setShowForm] = useState(false)
  const [pending, startTransition] = useTransition()

  // Form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sleeveType, setSleeveType] = useState<PortfolioSleeve['sleeve_type']>('autonomous')
  const [targetPct, setTargetPct] = useState('')
  const [approvalThreshold, setApprovalThreshold] = useState('1000')
  const [maxPosPct, setMaxPosPct] = useState('10')
  const [maxDD, setMaxDD] = useState('20')

  function handleCreate() {
    if (!name.trim()) return
    startTransition(async () => {
      const s = await createSleeve({
        name: name.trim(),
        description: description || undefined,
        sleeve_type: sleeveType,
        target_allocation_pct: targetPct ? Number(targetPct) : undefined,
        approval_threshold_usd: Number(approvalThreshold),
        max_position_pct: Number(maxPosPct),
        max_drawdown_pct: Number(maxDD),
      })
      if (s) setSleeves(prev => [s, ...prev])
      setName('')
      setDescription('')
      setShowForm(false)
    })
  }

  function handleHalt(id: string) {
    startTransition(async () => {
      await haltSleeve(id, 'Manually halted by user')
      setSleeves(prev => prev.map(s => s.id === id ? { ...s, halted: true } : s))
    })
  }

  function handleResume(id: string) {
    startTransition(async () => {
      await resumeSleeve(id)
      setSleeves(prev => prev.map(s => s.id === id ? { ...s, halted: false } : s))
    })
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      await approveRequest(id)
      setApprovals(prev => prev.filter(a => a.id !== id))
    })
  }

  function handleReject(id: string) {
    startTransition(async () => {
      await rejectRequest(id)
      setApprovals(prev => prev.filter(a => a.id !== id))
    })
  }

  const totalValue = sleeves.reduce((s, sl) => s + sl.current_value_usd, 0)
  const haltedCount = sleeves.filter(s => s.halted).length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolio Sleeves</h1>
          <p className="text-sm text-gray-400 mt-1">Autonomous allocations with strict approval controls</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Sleeve
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total Sleeve Value</p>
          <p className="text-2xl font-bold text-white mt-1">${totalValue.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Active Sleeves</p>
          <p className="text-2xl font-bold text-indigo-400 mt-1">{sleeves.filter(s => s.is_active && !s.halted).length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Pending Approvals</p>
          <p className={cn('text-2xl font-bold mt-1', approvals.length > 0 ? 'text-yellow-400' : 'text-white')}>{approvals.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Halted</p>
          <p className={cn('text-2xl font-bold mt-1', haltedCount > 0 ? 'text-red-400' : 'text-white')}>{haltedCount}</p>
        </div>
      </div>

      {/* Pending approvals */}
      {approvals.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Pending Approvals ({approvals.length})
          </h2>
          <div className="flex flex-col gap-2">
            {approvals.map(req => (
              <div key={req.id} className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 capitalize font-medium">
                      {req.request_type.replace('_', ' ')}
                    </span>
                    {req.symbol && <span className="font-medium text-white">{req.symbol}</span>}
                    {req.action && (
                      <span className={cn('text-xs font-medium', req.action === 'buy' ? 'text-green-400' : 'text-red-400')}>
                        {req.action.toUpperCase()}
                      </span>
                    )}
                    {req.notional_usd && <span className="text-sm text-gray-300">${req.notional_usd.toLocaleString()}</span>}
                  </div>
                  {req.reason && <p className="text-xs text-gray-400">{req.reason}</p>}
                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires {new Date(req.expires_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(req.id)}
                    disabled={pending}
                    className="flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    disabled={pending}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 flex flex-col gap-4">
          <p className="font-semibold text-white">New Portfolio Sleeve</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Growth Sleeve"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Strategy description"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select value={sleeveType} onChange={e => setSleeveType(e.target.value as PortfolioSleeve['sleeve_type'])}
                className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="autonomous">Autonomous</option>
                <option value="manual">Manual</option>
                <option value="advisor_managed">Advisor Managed</option>
                <option value="trust">Trust</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Target Allocation %</label>
              <input type="number" value={targetPct} onChange={e => setTargetPct(e.target.value)} placeholder="30"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Approval Threshold ($)</label>
              <input type="number" value={approvalThreshold} onChange={e => setApprovalThreshold(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Max Position %</label>
              <input type="number" value={maxPosPct} onChange={e => setMaxPosPct(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Max Drawdown % (halt trigger)</label>
              <input type="number" value={maxDD} onChange={e => setMaxDD(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} disabled={pending || !name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Create Sleeve</button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}

      {/* Sleeve list */}
      {sleeves.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Layers className="h-10 w-10 mb-3 opacity-30" />
          <p>No sleeves yet</p>
          <p className="text-sm mt-1">Create portfolio sleeves for autonomous allocation with approval controls</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sleeves.map(sleeve => (
            <div key={sleeve.id} className={cn(
              'rounded-xl border p-4',
              sleeve.halted ? 'border-red-500/20 bg-red-500/5' :
              !sleeve.is_active ? 'border-white/5 bg-white/2 opacity-60' :
              'border-white/10 bg-white/5'
            )}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-white">{sleeve.name}</p>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', TYPE_COLORS[sleeve.sleeve_type])}>
                      {sleeve.sleeve_type.replace('_', ' ')}
                    </span>
                    {sleeve.halted && (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        Halted
                      </span>
                    )}
                    {sleeve.approval_required && (
                      <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
                        Approval required &gt;${sleeve.approval_threshold_usd.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {sleeve.description && <p className="text-sm text-gray-400 mb-2">{sleeve.description}</p>}
                  {sleeve.halted_reason && (
                    <p className="text-xs text-red-400 mb-2">{sleeve.halted_reason}</p>
                  )}
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>Value: <span className="text-white">${sleeve.current_value_usd.toLocaleString()}</span></span>
                    {sleeve.target_allocation_pct && (
                      <span>Target: <span className="text-white">{sleeve.target_allocation_pct}%</span></span>
                    )}
                    <span>Max pos: <span className="text-white">{sleeve.max_position_pct}%</span></span>
                    <span>Max DD: <span className="text-red-400">{sleeve.max_drawdown_pct}%</span></span>
                    {sleeve.performance_ytd_pct != null && (
                      <span>YTD: <span className={sleeve.performance_ytd_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {sleeve.performance_ytd_pct >= 0 ? '+' : ''}{sleeve.performance_ytd_pct.toFixed(2)}%
                      </span></span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {sleeve.halted ? (
                    <button onClick={() => handleResume(sleeve.id)} disabled={pending}
                      className="flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50">
                      <Play className="h-3.5 w-3.5" /> Resume
                    </button>
                  ) : (
                    <button onClick={() => handleHalt(sleeve.id)} disabled={pending}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50">
                      <Pause className="h-3.5 w-3.5" /> Halt
                    </button>
                  )}
                  <Link href={`/sleeves/${sleeve.id}`} className="text-gray-500 hover:text-white transition-colors">
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
