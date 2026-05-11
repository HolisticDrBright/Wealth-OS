/**
 * Aave MCP integration — wired but inactive.
 *
 * Activate by setting "disabled": false in the aave-mcp entry in .mcp.json
 * when defi_yield_stack or pendle_pt_fixed_yield is implemented.
 * MCP server: npx @junct-bot/aave-mcp
 * See docs/mcp-servers.md for full activation instructions.
 */

export interface AaveReserveData {
  asset:         string
  supplyAPY:     number  // annual yield earned by lenders, e.g. 0.045 = 4.5%
  borrowAPY:     number  // annual cost paid by borrowers
  utilization:   number  // borrowedSupply / totalSupply, 0–1
  totalSupplied: number  // USD notional
  totalBorrowed: number  // USD notional
}

/**
 * Fetch live reserve data for a single asset from the Aave protocol.
 * Throws until the Aave MCP server is enabled in .mcp.json.
 */
export async function getReserveData(_asset: string): Promise<AaveReserveData> {
  throw new Error(
    'Aave MCP not enabled — set "disabled": false in the aave-mcp entry in .mcp.json. ' +
    'See docs/mcp-servers.md for activation instructions.'
  )
}
