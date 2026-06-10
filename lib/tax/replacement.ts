/**
 * Replacement-security suggestions for tax-loss harvesting, with a
 * "substantially identical" quality guard.
 *
 * IRS ambiguity (IRC §1091 / Pub. 550): the IRS has never precisely defined
 * "substantially identical". Common practice treats ETFs from *different
 * issuers* tracking the same index (e.g. SPY → VOO) as acceptable
 * replacements, but this is not formally blessed by the IRS. What is clearly
 * NOT acceptable: the same security (SPY → SPY), different share classes of
 * the same issuer (GOOG → GOOGL, BRK.A → BRK.B), or contracts/options on the
 * same security. We stay conservative: a replacement must pass
 * `isSubstantiallyIdentical() === false` or we suggest nothing at all.
 */

/** Share classes / tickers of the same issuer — never valid replacements for each other. */
const SAME_ISSUER_GROUPS: string[][] = [
  ['GOOG', 'GOOGL'],
  ['BRK.A', 'BRK.B', 'BRK-A', 'BRK-B'],
  ['FOX', 'FOXA'],
  ['NWS', 'NWSA'],
  ['UA', 'UAA'],
  ['LEN', 'LEN.B'],
  ['HEI', 'HEI.A'],
  // Wrapped/derivative crypto of the same underlying asset
  ['BTC', 'WBTC', 'BTCB'],
  ['ETH', 'WETH', 'STETH'],
]

/** ETF ticker → issuer, used to reject same-issuer "replacements". */
const ETF_ISSUERS: Record<string, string> = {
  SPY: 'ssga', SPLG: 'ssga', MDY: 'ssga', DIA: 'ssga',
  VOO: 'vanguard', VTI: 'vanguard', VBR: 'vanguard', VEA: 'vanguard', VUG: 'vanguard',
  IVV: 'ishares', IWM: 'ishares', ITOT: 'ishares', EFA: 'ishares',
  QQQ: 'invesco', QQQM: 'invesco', RSP: 'invesco',
  ONEQ: 'fidelity', FXAIX: 'fidelity',
  SCHB: 'schwab', SCHX: 'schwab',
}

/**
 * Static replacement map. Values were chosen to maintain similar market
 * exposure while passing the different-issuer / not-substantially-identical
 * guard below (e.g. SPY→VOO: same index, different issuer — common practice;
 * stocks map to a sector peer, never another share class).
 */
const REPLACEMENTS: Record<string, string> = {
  // Single stocks → sector/industry peer (different issuer)
  AAPL: 'MSFT', MSFT: 'GOOGL', GOOGL: 'META', META: 'GOOGL', TSLA: 'RIVN', NVDA: 'AMD', AMD: 'NVDA',
  // Index ETFs → different issuer tracking a similar index
  SPY: 'VOO', VOO: 'IVV', IVV: 'SPLG', QQQ: 'ONEQ', ONEQ: 'QQQ', IWM: 'VBR', VTI: 'ITOT',
  // Crypto → different asset in the same sector
  BTC: 'ETH', ETH: 'BTC', SOL: 'AVAX', AVAX: 'SOL', MATIC: 'ARB',
}

function norm(symbol: string): string {
  return symbol.trim().toUpperCase()
}

/**
 * Conservative "substantially identical" test:
 *  - identical ticker → identical
 *  - share classes / wrapped versions of the same issuer or asset → identical
 *  - two ETFs from the same issuer → treated as identical (conservative;
 *    same-issuer funds on different indexes are likely fine, but we err
 *    toward safety)
 */
export function isSubstantiallyIdentical(a: string, b: string): boolean {
  const symA = norm(a)
  const symB = norm(b)
  if (symA === symB) return true

  for (const group of SAME_ISSUER_GROUPS) {
    if (group.includes(symA) && group.includes(symB)) return true
  }

  const issuerA = ETF_ISSUERS[symA]
  const issuerB = ETF_ISSUERS[symB]
  if (issuerA && issuerB && issuerA === issuerB) return true

  return false
}

/**
 * Suggest a replacement that maintains similar exposure without being
 * substantially identical. Returns undefined when no safe replacement is
 * known — better to suggest nothing than to suggest a wash sale.
 */
export function suggestReplacement(symbol: string, _assetClass?: string): string | undefined {
  const sym = norm(symbol)
  const candidate = REPLACEMENTS[sym]
  if (!candidate) return undefined
  if (isSubstantiallyIdentical(sym, candidate)) return undefined
  return candidate
}
