/**
 * CCXT MCP configuration.
 *
 * CCXT MCP is for research and data only. Execution goes through lib/broker-adapters/.
 *
 * Allowed: read-only data fetching — tickers, order books, OHLCV, funding rates, balances.
 * Blocked: any tool that modifies exchange state (orders, withdrawals, transfers).
 *
 * MCP server: npx @lazy-dinosaur/ccxt-mcp  (wired in .mcp.json)
 */

export const ALLOWED_EXCHANGES = [
  'binance', 'bybit', 'okx', 'coinbase', 'kraken', 'kucoin', 'gate', 'mexc', 'bitget', 'htx',
] as const
export type AllowedExchange = typeof ALLOWED_EXCHANGES[number]

export const ALLOWED_TOOLS = [
  'fetchTicker',
  'fetchOrderBook',
  'fetchFundingRate',
  'fetchOHLCV',
  'fetchTrades',
  'fetchBalance',
  'fetchMarkets',
  'fetchCurrencies',
] as const
export type AllowedTool = typeof ALLOWED_TOOLS[number]

// Explicitly excluded — trade execution stays in lib/broker-adapters/
const BLOCKED_WRITE_TOOLS = new Set([
  'createOrder',
  'cancelOrder',
  'editOrder',
  'withdraw',
  'transfer',
  'createDepositAddress',
])

/**
 * Guard that validates a tool name before it is sent to the CCXT MCP server.
 * Returns the typed tool name on success; throws on write tools and unknown tools
 * so callers can never accidentally dispatch trades via the MCP path.
 */
export function buildClient(toolName: string): AllowedTool {
  if (BLOCKED_WRITE_TOOLS.has(toolName)) {
    throw new Error(
      `[ccxt-mcp] "${toolName}" is a write tool — blocked. ` +
      `CCXT MCP is read-only. Trade execution goes through lib/broker-adapters/.`
    )
  }
  if (!(ALLOWED_TOOLS as readonly string[]).includes(toolName)) {
    throw new Error(
      `[ccxt-mcp] Unknown tool "${toolName}". Allowed read-only tools: ${ALLOWED_TOOLS.join(', ')}`
    )
  }
  return toolName as AllowedTool
}
