'use client'

import { useState, useTransition } from 'react'
import { addAdvisorClient, updateAdvisorClient } from '@/lib/actions/household'
import type { AdvisorClient } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Briefcase, Plus, DollarSign, Users, TrendingUp, Edit3 } from 'lucide-react'

interface Props {
  initialClients: AdvisorClient[]
  totalAUM: number
}

const STATUS_COLORS: Record<string, string> = {
  active:   'text-green-400 bg-green-400/10',
  prospect: 'text-yellow-400 bg-yellow-400/10',
  inactive: 'text-gray-400 bg-gray-400/10',
}

export function AdvisorClient({ initialClients, totalAUM }: Props) {
  const [clients, setClients] = useState(initialClients)
  const [showForm, setShowForm] = useState(false)
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [aum, setAum] = useState('')
  const [feeType, setFeeType] = useState<AdvisorClient['fee_type']>('percentage')
  const [feePct, setFeePct] = useState('1.0')
  const [notes, setNotes] = useState('')

  function resetForm() {
    setClientName('')
    setClientEmail('')
    setAum('')
    setFeePct('1.0')
    setNotes('')
    setShowForm(false)
    setEditingId(null)
  }

  function handleAdd() {
    if (!clientName.trim()) return
    startTransition(async () => {
      const c = await addAdvisorClient({
        client_name: clientName.trim(),
        client_email: clientEmail || undefined,
        aum_usd: aum ? Number(aum) : 0,
        fee_type: feeType,
        fee_pct: feePct ? Number(feePct) : undefined,
        notes: notes || undefined,
      })
      if (c) setClients(prev => [c, ...prev])
      resetForm()
    })
  }

  function handleStatusChange(id: string, status: AdvisorClient['status']) {
    startTransition(async () => {
      await updateAdvisorClient(id, { status })
      setClients(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    })
  }

  const activeClients = clients.filter(c => c.status === 'active')
  const prospects = clients.filter(c => c.status === 'prospect')
  const annualRevenue = clients.filter(c => c.status === 'active').reduce((s, c) => {
    if (c.fee_type === 'percentage' && c.fee_pct) return s + (c.aum_usd * c.fee_pct / 100)
    if (c.fee_type === 'flat' && c.fee_flat_annual_usd) return s + c.fee_flat_annual_usd
    return s
  }, 0)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Advisor Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Manage your client relationships and AUM</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total AUM</p>
          <p className="text-2xl font-bold text-white mt-1">${(totalAUM / 1e6).toFixed(2)}M</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Active Clients</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{activeClients.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Prospects</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{prospects.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Est. Annual Revenue</p>
          <p className="text-2xl font-bold text-indigo-400 mt-1">${annualRevenue.toLocaleString()}</p>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 flex flex-col gap-4">
          <p className="font-semibold text-white">New Client</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Client Name</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="John & Jane Smith"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Email</label>
              <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">AUM ($)</label>
              <input type="number" value={aum} onChange={e => setAum(e.target.value)} placeholder="1000000"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Fee Type</label>
              <select value={feeType} onChange={e => setFeeType(e.target.value as AdvisorClient['fee_type'])}
                className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="percentage">% of AUM</option>
                <option value="flat">Flat Annual</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Fee % (annual)</label>
              <input type="number" step="0.1" value={feePct} onChange={e => setFeePct(e.target.value)} placeholder="1.0"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Risk profile, goals..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={pending || !clientName.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Add Client</button>
            <button onClick={resetForm}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}

      {/* Client list */}
      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Briefcase className="h-10 w-10 mb-3 opacity-30" />
          <p>No clients yet</p>
          <p className="text-sm mt-1">Add clients to track their AUM and generate advisory reports</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Client</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">AUM</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Fee</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Est. Revenue</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const estRevenue = c.fee_type === 'percentage' && c.fee_pct
                  ? c.aum_usd * c.fee_pct / 100
                  : c.fee_flat_annual_usd ?? 0
                return (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{c.client_name}</p>
                      {c.client_email && <p className="text-xs text-gray-500">{c.client_email}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">${c.aum_usd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {c.fee_type === 'percentage' ? `${c.fee_pct ?? 0}% AUM` :
                       c.fee_type === 'flat' ? `$${c.fee_flat_annual_usd?.toLocaleString()}/yr` : 'Hybrid'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">${estRevenue.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={c.status}
                        onChange={e => handleStatusChange(c.id, e.target.value as AdvisorClient['status'])}
                        className={cn('text-xs rounded-full px-2 py-0.5 border-0 bg-transparent font-medium cursor-pointer', STATUS_COLORS[c.status])}
                      >
                        <option value="active">Active</option>
                        <option value="prospect">Prospect</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {c.notes && <p className="text-xs text-gray-500 max-w-xs truncate">{c.notes}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
