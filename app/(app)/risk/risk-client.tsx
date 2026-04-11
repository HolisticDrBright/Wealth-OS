'use client'

import { useState, useTransition, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { updateRiskControls } from '@/lib/actions/risk'
import { createSimulationJob } from '@/lib/actions/simulations'
import { formatCurrency } from '@/lib/utils'
import type { RiskControl, SimulationJob } from '@/lib/types'
import type { RiskSummary } from '@/lib/actions/risk'
import type { RiskMetrics } from '@/lib/risk-engine'
import {
  ShieldAlert, Activity, Plus, Clock, CheckCircle2,
  XCircle, RefreshCw, AlertCircle, BarChart2,
} from 'lucide-react'

interface Props {
  initialControls: RiskControl | null
  summary: RiskSummary
  initialJobs: SimulationJob[]
  realMetrics?: RiskMetrics | null
}

const JOB_STATUS_CONFIG = {
  pending:   { icon: Clock,         color: 'text-amber-400' },
  running:   { icon: RefreshCw,     color: 'text-indigo-400', spin: true },
  completed: { icon: CheckCircle2,  color: 'text-emerald-400' },
  failed:    { icon: XCircle,       color: 'text-red-400' },
}

export function RiskClient({ initialControls, summary, initialJobs, realMetrics }: Props) {
  const [controls, setControls] = useState(initialControls)
  const [jobs, setJobs] = useState(initialJobs)
  const [isSaving, startSave] = useTransition()
  const [isCreating, startCreate] = useTransition()
  const [showNewSim, setShowNewSim] = useState(false)
  const [simForm, setSimForm] = useState({
    title: '',
    symbols: '',
    scenario: 'base' as SimulationJob['scenario'],
    horizon_days: '30',
  })

  // ─── Realtime: simulation-updates ────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('simulation-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'simulation_jobs' },
        (payload) => {
          const updated = payload.new as SimulationJob
          setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  function saveControls() {
    if (!controls) return
    startSave(async () => {
      const updated = await updateRiskControls({
        max_portfolio_risk_pct: controls.max_portfolio_risk_pct,
        max_single_position_pct: controls.max_single_position_pct,
        max_drawdown_pct: controls.max_drawdown_pct,
        stop_loss_enabled: controls.stop_loss_enabled,
        daily_loss_limit_usd: controls.daily_loss_limit_usd,
        volatility_threshold: controls.volatility_threshold,
      })
      if (updated) setControls(updated)
    })
  }

  function createSim() {
    startCreate(async () => {
      const job = await createSimulationJob({
        title: simForm.title,
        symbols: simForm.symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
        scenario: simForm.scenario,
        horizon_days: parseInt(simForm.horizon_days) || 30,
      })
      if (job) {
        setJobs(prev => [job, ...prev])
        setShowNewSim(false)
        setSimForm({ title: '', symbols: '', scenario: 'base', horizon_days: '30' })
      }
    })
  }

  const riskPct = summary.total_open_notional > 0
    ? Math.min(100, (summary.total_open_notional / ((controls?.max_portfolio_risk_pct ?? 20) * 1000)) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Live Exposure */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Live Exposure</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Open Notional', value: formatCurrency(summary.total_open_notional), icon: BarChart2 },
            { label: 'Positions', value: summary.open_position_count.toString(), icon: Activity },
            { label: 'Largest Position', value: `${summary.largest_position_pct.toFixed(1)}%`, icon: ShieldAlert },
            {
              label: "Today's P&L",
              value: `${summary.today_pnl >= 0 ? '+' : ''}${formatCurrency(summary.today_pnl)}`,
              icon: summary.today_pnl >= 0 ? CheckCircle2 : AlertCircle,
              color: summary.today_pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <div className="p-4 flex items-start gap-3">
                <Icon className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${color ?? 'text-white'}`}>{value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Risk bar */}
        {summary.total_open_notional > 0 && (
          <div className="mt-3 rounded-xl bg-white/5 border border-white/10 p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-gray-400">Portfolio risk utilization</span>
              <span className={riskPct > 80 ? 'text-red-400' : riskPct > 60 ? 'text-amber-400' : 'text-emerald-400'}>
                {riskPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div
                className={`h-2 rounded-full transition-all ${riskPct > 80 ? 'bg-red-500' : riskPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, riskPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Risk Controls */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Risk Controls</h2>
        <Card>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Max portfolio risk (%)"
                type="number"
                min="1"
                max="100"
                value={controls?.max_portfolio_risk_pct ?? 20}
                onChange={e => setControls(c => c ? { ...c, max_portfolio_risk_pct: Number(e.target.value) } : c)}
              />
              <Input
                label="Max single position (%)"
                type="number"
                min="1"
                max="100"
                value={controls?.max_single_position_pct ?? 10}
                onChange={e => setControls(c => c ? { ...c, max_single_position_pct: Number(e.target.value) } : c)}
              />
              <Input
                label="Max drawdown (%)"
                type="number"
                min="1"
                max="100"
                value={controls?.max_drawdown_pct ?? 15}
                onChange={e => setControls(c => c ? { ...c, max_drawdown_pct: Number(e.target.value) } : c)}
              />
              <Input
                label="Daily loss limit ($, optional)"
                type="number"
                min="0"
                value={controls?.daily_loss_limit_usd ?? ''}
                onChange={e => setControls(c => c ? { ...c, daily_loss_limit_usd: e.target.value ? Number(e.target.value) : undefined } : c)}
                placeholder="No limit"
              />
            </div>
            <Select
              label="Volatility tolerance"
              value={controls?.volatility_threshold ?? 'medium'}
              onChange={e => setControls(c => c ? { ...c, volatility_threshold: e.target.value as RiskControl['volatility_threshold'] } : c)}
            >
              <option value="low">Low — conservative, avoid high-vol assets</option>
              <option value="medium">Medium — balanced approach</option>
              <option value="high">High — aggressive, allow high-vol positions</option>
            </Select>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded"
                  checked={controls?.stop_loss_enabled ?? false}
                  onChange={e => setControls(c => c ? { ...c, stop_loss_enabled: e.target.checked } : c)}
                />
                <span className="text-sm text-gray-300">Enable automatic stop-loss</span>
              </label>
            </div>
            <Button onClick={saveControls} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Controls'}
            </Button>
          </div>
        </Card>
      </div>

      {/* Risk Analytics */}
      {realMetrics && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Risk Analytics</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
            {[
              { label: '95% VaR (1d)', value: formatCurrency(realMetrics.var95_1d), color: 'text-amber-400' },
              { label: '99% VaR (1d)', value: formatCurrency(realMetrics.var99_1d), color: 'text-red-400' },
              { label: 'CVaR 95% (1d)', value: formatCurrency(realMetrics.cvar95_1d), color: 'text-red-400' },
              { label: '10d VaR (95%)', value: formatCurrency(realMetrics.var95_10d), color: 'text-amber-400' },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <div className="p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
            {[
              { label: 'Annual Vol', value: `${realMetrics.portfolioVol_annual.toFixed(1)}%`, color: 'text-white' },
              { label: 'Portfolio Beta', value: realMetrics.portfolioBeta.toFixed(2), color: 'text-white' },
              { label: 'Max Drawdown', value: `${realMetrics.maxDrawdown.toFixed(1)}%`, color: 'text-red-400' },
              { label: 'Current Drawdown', value: `${realMetrics.currentDrawdown.toFixed(1)}%`, color: realMetrics.currentDrawdown > 5 ? 'text-red-400' : 'text-emerald-400' },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <div className="p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
            <Card>
              <div className="p-4">
                <p className="text-xs text-gray-500">Avg Correlation</p>
                <p className={`text-lg font-bold mt-0.5 ${realMetrics.avgCorrelation > 0.7 ? 'text-red-400' : realMetrics.avgCorrelation > 0.4 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {realMetrics.avgCorrelation.toFixed(2)}
                </p>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <p className="text-xs text-gray-500">Concentration (HHI)</p>
                <p className={`text-lg font-bold mt-0.5 ${realMetrics.hhi > 0.25 ? 'text-red-400' : realMetrics.hhi > 0.15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {(realMetrics.hhi * 100).toFixed(1)}%
                </p>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <p className="text-xs text-gray-500">Top Holding</p>
                <p className="text-lg font-bold mt-0.5 text-white">{(realMetrics.topHolding * 100).toFixed(1)}%</p>
              </div>
            </Card>
          </div>

          {realMetrics.contributions.length > 0 && (
            <Card>
              <div className="p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Per-Position Risk Contribution</p>
                <div className="space-y-2">
                  {realMetrics.contributions.map(c => (
                    <div key={c.symbol} className="flex items-center gap-3 text-sm">
                      <span className="font-medium text-white w-16 shrink-0">{c.symbol}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/10">
                        <div
                          className="h-1.5 rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(100, c.weight * 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-xs w-14 text-right">{(c.weight * 100).toFixed(1)}% wt</span>
                      <span className="text-amber-400 text-xs w-16 text-right">{(c.vol * 100).toFixed(1)}% vol</span>
                      <span className="text-gray-500 text-xs w-14 text-right">β{c.beta.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Simulations */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Scenario Simulations</h2>
          <Button size="sm" onClick={() => setShowNewSim(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Simulation
          </Button>
        </div>

        {showNewSim && (
          <Card className="mb-4">
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Simulation</p>
              <Input
                label="Title"
                value={simForm.title}
                onChange={e => setSimForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. BTC Bull Run Q2"
              />
              <Input
                label="Symbols (comma-separated)"
                value={simForm.symbols}
                onChange={e => setSimForm(f => ({ ...f, symbols: e.target.value }))}
                placeholder="BTC, ETH, AAPL"
              />
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Scenario"
                  value={simForm.scenario}
                  onChange={e => setSimForm(f => ({ ...f, scenario: e.target.value as SimulationJob['scenario'] }))}
                >
                  <option value="bull">Bull</option>
                  <option value="bear">Bear</option>
                  <option value="base">Base</option>
                  <option value="stress">Stress</option>
                  <option value="montecarlo">Monte Carlo</option>
                </Select>
                <Input
                  label="Horizon (days)"
                  type="number"
                  min="1"
                  value={simForm.horizon_days}
                  onChange={e => setSimForm(f => ({ ...f, horizon_days: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={createSim} disabled={isCreating || !simForm.title}>
                  {isCreating ? 'Creating...' : 'Run Simulation'}
                </Button>
                <Button variant="outline" onClick={() => setShowNewSim(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-10 text-center">
            <Activity className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No simulations yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => {
              const cfg = JOB_STATUS_CONFIG[job.status]
              const StatusIcon = cfg.icon
              return (
                <Card key={job.id}>
                  <div className="flex items-center gap-4 p-4">
                    <StatusIcon className={`h-5 w-5 shrink-0 ${cfg.color} ${'spin' in cfg && cfg.spin ? 'animate-spin' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{job.title}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className="capitalize">{job.scenario}</span>
                        <span>{job.horizon_days}d horizon</span>
                        {job.symbols?.length ? <span>{job.symbols.join(', ')}</span> : null}
                        <span>{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span className={`text-xs font-medium capitalize ${cfg.color}`}>{job.status}</span>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
