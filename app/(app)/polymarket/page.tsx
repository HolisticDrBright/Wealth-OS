export const dynamic = 'force-dynamic'

import {
  getHealth,
  getActiveMarkets,
  getSignals,
  getPortfolio,
  getSettings,
  getCircuitState,
} from '@/lib/meta-poly/client'
import { PolymarketClient } from './polymarket-client'
import { Topbar } from '@/components/layout/topbar'
import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'
import { AssetRiskProfile } from '@/components/risk-profile/AssetRiskProfile'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'
import { Terminal, ExternalLink } from 'lucide-react'

export default async function PolymarketPage() {
  const [healthRes, marketsRes, signalsRes, portfolioRes, settingsRes, circuit, riskData] =
    await Promise.all([
      getHealth(),
      getActiveMarkets({ limit: 100 }),
      getSignals({ limit: 50 }),
      getPortfolio(),
      getSettings(),
      Promise.resolve(getCircuitState()),
      getAssetRiskProfileData('polymarket').catch(() => null),
    ])

  const riskPanel = riskData ? (
    <div className="px-4 pt-6 pb-2 max-w-4xl mx-auto">
      <AssetRiskProfile
        assetClass="polymarket"
        profiles={riskData.profiles}
        userProfile={riskData.userProfile}
        strategyDefs={riskData.strategyDefs}
        migrationApplied={riskData.migrationApplied}
      />
    </div>
  ) : null

  if (!healthRes.ok) {
    return (
      <div className="flex flex-col">
        {riskPanel}
        <SetupGuide errorCode={healthRes.error.code} errorMessage={healthRes.error.message} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {riskPanel}
      <PolymarketClient
        initialHealth={healthRes.value}
        initialMarkets={marketsRes.ok ? marketsRes.value : []}
        initialSignals={signalsRes.ok ? signalsRes.value.signals : []}
        initialPositions={portfolioRes.ok ? portfolioRes.value.positions.positions : []}
        initialStats={portfolioRes.ok ? portfolioRes.value.stats : null}
        initialSettings={settingsRes.ok ? settingsRes.value : null}
        circuitFailures={circuit.failures}
        circuitOpen={circuit.open}
        circuitRetriesInMs={circuit.retriesInMs}
      />
    </div>
  )
}

function SetupGuide({ errorCode, errorMessage }: { errorCode: string; errorMessage: string }) {
  const isUnreachable = errorCode === 'UNREACHABLE' || errorCode === 'TIMEOUT'
  const isCircuitOpen = errorCode === 'CIRCUIT_OPEN'

  return (
    <div className="flex flex-col">
      <Topbar title="Polymarket" subtitle="Prediction market intelligence" />
      <div className="flex flex-col items-center justify-center gap-6 p-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <Terminal className="h-8 w-8 text-indigo-400" />
        </div>

        <div className="text-center">
          <h2 className="text-xl font-bold text-white">
            {isCircuitOpen ? 'Sidecar temporarily unavailable' : 'Meta_Poly_tarder not running'}
          </h2>
          <p className="mt-2 text-sm text-gray-400 max-w-md">
            {isCircuitOpen
              ? errorMessage
              : 'The Polymarket intelligence sidecar is not reachable. Start it locally to enable live market data, signals, and portfolio tracking.'}
          </p>
          {!isUnreachable && !isCircuitOpen && (
            <p className="mt-1 text-xs text-gray-600">{errorMessage}</p>
          )}
        </div>

        {(isUnreachable || !isCircuitOpen) && (
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Quick start
            </p>
            <div className="space-y-2 font-mono text-sm">
              {[
                'git clone https://github.com/HolisticDrBright/Meta_Poly_tarder',
                'cd Meta_Poly_tarder',
                'cp .env.example .env',
                'pip install -r requirements.txt',
                'python -m uvicorn backend.main:app --port 8000',
              ].map((cmd, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-indigo-400 select-none">$</span>
                  <span className="text-gray-300 break-all">{cmd}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Set</span>
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-gray-300">
            META_POLY_URL=http://localhost:8000
          </code>
          <span>in .env.local · see</span>
          <a
            href="/docs/polymarket-setup.md"
            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            setup guide <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Paper trading toggles — available even when sidecar is offline */}
      <div className="px-6 pb-6">
        <AssetStrategyPanel assetClasses={['polymarket']} />
      </div>
    </div>
  )
}
