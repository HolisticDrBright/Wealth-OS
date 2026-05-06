/**
 * DeFi Llama public API — yield and RWA pool data.
 * No API key required.
 */

export interface DefiLlamaPool {
  pool: string
  project: string
  symbol: string
  apy: number          // annualised %
  tvlUsd: number
  chain: string
}

const YIELDS_URL = 'https://yields.llama.fi/pools'

let _poolsCache: DefiLlamaPool[] | null = null
let _cacheAt = 0
const CACHE_TTL_MS = 15 * 60 * 1_000   // 15 min

async function getAllPools(): Promise<DefiLlamaPool[]> {
  if (_poolsCache && Date.now() - _cacheAt < CACHE_TTL_MS) return _poolsCache
  try {
    const res = await fetch(YIELDS_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return _poolsCache ?? []
    const data = await res.json() as { data?: DefiLlamaPool[] }
    _poolsCache = data.data ?? []
    _cacheAt = Date.now()
    return _poolsCache
  } catch {
    return _poolsCache ?? []
  }
}

/**
 * Get APY for a specific RWA token by contract address or pool id.
 * Returns null when the pool is not found or data unavailable.
 */
export async function getRwaApy(tokenAddressOrId: string): Promise<number | null> {
  const pools = await getAllPools()
  const match = pools.find(p =>
    p.pool.toLowerCase() === tokenAddressOrId.toLowerCase() ||
    p.symbol.toLowerCase() === tokenAddressOrId.toLowerCase()
  )
  return match ? match.apy / 100 : null   // convert % to decimal
}

/**
 * Get the best stablecoin APY available on Aave (for RWA yield comparison).
 */
export async function getBestAaveStablecoinApy(): Promise<number> {
  const pools = await getAllPools()
  const aavePools = pools.filter(p =>
    p.project.toLowerCase().includes('aave') &&
    ['USDC', 'USDT', 'DAI', 'FRAX'].includes(p.symbol.toUpperCase())
  )
  if (aavePools.length === 0) return 0.03   // default 3%
  return Math.max(...aavePools.map(p => p.apy / 100))
}

/**
 * Get pools matching a project name prefix.
 */
export async function getProjectPools(projectPrefix: string): Promise<DefiLlamaPool[]> {
  const pools = await getAllPools()
  return pools.filter(p => p.project.toLowerCase().startsWith(projectPrefix.toLowerCase()))
}
