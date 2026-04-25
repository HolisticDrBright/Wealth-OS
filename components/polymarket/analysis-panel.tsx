'use client'

import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, BookOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PolymarketAnalysis } from '@/lib/agents/agents/polymarket-intelligence-agent'

interface Props {
  analysis: PolymarketAnalysis | null
  loading: boolean
  onClose: () => void
}

const SENTIMENT_CONFIG = {
  bullish: { label: 'Bullish', icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
  bearish: { label: 'Bearish', icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
  neutral: { label: 'Neutral', icon: Minus, color: 'text-gray-400', bg: 'bg-gray-500/10' },
}

const CONFIDENCE_COLOR = {
  high:   'bg-green-500/15 text-green-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low:    'bg-gray-500/15 text-gray-400',
}

export function AnalysisPanel({ analysis, loading, onClose }: Props) {
  const sentiment = analysis ? SENTIMENT_CONFIG[analysis.sentiment] : null

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20">
            <BookOpen className="h-4 w-4 text-indigo-400" />
          </div>
          <span className="text-sm font-semibold text-white">AI Intelligence Brief</span>
          <span className="text-xs text-indigo-400/60">· PolymarketIntelligenceAgent</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          <p className="text-sm text-gray-400">
            Fetching market context and running analysis…
          </p>
        </div>
      )}

      {/* Analysis content */}
      {!loading && analysis && (
        <div className="flex flex-col gap-5">
          {/* Summary + sentiment */}
          <div className="flex items-start gap-3">
            <p className="flex-1 text-sm leading-relaxed text-gray-300">{analysis.summary}</p>
            {sentiment && (
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  sentiment.bg,
                  sentiment.color
                )}
              >
                <sentiment.icon className="h-3.5 w-3.5" />
                {sentiment.label}
              </span>
            )}
          </div>

          {/* Opportunities */}
          {analysis.opportunities.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Top opportunities
              </p>
              <div className="space-y-2">
                {analysis.opportunities.map((opp, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
                        opp.side === 'YES'
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-red-500/15 text-red-400'
                      )}
                    >
                      {opp.side}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-white line-clamp-1">{opp.question}</p>
                      <p className="mt-0.5 text-xs text-gray-400">{opp.rationale}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        CONFIDENCE_COLOR[opp.confidence]
                      )}
                    >
                      {opp.confidence}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Portfolio assessment */}
          {analysis.portfolioAssessment && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Portfolio
              </p>
              <p className="text-sm text-gray-400">{analysis.portfolioAssessment}</p>
            </div>
          )}

          {/* Risk warnings */}
          {analysis.riskWarnings.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Risk warnings
              </p>
              <div className="space-y-1.5">
                {analysis.riskWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vault path */}
          {analysis.vaultPath && (
            <p className="text-xs text-gray-600">
              Brief saved to vault: <span className="font-mono">{analysis.vaultPath}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
