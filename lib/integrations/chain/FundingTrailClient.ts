/**
 * FundingTrailClient -- wallet funding-trail tracing.
 * Methodology: pselamy/polymarket-insider-tracker
 *
 * Backed by free Etherscan + Polygonscan APIs (no-key tier: 5 req/s).
 * For Polymarket, traces via Polygon mainnet.
 *
 * Feature key: 'wallet_funding_trail'
 */

export type FundingSource =
  | 'binance_hot'
  | 'coinbase_hot'
  | 'kraken_hot'
  | 'mixer'
  | 'known_whale'
  | 'unknown'

export interface FundingHop {
  address: string
  label?: string
  amountEth?: number
}

export interface FundingTrailResult {
  source: FundingSource
  hops: FundingHop[]
  confidenceScore: number   // 0-1
}

// Known hot-wallet address prefixes/labels (simplified -- production uses full list)
const KNOWN_HOT_WALLETS: Record<string, FundingSource> = {
  '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be': 'binance_hot',  // Binance 1
  '0xd551234ae421e3bcba99a0da6d736074f22192ff': 'binance_hot',  // Binance 2
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'coinbase_hot', // Coinbase 1
  '0xa090e606e30bd747d4e6245a1517ebe430f0057e': 'coinbase_hot', // Coinbase 2
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': 'kraken_hot',   // Kraken 1
}

const POLYGONSCAN_BASE = 'https://api.polygonscan.com/api'

/**
 * Trace the funding source of a Polygon wallet address up to maxHops hops.
 * Uses Polygonscan (free, no key for basic queries).
 */
export async function traceFundingSource(
  walletAddress: string,
  maxHops = 3
): Promise<FundingTrailResult> {
  const hops: FundingHop[] = []
  let currentAddress = walletAddress.toLowerCase()

  for (let hop = 0; hop < maxHops; hop++) {
    let parentAddress: string | null = null

    try {
      const apiKey = process.env.POLYGONSCAN_API_KEY ?? ''
      const url = `${POLYGONSCAN_BASE}?module=account&action=txlist&address=${currentAddress}&sort=asc&page=1&offset=1${apiKey ? `&apikey=${apiKey}` : ''}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) break

      const data = await res.json() as {
        status: string
        result?: Array<{ from: string; to: string; value: string }>
      }
      if (data.status !== '1' || !data.result?.length) break

      // First incoming tx = funding source
      const first = data.result[0]
      parentAddress = first.from?.toLowerCase() ?? null
      if (!parentAddress) break

      hops.push({ address: parentAddress, amountEth: parseFloat(first.value) / 1e18 })

      // Check if this is a known hot wallet
      const known = KNOWN_HOT_WALLETS[parentAddress]
      if (known) {
        return {
          source: known,
          hops,
          confidenceScore: 0.85,
        }
      }

      currentAddress = parentAddress
    } catch {
      break
    }
  }

  // Check final address against known wallets
  const finalKnown = KNOWN_HOT_WALLETS[currentAddress]
  if (finalKnown) {
    return { source: finalKnown, hops, confidenceScore: 0.70 }
  }

  // Heuristic: if no hops resolved, source is unknown
  if (hops.length === 0) {
    return { source: 'unknown', hops, confidenceScore: 0 }
  }

  return { source: 'unknown', hops, confidenceScore: 0.3 }
}

/**
 * Find wallets sharing the same funding source as the given address.
 * Used for Sybil cluster detection -- block trade if cluster.length > 5.
 */
export async function findClusterByFunding(
  walletAddress: string
): Promise<string[]> {
  // Production: query a pre-built funding-source index.
  // Placeholder: returns empty cluster (conservative, no false positives).
  void walletAddress
  return []
}
