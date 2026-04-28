/**
 * InsiderScoreClient -- NickNaskida-style 0-10 insider scoring.
 * Feature key: 'polymarket_insider_score'
 *
 * Score components:
 *   +3 if wallet age < 7 days
 *   +2 if market volume_24h < $50k
 *   +2 if trade size > $5k
 *   +2 if wallet has < 10 prior trades
 *   +1 if trade timing < 60 min before resolution
 *   Cap at 10
 */

export interface InsiderSignal {
  factor: string
  points: number
  detail: string
}

export interface InsiderScoreResult {
  score: number    // 0-10
  signals: InsiderSignal[]
}

export interface TradeInput {
  walletAddress: string
  walletAgeMs?: number        // milliseconds since wallet first trade
  priorTradeCount?: number    // total prior trades by this wallet
  tradeSizeUsd: number
  marketVolume24h: number
  minutesBeforeResolution?: number
}

/**
 * Score a single trade on the NickNaskida insider-indicator rubric.
 * High score (>= 7) suggests insider-like positioning.
 */
export function scoreTrade(trade: TradeInput): InsiderScoreResult {
  const signals: InsiderSignal[] = []
  let total = 0

  // +3: brand-new wallet (< 7 days old)
  if (trade.walletAgeMs !== undefined && trade.walletAgeMs < 7 * 24 * 60 * 60 * 1000) {
    const ageDays = (trade.walletAgeMs / 86_400_000).toFixed(1)
    signals.push({ factor: 'wallet_age', points: 3, detail: `Wallet age ${ageDays}d < 7d` })
    total += 3
  }

  // +2: thin market (volume < $50k -- harder for retail to know)
  if (trade.marketVolume24h < 50_000) {
    signals.push({
      factor: 'thin_market', points: 2,
      detail: `Market vol24h $${(trade.marketVolume24h / 1000).toFixed(0)}k < $50k`,
    })
    total += 2
  }

  // +2: large trade size (> $5k signals conviction or info asymmetry)
  if (trade.tradeSizeUsd > 5_000) {
    signals.push({
      factor: 'large_bet', points: 2,
      detail: `Trade size $${(trade.tradeSizeUsd / 1000).toFixed(0)}k > $5k`,
    })
    total += 2
  }

  // +2: virgin wallet (< 10 prior trades -- not an experienced trader)
  if (trade.priorTradeCount !== undefined && trade.priorTradeCount < 10) {
    signals.push({
      factor: 'virgin_wallet', points: 2,
      detail: `Only ${trade.priorTradeCount} prior trades -- unusual for size`,
    })
    total += 2
  }

  // +1: pre-resolution timing (< 60 min -- "last minute" bet)
  if (trade.minutesBeforeResolution !== undefined && trade.minutesBeforeResolution < 60) {
    signals.push({
      factor: 'pre_resolution_timing', points: 1,
      detail: `Placed ${trade.minutesBeforeResolution}min before resolution`,
    })
    total += 1
  }

  return { score: Math.min(10, total), signals }
}

/** Returns true if the score meets the insider-preference threshold. */
export function isInsiderLike(result: InsiderScoreResult, threshold = 7): boolean {
  return result.score >= threshold
}
