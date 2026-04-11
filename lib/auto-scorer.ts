import { createAdminClient } from './supabase/admin'
import { CIODecisionEngine } from './agents/cio-decision-engine'
import type { TradeContext } from './agents/types'
import { miroFishPredict } from './predictors/mirofish'

const cioEngine = new CIODecisionEngine()

interface UnscoredTrade {
  id: string
  trader_id: string
  symbol: string
  action: string
  asset_class: string
  notional_value: number | null
  trade_date: string
}

/**
 * Batch-scores unscored trader_trades with the 13-agent CIO engine.
 * Creates opportunities for high-confidence execute decisions.
 * Returns count of trades scored.
 */
export async function runAutoScoring(limit = 10): Promise<{ scored: number; errors: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { scored: 0, errors: ['ANTHROPIC_API_KEY not configured'] }
  }

  const supabase = createAdminClient()
  const errors: string[] = []

  // Fetch unscored trades
  const { data: trades, error: fetchErr } = await supabase
    .from('trader_trades')
    .select('id, trader_id, symbol, action, asset_class, notional_value, trade_date')
    .eq('cio_scored', false)
    .order('trade_date', { ascending: false })
    .limit(limit)

  if (fetchErr) return { scored: 0, errors: [fetchErr.message] }
  if (!trades?.length) return { scored: 0, errors: [] }

  let scored = 0

  for (const trade of trades as UnscoredTrade[]) {
    try {
      // Fetch trader info
      const { data: trader } = await supabase
        .from('traders')
        .select('name, handle, total_return_pct, win_rate_pct')
        .eq('id', trade.trader_id)
        .single()

      const context: TradeContext = {
        trade: {
          id: trade.id,
          symbol: trade.symbol,
          action: trade.action as TradeContext['trade']['action'],
          asset_class: trade.asset_class as TradeContext['trade']['asset_class'],
          notional_value: trade.notional_value ?? 5000,
          trader_name: trader?.name ?? 'Unknown',
          trader_handle: trader?.handle ?? '',
          trader_return_pct: trader?.total_return_pct ?? 0,
          trader_win_rate: trader?.win_rate_pct ?? 0,
        },
        user: {
          id: 'system',
          total_net_worth: 100000,
          portfolio: [],
          risk_profile: 'moderate',
        },
      }

      // Run MiroFish qualitative scenario in parallel with CIO analysis
      const [decision, miroScenario] = await Promise.all([
        cioEngine.analyze(context),
        miroFishPredict({
          symbol: trade.symbol,
          news_items: [`${trader?.name ?? 'Trader'} is ${trade.action}ing ${trade.symbol}`],
          forecast_days: 14,
        }),
      ])

      // Mark trade as scored
      await supabase
        .from('trader_trades')
        .update({ cio_scored: true })
        .eq('id', trade.id)

      // Bump score slightly if MiroFish agrees with the trade direction
      let adjustedScore = decision.finalScore
      if (miroScenario) {
        const tradeIsBuy = trade.action !== 'sell'
        const miroAgrees =
          (tradeIsBuy && miroScenario.outlook === 'bullish') ||
          (!tradeIsBuy && miroScenario.outlook === 'bearish')
        const miroDisagrees =
          (tradeIsBuy && miroScenario.outlook === 'bearish') ||
          (!tradeIsBuy && miroScenario.outlook === 'bullish')
        if (miroAgrees) adjustedScore = Math.min(100, adjustedScore + miroScenario.confidence * 5)
        if (miroDisagrees) adjustedScore = Math.max(0, adjustedScore - miroScenario.confidence * 5)
      }

      // Create opportunity for high-scoring execute decisions
      if (decision.decision === 'execute' && adjustedScore >= 68) {
        await supabase.from('opportunities').insert({
          source: 'cio',
          symbol: trade.symbol,
          asset_class: trade.asset_class,
          title: `${trader?.name ?? 'Trader'} → ${trade.action.toUpperCase()} ${trade.symbol}`,
          description: decision.plainEnglishSummary,
          action: trade.action === 'sell' ? 'sell' : 'buy',
          confidence: adjustedScore >= 80 ? 'high' : 'medium',
          score: adjustedScore,
          is_read: false,
          metadata: {
            trade_id: trade.id,
            trader_id: trade.trader_id,
            cio_decision: decision.decision,
            final_score: adjustedScore,
            mirofish_outlook: miroScenario?.outlook ?? null,
            mirofish_confidence: miroScenario?.confidence ?? null,
          },
        })
      }

      scored++
    } catch (err) {
      errors.push(`${trade.symbol}: ${err instanceof Error ? err.message : String(err)}`)
      // Still mark as scored to avoid infinite retry on broken trades
      await supabase
        .from('trader_trades')
        .update({ cio_scored: true })
        .eq('id', trade.id)
    }
  }

  return { scored, errors }
}
