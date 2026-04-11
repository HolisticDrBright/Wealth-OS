'use client'

import { useState, useTransition } from 'react'
import { dismissCandidate, markHarvested } from '@/lib/actions/harvest'
import type { HarvestCandidate } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Leaf, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import type { LotMethod } from '@/lib/tax-lots'

const LOT_METHOD_LABELS: Record<LotMethod, string> = {
  hifo: 'HIFO — Highest Cost First (minimize gains)',
  lifo: 'LIFO — Last In, First Out',
  fifo: 'FIFO — First In, First Out',
  specific: 'Specific ID — Choose exact lots',
}

interface Props {
  initialCandidates: HarvestCandidate[]
}

export function HarvestClient({ initialCandidates }: Props) {
  const [candidates, setCandidates] = useState(initialCandidates)
  const [pending, startTransition] = useTransition()
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [lotMethod, setLotMethod] = useState<LotMethod>('hifo')

  const totalLoss = candidates.reduce((s, c) => s + c.unrealized_loss_usd, 0)
  const washSaleRisks = candidates.filter(c => c.wash_sale_risk).length

  function handleDismiss(id: string) {
    startTransition(async () => {
      await dismissCandidate(id)
      setCandidates(prev => prev.filter(c => c.id !== id))
    })
  }

  function handleHarvest(id: string) {
    startTransition(async () => {
      await markHarvested(id, lotMethod)
      setCandidates(prev => prev.filter(c => c.id !== id))
    })
  }

  async function handleScan() {
    setScanning(true)
    setScanMsg(null)
    try {
      const res = await fetch('/api/tax-harvest', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setScanMsg(`Error: ${data.error ?? 'Scan failed'}`)
      } else {
        setScanMsg(`Found ${data.data?.candidates_created ?? 0} new candidates`)
        // Reload — in production use router.refresh()
        window.location.reload()
      }
    } catch {
      setScanMsg('Scan failed — check connection')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tax-Loss Harvesting</h1>
          <p className="text-sm text-gray-400 mt-1">Identify & harvest unrealized losses for tax savings</p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', scanning && 'animate-spin')} />
          Scan Portfolio
        </button>
      </div>

      {scanMsg && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          scanMsg.startsWith('Error') ? 'border-red-500/20 bg-red-500/10 text-red-400' : 'border-green-500/20 bg-green-500/10 text-green-400'
        )}>
          {scanMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Candidates</p>
          <p className="text-2xl font-bold text-white mt-1">{candidates.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total Harvestable Loss</p>
          <p className="text-2xl font-bold text-red-400 mt-1">-${Math.abs(totalLoss).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Wash Sale Risk</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{washSaleRisks}</p>
        </div>
      </div>

      {/* Lot selection method */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tax Lot Selection Method</p>
        <div className="flex flex-col gap-2">
          {(Object.entries(LOT_METHOD_LABELS) as [LotMethod, string][]).map(([method, label]) => (
            <label key={method} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="lotMethod"
                value={method}
                checked={lotMethod === method}
                onChange={() => setLotMethod(method)}
                className="w-4 h-4"
              />
              <span className={`text-sm ${lotMethod === method ? 'text-white' : 'text-gray-400'}`}>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-200/80">
          <p className="font-semibold text-yellow-300 mb-1">Wash Sale Rule</p>
          <p>You cannot claim a loss if you buy the same or substantially identical security within 30 days before or after the sale. Positions marked with a warning have wash sale risk. Consider replacement symbols where shown.</p>
        </div>
      </div>

      {/* Candidates */}
      {candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Leaf className="h-10 w-10 mb-3 opacity-30" />
          <p>No harvest candidates</p>
          <p className="text-sm mt-1">Run a scan to identify tax-loss harvesting opportunities</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {candidates.map(c => (
            <div
              key={c.id}
              className={cn(
                'rounded-xl border p-4',
                c.wash_sale_risk ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-white/10 bg-white/5'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-white">{c.symbol}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400 capitalize">{c.asset_class}</span>
                    {c.wash_sale_risk && (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        Wash Sale Risk
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-2">
                    <div>
                      <p className="text-xs text-gray-500">Unrealized Loss</p>
                      <p className="text-lg font-bold text-red-400">-${Math.abs(c.unrealized_loss_usd).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Loss %</p>
                      <p className="text-lg font-bold text-red-400">-{Math.abs(c.unrealized_loss_pct).toFixed(2)}%</p>
                    </div>
                    {c.replacement_symbol && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500">Suggested Replacement</p>
                        <p className="text-sm font-medium text-indigo-400">{c.replacement_symbol}</p>
                      </div>
                    )}
                    {c.purchase_date && (
                      <div>
                        <p className="text-xs text-gray-500">Purchase Date</p>
                        <p className="text-sm text-gray-300">{new Date(c.purchase_date).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleHarvest(c.id)}
                    disabled={pending}
                    className="flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Harvest
                  </button>
                  <button
                    onClick={() => handleDismiss(c.id)}
                    disabled={pending}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 disabled:opacity-50 transition-colors"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
