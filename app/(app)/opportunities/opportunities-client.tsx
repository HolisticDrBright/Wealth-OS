'use client'

import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { markOpportunityRead } from '@/lib/actions/opportunities'
import type { Opportunity } from '@/lib/types'
import type { NoTradeEntry } from '@/lib/actions/no-trade-ledger'
import { OpportunityCard, type OppCardData } from '@/components/opportunities/OpportunityCard'
import { CIODecisionModal } from '@/components/agents/cio-decision-modal'
import { NoTradeLedger } from '@/components/opportunities/NoTradeLedger'
import { EmptyState } from '@/components/ui/states'
import type { TradeContext } from '@/lib/agents/types'
import { Lightbulb, Search, FlaskConical, X } from 'lucide-react'

type ReviewTradeContext = React.ComponentProps<typeof CIODecisionModal>['tradeContext']

interface Props {
  initialOpportunities: Opportunity[]
  noTradeEntries: NoTradeEntry[]
  userId: string
}

type MainTab = 'opportunities' | 'ledger'
type Filter = 'all' | 'high' | 'unread'

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'ledger', label: 'No-Trade Ledger' },
]

/** Map an Opportunity row to the canonical OpportunityCard data shape. */
function toCardData(opp: Opportunity): OppCardData {
  // `score` is a 0-100 confidence number, NOT an expected edge — surface it as a
  // score summary rather than faking an edge percentage.
  const hasScore = typeof opp.score === 'number' && Number.isFinite(opp.score)
  return {
    id: opp.id,
    action: opp.action ? opp.action.toUpperCase() : undefined,
    symbol: opp.symbol,
    title: opp.title,
    assetClass: opp.asset_class,
    whyNow: opp.description,
    expectedEdgePct: undefined,
    maturity: undefined,
    agentSummary: hasScore ? `Score ${Math.round(opp.score as number)}/100` : undefined,
    tradeability: 'paper_only',
  }
}

/** Normalize an opportunity's asset class to a TradeContext asset class. */
function toContextAssetClass(ac?: string): TradeContext['trade']['asset_class'] {
  switch (ac) {
    case 'crypto':
    case 'forex':
    case 'polymarket':
      return ac
    default:
      return 'stock'
  }
}

/** Normalize an opportunity action to a TradeContext trade action. */
function toContextAction(action?: Opportunity['action']): TradeContext['trade']['action'] {
  return action === 'sell' ? 'sell' : 'buy'
}

