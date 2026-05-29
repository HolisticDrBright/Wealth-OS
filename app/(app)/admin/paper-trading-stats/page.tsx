export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import {
  getTradesByStrategy,
  getPnlByStrategy,
  getOpenPositions,
  getExitReasonBreakdown,
} from '@/lib/admin/paper-trading-queries'
import { RefreshCw } from 'lucide-react'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((e: string) => e.trim()).filter(Boolean)
  if (adminEmails.length > 0 && !adminEmails.includes(user.email ?? '')) {
    redirect('/')
  }
}

function Table({ title, rows, columns }: {
  title: string
  rows: Record<string, unknown>[]
  columns: { key: string; label: string; fmt?: (v: unknown) => string }[]
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h2>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No data yet — run some paper trades first.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {columns.map(c => (
                  <th key={String(c.key)} className="text-left px-4 py-2 text-xs font-medium text-gray-400 uppercase">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  {columns.map(c => (
                    <td key={String(c.key)} className="px-4 py-2 text-gray-300 font-mono text-xs">
                      {c.fmt ? c.fmt(row[c.key]) : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function fmtUsd(v: unknown) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`
}
function fmtPct(v: unknown) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${(n * 100).toFixed(2)}%`
}

export default async function PaperTradingStatsPage() {
  await requireAdmin()

  const supabase = createAdminClient()
  const [tradesByStrategy, pnlByStrategy, openPositions, exitReasons] = await Promise.all([
    getTradesByStrategy(supabase),
    getPnlByStrategy(supabase),
    getOpenPositions(supabase),
    getExitReasonBreakdown(supabase),
  ])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Paper-Trading Stats</h1>
          <p className="text-sm text-gray-500 mt-1">Last 7 days · Admin only</p>
        </div>
        <form action="/admin/paper-trading-stats">
          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </form>
      </div>

      <Table
        title="a. Trades fired per strategy (last 7 days)"
        rows={tradesByStrategy as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'strategy_key', label: 'Strategy' },
          { key: 'trade_count', label: 'Trades' },
          { key: 'wins', label: 'Wins' },
          { key: 'losses', label: 'Losses' },
          { key: 'total_pnl_usd', label: 'Total P&L', fmt: fmtUsd },
        ]}
      />

      <Table
        title="b. P&L by strategy (last 7 days)"
        rows={pnlByStrategy as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'strategy_key', label: 'Strategy' },
          { key: 'realized_pnl_usd', label: 'Realized P&L', fmt: fmtUsd },
          { key: 'avg_pnl_pct', label: 'Avg %', fmt: fmtPct },
          { key: 'trade_count', label: 'Trades' },
        ]}
      />

      <Table
        title="c. Open positions snapshot"
        rows={openPositions as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'strategy_key', label: 'Strategy' },
          { key: 'symbol', label: 'Symbol' },
          { key: 'asset_class', label: 'Asset' },
          { key: 'direction', label: 'Dir' },
          { key: 'notional_usd', label: 'Notional', fmt: v => `$${Number(v).toFixed(0)}` },
          { key: 'opened_at', label: 'Opened', fmt: v => new Date(String(v)).toLocaleString() },
        ]}
      />

      <Table
        title="d. Exit-reason breakdown (last 7 days)"
        rows={exitReasons as unknown as Record<string, unknown>[]}
        columns={[
          { key: 'close_reason', label: 'Reason' },
          { key: 'count', label: 'Count' },
        ]}
      />
    </div>
  )
}
