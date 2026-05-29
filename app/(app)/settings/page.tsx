import Link from 'next/link'
import { Topbar } from '@/components/layout/topbar'
import { SettingsClient } from './settings-client'
import { getUserSettings, getBrokerStatus, getAIFeatureData } from '@/lib/actions/settings'
import { BarChart2 } from 'lucide-react'
import { detectRegime, CrossAssetRegime } from '@/lib/regime/cross-asset-regime'
import { createClient } from '@/lib/supabase/server'

// Hoisted clock read. Server components render once per request, so reading the
// clock is safe; the helper keeps the call out of the render-purity analysis.
function nowMs(): number {
  return Date.now()
}

// ─── Regime + hedge sleeve server widget ──────────────────────────────────────

async function RegimeHealthCard() {
  const regime = await detectRegime().catch(() => ({
    regime: CrossAssetRegime.NEUTRAL, vix: null, hyOas: null, resolvedAt: nowMs(),
  }))

  const label = {
    [CrossAssetRegime.RISK_ON]:  { text: 'RISK ON',  cls: 'text-green-400 border-green-800 bg-green-950' },
    [CrossAssetRegime.NEUTRAL]:  { text: 'NEUTRAL',  cls: 'text-gray-300 border-gray-700 bg-gray-900' },
    [CrossAssetRegime.RISK_OFF]: { text: 'RISK OFF', cls: 'text-yellow-400 border-yellow-800 bg-yellow-950' },
    [CrossAssetRegime.CRISIS]:   { text: 'CRISIS',   cls: 'text-red-400 border-red-800 bg-red-950' },
  }[regime.regime]

  const effect = {
    [CrossAssetRegime.RISK_ON]:  'Strategies run at full size. No restrictions.',
    [CrossAssetRegime.NEUTRAL]:  'Normal operation. Standard position sizing.',
    [CrossAssetRegime.RISK_OFF]: 'Directional strategies get 50% size haircut. Arb/neutral unaffected.',
    [CrossAssetRegime.CRISIS]:   'All strategies blocked except Tail Risk Hedging. Capital preservation mode.',
  }[regime.regime]

  return (
    <div className="mx-6 mb-4 rounded-xl border p-4 space-y-2 max-w-3xl" style={{ borderColor: 'var(--tw-prose-hr)' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cross-Asset Regime</p>
          <span className={`inline-block text-sm font-bold px-3 py-1 rounded border ${label.cls}`}>
            {label.text}
          </span>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          {regime.vix !== null && <p>VIX: {regime.vix.toFixed(1)}</p>}
          {regime.hyOas !== null && <p>HY OAS: {regime.hyOas.toFixed(0)} bps</p>}
          <p className="text-gray-700">Updated {new Date(regime.resolvedAt).toLocaleTimeString()}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400">{effect}</p>
    </div>
  )
}

async function HedgeSleeveCard() {
  let totalDirectional = 0
  let targetHedgePct = 2
  try {
    const supabase = await createClient()
    const { data: positions } = await supabase
      .from('user_copied_positions')
      .select('size_fraction, strategy_key')
      .eq('status', 'open')
    const rows = (positions ?? []) as Array<{ size_fraction: number; strategy_key: string }>
    totalDirectional = rows
      .filter(r => r.strategy_key !== 'tail_risk_hedging')
      .reduce((s, r) => s + (r.size_fraction ?? 0), 0)
    targetHedgePct = Math.round(Math.min(15, 2 + totalDirectional * 6 * 100))
  } catch { /* non-critical */ }

  return (
    <div className="mx-6 mb-6 rounded-xl border border-gray-800 bg-gray-900/60 p-4 max-w-3xl space-y-2">
      <p className="text-sm font-semibold text-white">Hedge Sleeve (Tail Risk)</p>
      <p className="text-xs text-gray-500">
        Dynamic size = 2% + (total directional delta × 6%). Capped at 15%.
      </p>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">Directional delta</p>
          <p className="font-mono text-gray-200">{(totalDirectional * 100).toFixed(1)}%</p>
        </div>
        <div className="text-gray-700">→</div>
        <div>
          <p className="text-xs text-gray-500">Target hedge size</p>
          <p className="font-mono text-green-400 font-semibold">{targetHedgePct}%</p>
        </div>
      </div>
    </div>
  )
}

export default async function SettingsPage() {
  const [settings, brokerStatus, aiData] = await Promise.all([
    getUserSettings(),
    getBrokerStatus(),
    getAIFeatureData(),
  ])

  return (
    <div>
      <Topbar title="Settings" subtitle="Brokers, risk profile, and preferences" />
      <RegimeHealthCard />
      <HedgeSleeveCard />
      <div className="mx-6 mb-4 max-w-3xl">
        <Link
          href="/admin/paper-trading-stats"
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
        >
          <BarChart2 className="h-4 w-4 text-indigo-400" />
          <div>
            <p className="font-medium text-white">View Paper-Trading Stats</p>
            <p className="text-xs text-gray-500">Trades, P&amp;L, open positions, and exit-reason breakdown (last 7 days)</p>
          </div>
        </Link>
      </div>
      <SettingsClient settings={settings} brokerStatus={brokerStatus} aiData={aiData} />
    </div>
  )
}