export function OpportunitiesClient({ initialOpportunities, noTradeEntries, userId }: Props) {
  const [tab, setTab] = useState<MainTab>('opportunities')
  const [opportunities, setOpportunities] = useState(initialOpportunities)
  const [filter, setFilter] = useState<Filter>('all')

  const [screenerSymbol, setScreenerSymbol] = useState('')
  const [isScreening, setIsScreening] = useState(false)
  const [screenerError, setScreenerError] = useState<string | null>(null)

  const [reviewOpp, setReviewOpp] = useState<Opportunity | null>(null)
  const [paperNotice, setPaperNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const canReview = userId.length > 0

  const filtered = useMemo(
    () =>
      opportunities.filter(o => {
        if (filter === 'high') return o.confidence === 'high'
        if (filter === 'unread') return !o.is_read
        return true
      }),
    [opportunities, filter],
  )

  const unreadCount = opportunities.filter(o => !o.is_read).length

  async function runScreener() {
    if (!screenerSymbol.trim()) return
    setIsScreening(true)
    setScreenerError(null)
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: screenerSymbol.toUpperCase().trim(), asset_class: 'stock' }),
      })
      const envelope = await res.json()
      if (!res.ok) throw new Error(envelope.error ?? 'Screener failed')
      if (envelope.data) {
        setOpportunities(prev => [envelope.data, ...prev])
        setScreenerSymbol('')
      }
    } catch (err) {
      setScreenerError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsScreening(false)
    }
  }

  function handleReview(id: string) {
    if (!canReview) return
    const opp = opportunities.find(o => o.id === id)
    if (opp) setReviewOpp(opp)
  }

  function handlePaperTrade(id: string) {
    const opp = opportunities.find(o => o.id === id)
    startTransition(async () => {
      await markOpportunityRead(id)
      setOpportunities(prev => prev.map(o => (o.id === id ? { ...o, is_read: true } : o)))
    })
    setPaperNotice(
      opp?.symbol ? `${opp.symbol} queued for paper review` : 'Queued for paper review',
    )
  }

  const tradeContext: ReviewTradeContext | null = reviewOpp
    ? {
        trade: {
          symbol: reviewOpp.symbol ?? 'SPY',
          action: toContextAction(reviewOpp.action),
          asset_class: toContextAssetClass(reviewOpp.asset_class),
          notional_value: 1000,
          trader_name: '',
          trader_handle: '',
          trader_return_pct: 0,
          trader_win_rate: 0,
        },
        user: { id: userId },
      }
    : null

  return (
    <div className="space-y-4">
      {/* Main tabs (segmented control) */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {MAIN_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all',
              tab === t.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white',
            )}
          >
            {t.label}
            {t.id === 'ledger' && noTradeEntries.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-500">({noTradeEntries.length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'opportunities' ? (
        <div className="space-y-4">
          {/* AI Screener */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              AI Screener
            </p>
            <div className="flex gap-3">
              <Input
                placeholder="Symbol (e.g. AAPL, BTC)"
                value={screenerSymbol}
                onChange={e => setScreenerSymbol(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runScreener()}
                className="flex-1 min-w-0"
              />
              <Button onClick={runScreener} disabled={isScreening || !screenerSymbol.trim()}>
                <Search className="mr-2 h-4 w-4" />
                {isScreening ? 'Analyzing...' : 'Screen'}
              </Button>
            </div>
            {screenerError && <p className="mt-2 text-xs text-red-400">{screenerError}</p>}
          </div>

          {/* Paper-trade confirmation banner */}
          {paperNotice && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-xs text-indigo-200">
                <FlaskConical className="h-3.5 w-3.5 shrink-0" />
                {paperNotice} — no real order was placed.
              </span>
              <button
                type="button"
                onClick={() => setPaperNotice(null)}
                className="shrink-0 text-indigo-300/70 hover:text-indigo-200"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Not-signed-in note */}
          {!canReview && (
            <p className="text-[11px] text-gray-500">
              Sign in to run an Investment Committee review on these ideas.
            </p>
          )}

          {/* Filter chips */}
          <div className="flex items-center gap-2">
            {(['all', 'high', 'unread'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f
                    ? 'border border-indigo-500/30 bg-indigo-600/20 text-indigo-400'
                    : 'text-gray-500 hover:text-white',
                )}
              >
                {f === 'all'
                  ? `All (${opportunities.length})`
                  : f === 'high'
                    ? 'High confidence'
                    : `Unread (${unreadCount})`}
              </button>
            ))}
          </div>

          {/* List */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No opportunities yet"
              hint="Use the AI Screener above to analyze a symbol, or wait for the sync worker to surface new ideas."
            />
          ) : (
            <div className="space-y-3">
              {filtered.map(opp => (
                <OpportunityCard
                  key={opp.id}
                  opp={toCardData(opp)}
                  onReview={canReview ? handleReview : undefined}
                  onPaperTrade={handlePaperTrade}
                  className={opp.is_read ? 'opacity-60' : undefined}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <NoTradeLedger entries={noTradeEntries} />
      )}

      {/* Investment Committee review modal */}
      {reviewOpp && tradeContext && (
        <CIODecisionModal
          open={!!reviewOpp}
          onClose={() => setReviewOpp(null)}
          tradeContext={tradeContext}
        />
      )}
    </div>
  )
}
