/**
 * Wash-sale rule: if you sell a security at a loss and buy the same (or substantially
 * identical) security within 30 days before or after the sale, the loss is disallowed.
 */

export interface WashSaleResult {
  has_wash_sale_risk: boolean
  reason?: string
  window_start: string
  window_end: string
}

interface TradeLike {
  symbol: string
  action: string
  trade_date: string
}

/**
 * Check if harvesting a loss on `symbol` would trigger a wash sale.
 * Looks for any buy of the same symbol within 30 days before or after today.
 */
export function checkWashSaleRisk(
  symbol: string,
  recentTrades: TradeLike[]
): WashSaleResult {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Check for any buy of the same symbol within the 30-day window
  const conflictingTrade = recentTrades.find(t => {
    if (t.symbol.toUpperCase() !== symbol.toUpperCase()) return false
    if (!['buy', 'cover'].includes(t.action)) return false
    const tradeDate = new Date(t.trade_date)
    return tradeDate >= windowStart && tradeDate <= windowEnd
  })

  return {
    has_wash_sale_risk: !!conflictingTrade,
    reason: conflictingTrade
      ? `Buy of ${symbol} on ${new Date(conflictingTrade.trade_date).toLocaleDateString()} falls within 30-day wash-sale window`
      : undefined,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  }
}

/** Map a symbol to a reasonable replacement that maintains similar exposure */
export function suggestReplacement(symbol: string, assetClass: string): string | undefined {
  const replacements: Record<string, string> = {
    // ETF proxies for stocks
    AAPL: 'MSFT', MSFT: 'GOOGL', GOOGL: 'META', TSLA: 'RIVN', NVDA: 'AMD',
    SPY: 'VOO', QQQ: 'ONEQ', IWM: 'VBR',
    // Crypto — different coin same sector
    BTC: 'ETH', ETH: 'BTC', SOL: 'AVAX', AVAX: 'SOL', MATIC: 'ARB',
  }
  return replacements[symbol.toUpperCase()]
}
