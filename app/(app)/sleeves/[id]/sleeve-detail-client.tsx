'use client'

import { useState, useTransition } from 'react'
import { createApprovalRequest, approveRequest, rejectRequest, haltSleeve, resumeSleeve } from '@/lib/actions/sleeves'
import type { PortfolioSleeve, SleeveApprovalRequest } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, Plus, CheckCircle, XCircle, AlertTriangle, Clock, Play, Pause, Layers } from 'lucide-react'

interface Props {
  sleeve: PortfolioSleeve
  allApprovals: SleeveApprovalRequest[]
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'text-yellow-400 bg-yellow-400/10',
  approved: 'text-green-400 bg-green-400/10',
  rejected: 'text-red-400 bg-red-400/10',
  expired:  'text-gray-500 bg-gray-500/10',
}

export function SleeveDetailClient({ sleeve: initialSleeve, allApprovals: initialApprovals }: Props) {
  const [sleeve, setSleeve] = useState(initialSleeve)
  const [approvals, setApprovals] = useState(initialApprovals)
  const [pending, startTransition] = useTransition()
  const [showTradeForm, setShowTradeForm] = useState(false)

  // Trade request form
  const [tradeSymbol, setTradeSymbol] = useState('')
  const [tradeAction, setTradeAction] = useState('buy')
  const [tradeNotional, setTradeNotional] = useState('')
  const [tradeReason, setTradeReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)

  const positions = sleeve.positions ?? []
  const pendingApprovals = approvals.filter(a => a.status === 'pending')

  function handleApprove(id: string) {
    startTransition(async () => {
      await approveRequest(id)
      setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'approved' as const } : a))
    })
  }

  function handleReject(id: string) {
    startTransition(async () => {
      await rejectRequest(id)
      setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'rejected' as const } : a))
    })
  }

  function handleHalt() {
    startTransition(async () => {
      await haltSleeve(sleeve.id, 'Manually halted')
      setSleeve(s => ({ ...s, halted: true }))
    })
  }

  function handleResume() {
    startTransition(async () => {
      await resumeSleeve(sleeve.id)
      setSleeve(s => ({ ...s, halted: false }))
    })
  }

  async function handleSubmitTrade() {
    if (!tradeSymbol.trim() || !tradeNotional) return
    setSubmitting(true)
    setSubmitMsg(null)
    const notional = Number(tradeNotional)

    if (sleeve.approval_required && notional >= sleeve.approval_threshold_usd) {
      // Create approval request
      const req = await createApprovalRequest(sleeve.id, {
        request_type: 'trade',
        symbol: tradeSymbol.toUpperCase(),
        action: tradeAction,
        notional_usd: notional,
        order_type: 'market',
        reason: tradeReason || undefined,
      })
      if (req) {
        setApprovals(prev => [req, ...prev])
        setSubmitMsg(`Approval request created — awaiting review (expires ${new Date(req.expires_at).toLocaleString()})`)
        setShowTradeForm(false)
      }
    } else {
      // Execute immediately via API
      const res = await fetch('/api/sleeves/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: 'direct',
          action: 'approved',
        }),
      })
      setSubmitMsg(res.ok ? 'Trade submitted to broker' : 'Submission failed')
    }
    setSubmitting(false)
    setTradeSymbol('')
    setTradeNotional('')
    setTradeReason('')
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/sleeves" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white w-fit">
        <ArrowLeft className="h-4 w-4" /> All Sleeves
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Layers className="h-6 w-6 text-indigo-400" />
            <h1 className="text-2xl font-bold text-white">{sleeve.name}</h1>
            {sleeve.halted && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                <AlertTriangle className="h-3 w-3" /> Halted
              </span>
            )}
          </div>
          {sleeve.description && <p className="text-sm text-gray-400">{sleeve.description}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTradeForm(!showTradeForm)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10"
          >
            <Plus className="h-4 w-4" /> Submit Trade
          </button>
          {sleeve.halted ? (
            <button onClick={handleResume} disabled={pending}
              className="flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50">
              <Play className="h-4 w-4" /> Resume
            </button>
          ) : (
            <button onClick={handleHalt} disabled={pending}
              className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50">
              <Pause className="h-4 w-4" /> Halt
            </button>
          )}
        </div>
      </div>

      {/* Risk controls banner */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-gray-500">Approval threshold</p>
          <p className="text-white font-medium">
            {sleeve.approval_required ? `$${sleeve.approval_threshold_usd.toLocaleString()}` : 'None'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Max position</p>
          <p className="text-white font-medium">{sleeve.max_position_pct}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Max drawdown</p>
          <p className="text-red-400 font-medium">{sleeve.max_drawdown_pct}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Approved classes</p>
          <p className="text-white font-medium">{sleeve.approved_asset_classes.join(', ') || 'All'}</p>
        </div>
        {sleeve.target_allocation_pct && (
          <div>
            <p className="text-xs text-gray-500">Target allocation</p>
            <p className="text-white font-medium">{sleeve.target_allocation_pct}%</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500">Halt on breach</p>
          <p className={cn('font-medium', sleeve.halt_on_breach ? 'text-yellow-400' : 'text-gray-400')}>
            {sleeve.halt_on_breach ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      {/* Trade submission form */}
      {showTradeForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 flex flex-col gap-3">
          <p className="font-semibold text-white">Submit Trade</p>
          {sleeve.approval_required && (
            <p className="text-xs text-yellow-300">
              Trades ≥ ${sleeve.approval_threshold_usd.toLocaleString()} require approval before execution.
            </p>
          )}
          {submitMsg && (
            <div className="rounded-lg bg-white/10 px-3 py-2 text-sm text-gray-200">{submitMsg}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Symbol</label>
              <input value={tradeSymbol} onChange={e => setTradeSymbol(e.target.value)} placeholder="AAPL"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white uppercase focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Action</label>
              <select value={tradeAction} onChange={e => setTradeAction(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Notional ($)</label>
              <input type="number" value={tradeNotional} onChange={e => setTradeNotional(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Reason</label>
              <input value={tradeReason} onChange={e => setTradeReason(e.target.value)} placeholder="Optional rationale"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmitTrade} disabled={submitting || !tradeSymbol || !tradeNotional}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              {submitting ? 'Submitting...' : sleeve.approval_required && Number(tradeNotional) >= sleeve.approval_threshold_usd ? 'Request Approval' : 'Execute'}
            </button>
            <button onClick={() => { setShowTradeForm(false); setSubmitMsg(null) }}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}

      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pending ({pendingApprovals.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pendingApprovals.map(req => (
              <div key={req.id} className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{req.symbol}</span>
                    <span className={cn('text-xs font-medium', req.action === 'buy' ? 'text-green-400' : 'text-red-400')}>
                      {req.action?.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-300">${req.notional_usd?.toLocaleString()}</span>
                  </div>
                  {req.reason && <p className="text-xs text-gray-400 mt-0.5">{req.reason}</p>}
                  <p className="text-xs text-gray-600 mt-0.5">Expires {new Date(req.expires_at).toLocaleString()}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleApprove(req.id)} disabled={pending}
                    className="flex items-center gap-1 rounded-lg bg-green-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50">
                    <CheckCircle className="h-3 w-3" /> Approve
                  </button>
                  <button onClick={() => handleReject(req.id)} disabled={pending}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50">
                    <XCircle className="h-3 w-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="text-sm text-gray-500">No positions in this sleeve yet.</p>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Quantity</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Avg Cost</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Market Value</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Weight</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <tr key={pos.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">{pos.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">{pos.quantity.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">${pos.avg_cost_usd?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">${pos.market_value_usd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={pos.unrealized_pnl_usd >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {pos.unrealized_pnl_usd >= 0 ? '+' : ''}${pos.unrealized_pnl_usd.toLocaleString()}
                        <span className="text-xs ml-1">({pos.unrealized_pnl_pct >= 0 ? '+' : ''}{pos.unrealized_pnl_pct.toFixed(2)}%)</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{pos.weight_pct?.toFixed(1) ?? '—'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* All approval history */}
      {approvals.filter(a => a.status !== 'pending').length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Approval History</h2>
          <div className="flex flex-col gap-2">
            {approvals.filter(a => a.status !== 'pending').slice(0, 10).map(req => (
              <div key={req.id} className="rounded-xl border border-white/5 bg-white/3 p-3 flex items-center gap-3 opacity-70">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[req.status])}>
                  {req.status}
                </span>
                <span className="text-sm text-white">{req.symbol}</span>
                <span className={cn('text-xs', req.action === 'buy' ? 'text-green-400' : 'text-red-400')}>{req.action?.toUpperCase()}</span>
                <span className="text-sm text-gray-400">${req.notional_usd?.toLocaleString()}</span>
                {req.review_notes && <span className="text-xs text-gray-500 ml-auto">{req.review_notes}</span>}
                <span className="text-xs text-gray-600 ml-auto">{new Date(req.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
