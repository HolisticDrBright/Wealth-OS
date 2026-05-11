/**
 * Uniswap PoolSpy MCP integration — wired but inactive.
 *
 * Activate by setting "disabled": false in the uniswap-poolspy-mcp entry in .mcp.json
 * when memecoin_bondingcurve is implemented.
 * MCP server: npx @kukapay/uniswap-poolspy-mcp
 * See docs/mcp-servers.md for full activation instructions.
 */

export interface NewPool {
  chain:                string   // e.g. 'ethereum', 'base', 'arbitrum'
  pairAddress:          string
  token0:               string   // symbol or address
  token1:               string
  createdAt:            string   // ISO 8601 timestamp
  initialLiquidityUsd:  number
}

/**
 * Fetch newly created Uniswap pools above a minimum liquidity threshold.
 * Throws until the Uniswap PoolSpy MCP server is enabled in .mcp.json.
 */
export async function getNewPools(
  _chains: string[],
  _minLiquidityUsd: number,
): Promise<NewPool[]> {
  throw new Error(
    'Uniswap PoolSpy MCP not enabled — set "disabled": false in the uniswap-poolspy-mcp entry in .mcp.json. ' +
    'See docs/mcp-servers.md for activation instructions.'
  )
}
