'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { Plus, X, Calculator, TrendingUp, TrendingDown, Clock } from 'lucide-react'
import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'

interface OptionPos {
  id: string
  symbol: string
  option_type: 'call' | 'put'
  strategy: string
  strike: number
  expiration: string
  contracts: number
  premium_paid: number
  current_price?: number
  underlying_price?: number
  is_short: boolean
  pnl?: {
    unrealizedPnL: number
    unrealizedPnLPct: number
    maxProfit: number
    maxLoss: number
    breakeven: number | number[]
    daysToExpiry: number
  }
}

interface Greeks {
  delta: number
  gamma: number
  theta: number
  vega: number
  rho: number
  iv: number
}

interface GreeksResult {
  symbol: string
  strike: number
  expiry: string
  type: string
  underlyingPrice: number
  theoreticalPrice: number
  greeks: Greeks
}

interface Props {
  initialPositions: OptionPos[]
}

const STRATEGY_LABELS: Record<string, string> = {
  long_call: 'Long Call', short_call: 'Short Call',
  long_put: 'Long Put', short_put: 'Short Put',
  covered_call: 'Covered Call', protective_put: 'Protective Put',
  cash_secured_put: 'Cash-Secured Put', straddle: 'Straddle', strangle: 'Strangle',
}

export function OptionsClient({ initialPositions }: Props) {
  const [positions, setPositions] = useState(initialPositions)
  const [showAdd, setShowAdd] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [form, setForm] = useState({
    symbol: '', option_type: 'call' as 'call' | 'put',
    strategy: 'long_call', strike: '', expiration: '',
    contracts: '1', premium_paid: '', is_short: false,
  })

  // Greeks calculator
  const [gcForm, setGcForm] = useState({ symbol: '', strike: '', expiry: '', type: 'call', vol: '0.25' })
  const [gcResult, setGcResult] = useState<GreeksResult | null>(null)
  const [gcLoading, setGcLoading] = useState(false)
  const [gcError, setGcError] = useState<string | null>(null)

  async function addPosition() {
    setIsAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          strike: Number(form.strike),
          contracts: Number(form.contracts),
          premium_paid: Number(form.premium_paid),
        }),
      })
      const envelope = await res.json()
      if (!res.ok) {
        setAddError(envelope.error ?? 'Failed to add position')
      } else {
        setPositions(p => [envelope.data, ...p])
        setShowAdd(false)
        setForm({ symbol: '', option_type: 'call', strategy: 'long_call', strike: '', expiration: '', contracts: '1', premium_paid: '', is_short: false })
      }
    } catch {
      setAddError('Connection error')
    } finally {
      setIsAdding(false)
    }
  }

  async function closePosition(id: string) {
    const res = await fetch(`/api/options?id=${id}`, { method: 'DELETE' })
    if (res.ok) setPositions(p => p.filter(pos => pos.id !== id))
  }

  async function calcGreeks() {
    setGcLoading(true)
    setGcError(null)
    setGcResult(null)
    try {
      const params = new URLSearchParams({
        action: 'greeks',
        symbol: gcForm.symbol.toUpperCase(),
        strike: gcForm.strike,
        expiry: gcForm.expiry,
        type: gcForm.type,
        vol: gcForm.vol,
      })
      const res = await fetch(`/api/options?${params}`)
      const envelope = await res.json()
      if (!res.ok) setGcError(envelope.error ?? 'Failed to compute greeks')
      else setGcResult(envelope.data)
    } catch {
      setGcError('Connection error')
    } finally {
      setGcLoading(false)
    }
  }

  const totalPnL = positions.reduce((s, p) => s + (p.pnl?.unrealizedPnL ?? 0), 0)

  return (
    <div className="space-y-6">
      {/* Summary */}
      {positions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <div className="p-4">
              <p className="text-xs text-gray-500">Open Positions</p>
              <p className="text-lg font-bold text-white">{positions.length}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-xs text-gray-500">Unrealized P&L</p>
              <p className={`text-lg font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
              </p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-xs text-gray-500">Contracts</p>
              <p className="text-lg font-bold text-white">{positions.reduce((s, p) => s + p.contracts, 0)}</p>
            </div>
          </Card>
        </div>
      )}

      {/* Positions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Positions</h2>
          <Button size="sm" onClick={() => setShowAdd(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Position
          </Button>
        </div>

        {showAdd && (
          <Card className="mb-4">
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Option Position</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Symbol" value={form.symbol} placeholder="AAPL"
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} />
                <Select label="Strategy" value={form.strategy}
                  onChange={e => setForm(f => ({ ...f, strategy: e.target.value, is_short: e.target.value.startsWith('short') }))}>
                  {Object.entries(STRATEGY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Select label="Type" value={form.option_type}
                  onChange={e => setForm(f => ({ ...f, option_type: e.target.value as 'call' | 'put' }))}>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </Select>
                <Input label="Strike ($)" type="number" value={form.strike} placeholder="200"
                  onChange={e => setForm(f => ({ ...f, strike: e.target.value }))} />
                <Input label="Expiration" type="date" value={form.expiration}
                  onChange={e => setForm(f => ({ ...f, expiration: e.target.value }))} />
                <Input label="Contracts" type="number" min="1" value={form.contracts}
                  onChange={e => setForm(f => ({ ...f, contracts: e.target.value }))} />
                <Input label="Premium Paid ($/share)" type="number" step="0.01" value={form.premium_paid} placeholder="5.50"
                  onChange={e => setForm(f => ({ ...f, premium_paid: e.target.value }))} />
              </div>
              {addError && <p className="text-xs text-red-400">{addError}</p>}
              <div className="flex gap-2">
                <Button onClick={addPosition} disabled={isAdding || !form.symbol || !form.strike || !form.expiration || !form.premium_paid}>
                  {isAdding ? 'Adding...' : 'Add Position'}
                </Button>
                <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-10 text-center">
            <TrendingUp className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No open option positions</p>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.map(pos => {
              const daysLeft = pos.pnl?.daysToExpiry ?? Math.max(0, Math.ceil((new Date(pos.expiration).getTime() - Date.now()) / 86400000))
              const pnl = pos.pnl?.unrealizedPnL ?? 0
              return (
                <Card key={pos.id}>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{pos.symbol}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pos.option_type === 'call' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {pos.option_type.toUpperCase()}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400">
                            {STRATEGY_LABELS[pos.strategy] ?? pos.strategy}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          ${pos.strike} strike · {pos.contracts} contract{pos.contracts !== 1 ? 's' : ''} · expires {pos.expiration}
                        </p>
                      </div>
                      <button onClick={() => closePosition(pos.id)} className="text-gray-600 hover:text-gray-400 ml-2 shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-gray-500">Premium</p>
                        <p className="text-white font-medium">${pos.premium_paid}/sh</p>
                      </div>
                      <div>
                        <p className="text-gray-500">P&L</p>
                        <p className={`font-medium ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-gray-600" />
                        <p className={`font-medium ${daysLeft <= 7 ? 'text-red-400' : daysLeft <= 21 ? 'text-amber-400' : 'text-gray-400'}`}>
                          {daysLeft}d left
                        </p>
                      </div>
                    </div>
                    {pos.pnl && (
                      <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-2 text-xs text-gray-500">
                        <span>Max profit: <span className="text-emerald-400">{pos.pnl.maxProfit === Infinity ? '∞' : formatCurrency(pos.pnl.maxProfit)}</span></span>
                        <span>Max loss: <span className="text-red-400">{pos.pnl.maxLoss === Infinity ? '∞' : formatCurrency(Math.abs(pos.pnl.maxLoss))}</span></span>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Strategies */}
      <AssetStrategyPanel assetClasses={['options']} />

      {/* Greeks Calculator */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Black-Scholes Calculator</h2>
        <Card>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Input label="Symbol" value={gcForm.symbol} placeholder="AAPL"
                onChange={e => setGcForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} />
              <Input label="Strike ($)" type="number" value={gcForm.strike} placeholder="200"
                onChange={e => setGcForm(f => ({ ...f, strike: e.target.value }))} />
              <Input label="Expiry" type="date" value={gcForm.expiry}
                onChange={e => setGcForm(f => ({ ...f, expiry: e.target.value }))} />
              <Select label="Type" value={gcForm.type}
                onChange={e => setGcForm(f => ({ ...f, type: e.target.value }))}>
                <option value="call">Call</option>
                <option value="put">Put</option>
              </Select>
              <Input label="Implied Vol (e.g. 0.25)" type="number" step="0.01" value={gcForm.vol}
                onChange={e => setGcForm(f => ({ ...f, vol: e.target.value }))} />
            </div>
            <Button onClick={calcGreeks} disabled={gcLoading || !gcForm.symbol || !gcForm.strike || !gcForm.expiry}>
              <Calculator className="h-3.5 w-3.5 mr-1.5" />
              {gcLoading ? 'Calculating...' : 'Calculate Greeks'}
            </Button>
            {gcError && <p className="text-xs text-red-400">{gcError}</p>}
            {gcResult && (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500">Underlying Price</p>
                    <p className="text-sm font-bold text-white">{formatCurrency(gcResult.underlyingPrice)}</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500">Theoretical Price</p>
                    <p className="text-sm font-bold text-indigo-400">{formatCurrency(gcResult.theoreticalPrice)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {[
                    { label: 'Delta', value: gcResult.greeks.delta.toFixed(3), color: 'text-white' },
                    { label: 'Gamma', value: gcResult.greeks.gamma.toFixed(4), color: 'text-white' },
                    { label: 'Theta /d', value: gcResult.greeks.theta.toFixed(3), color: 'text-red-400' },
                    { label: 'Vega /1%', value: gcResult.greeks.vega.toFixed(3), color: 'text-white' },
                    { label: 'Rho', value: gcResult.greeks.rho.toFixed(3), color: 'text-white' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg bg-white/5 p-3 text-center">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className={`text-sm font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
