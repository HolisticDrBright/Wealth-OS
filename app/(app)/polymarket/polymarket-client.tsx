'use client'

import { useState, useEffect } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { ServiceStatusBanner } from '@/components/polymarket/service-status-banner'
import { MarketsTab } from '@/components/polymarket/markets-tab'
import { SignalsTab } from '@/components/polymarket/signals-tab'
import { PositionsTab } from '@/components/polymarket/positions-tab'
import { AnalysisPanel } from '@/components/polymarket/analysis-panel'
import { createMetaPolyWS, metaPolyWsUrl } from '@/lib/meta-poly/ws'
import type { MetaPolyWS, WsStatus } from '@/lib/meta-poly/ws'
import type {
  HealthResponse,
  Market,
  Signal,
  PortfolioPosition,
  PortfolioStats,
  SettingsResponse,
} from '@/lib/meta-poly/types'
import type { PolymarketAnalysis } from '@/lib/agents/agents/polymarket-intelligence-agent'
import { recordPolyTradeAction } from '@/lib/actions/polymarket'
import { Brain, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'markets' | 'signals' | 'positions' | 'whale' | 'entropy'

const TABS: { id: Tab; label: string }[] = [
  { id: 'markets',   label: 'Markets' },
  { id: 'signals',   label: 'Signals' },
  { id: 'positions', label: 'Positions' },
  { id: 'whale',     label: 'Whale Activity' },
  { id: 'entropy',   label: 'Entropy' },
]

interface Props {
  initialHealth: HealthResponse
  initialMarkets: Market[]
  initialSignals: Signal[]
  initialPositions: PortfolioPosition[]
  initialStats: PortfolioStats | null
  initialSettings: SettingsResponse | null
  circuitFailures: number
  circuitOpen: boolean
  circuitRetriesInMs: number
}

const FALLBACK_STATS: PortfolioStats = {
  balance: 0,
  starting_capital: 0,
  total_exposure: 0,
  unrealized_pnl: 0,
  realized_pnl: 0,
  win_rate: 0,
  sharpe_ratio: 0,
  max_drawdown: 0,
  trades_today: 0,
  paper_trading: true,
  markets_count: 0,
  positions_count: 0,
  pending_signals: 0,
  scheduler_running: false,
}

export function PolymarketClient({
  initialHealth,
  initialMarkets,
  initialSignals,
  initialPositions,
  initialStats,
  initialSettings,
  circuitFailures,
  circuitOpen,
  circuitRetriesInMs,
}: Props) {
  const [tab, setTab] = useState<Tab>('markets')
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [paperTrading, setPaperTrading] = useState(initialHealth.paper_trading)
  const [schedulerRunning, setSchedulerRunning] = useState(initialHealth.scheduler_running)
  const [analysing, setAnalysing] = useState(false)
  const [analysis, setAnalysis] = useState<PolymarketAnalysis | null>(null)
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(false)

  async function runAnalysis() {
    setAnalysing(true)
    setAnalysisPanelOpen(true)
    try {
      const res = await fetch('/api/polymarket/analyze', { method: 'POST' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Request failed' }))
        setAnalysis({
          summary: error ?? 'Analysis failed.',
          opportunities: [],
          portfolioAssessment: '',
          riskWarnings: [],
          sentiment: 'neutral',
          vaultPath: null,
        })
      } else {
        setAnalysis(await res.json())
      }
    } catch {
      setAnalysis({
        summary: 'Network error — could not reach the analysis endpoint.',
        opportunities: [],
        portfolioAssessment: '',
        riskWarnings: [],
        sentiment: 'neutral',
        vaultPath: null,
      })
    } finally {
      setAnalysing(false)
    }
  }

  // Open WebSocket and keep banner in sync
  useEffect(() => {
    const url = metaPolyWsUrl()
    let ws: MetaPolyWS | null = null

    ws = createMetaPolyWS(
      url,
      {
        vpn_drop: () => {
          setWsStatus('disconnected')
        },
        trade: (data) => {
          setPaperTrading(data.paper)
          // Fire-and-forget vault decision note (best-effort)
          recordPolyTradeAction(data).catch(() => undefined)
        },
      },
      setWsStatus,
    )

    return () => ws?.close()
  }, [])

  return (
    <div className="flex flex-col">
      <Topbar title="Polymarket" subtitle="Prediction market intelligence via Meta_Poly_tarder" />

      <div className="flex flex-col gap-4 p-6">
        {/* Service status + analyse button */}
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <ServiceStatusBanner
              paperTrading={paperTrading}
              schedulerRunning={schedulerRunning}
              circuitOpen={circuitOpen}
              circuitFailures={circuitFailures}
              circuitRetriesInMs={circuitRetriesInMs}
              wsStatus={wsStatus}
            />
          </div>
          <button
            onClick={runAnalysis}
            disabled={analysing}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-sm font-medium text-indigo-300 transition-all hover:bg-indigo-500/20 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analysing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            {analysing ? 'Analysing…' : 'AI Analysis'}
          </button>
        </div>

        {/* Analysis panel */}
        {analysisPanelOpen && (
          <AnalysisPanel
            analysis={analysis}
            loading={analysing}
            onClose={() => setAnalysisPanelOpen(false)}
          />
        )}

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                tab === t.id
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[400px]">
          {tab === 'markets'   && <MarketsTab initialMarkets={initialMarkets} />}
          {tab === 'signals'   && <SignalsTab initialSignals={initialSignals} />}
          {tab === 'positions' && (
            <PositionsTab
              initialPositions={initialPositions}
              initialStats={initialStats ?? FALLBACK_STATS}
              initialSettings={initialSettings}
            />
          )}
          {tab === 'whale'     && <WhalePlaceholder />}
          {tab === 'entropy'   && <EntropyPlaceholder />}
        </div>
      </div>
    </div>
  )
}



function WhalePlaceholder() {
  return <TabShell label="Whale Activity" description="Smart money leaderboard and trade feed — coming in next build step." />
}

function EntropyPlaceholder() {
  return <TabShell label="Entropy" description="Top entropy-scored markets — coming in next build step." />
}

function TabShell({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 py-20 text-center">
      <p className="text-lg font-semibold text-white">{label}</p>
      <p className="text-sm text-gray-400 max-w-xs">{description}</p>
    </div>
  )
}
