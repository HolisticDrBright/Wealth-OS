/**
 * Manual integration smoke test for all crypto MCP integrations.
 *
 * Run with:  npx tsx scripts/test-mcp-integration.ts
 *
 * Expected output (CRYPTOPANIC_API_KEY set):
 *   [CCXT] guard OK — fetchTicker is allowed
 *   [CCXT] createOrder correctly blocked
 *   [CCXT] BTC/USDT price: 65432.10
 *   [CryptoPanic] BTC 24h heat: { score: 42.3, posts: 180, polarity: 0.21 }
 *   [Aave] Expected rejection: Aave MCP not enabled — ...
 *   [Uniswap PoolSpy] Expected rejection: Uniswap PoolSpy MCP not enabled — ...
 *   ✓ 4 passed  ✗ 0 failed
 */

import { buildClient } from '../lib/integrations/ccxt/mcp-config'
import { narrativeHeatScore } from '../lib/integrations/cryptopanic/mcp-config'
import { getReserveData } from '../lib/integrations/aave/mcp-config'
import { getNewPools } from '../lib/integrations/uniswap-poolspy/mcp-config'

let passed = 0
let failed = 0

function ok(label: string, detail?: unknown) {
  console.log(`  ✓ ${label}`, detail !== undefined ? detail : '')
  passed++
}
function fail(label: string, detail?: unknown) {
  console.error(`  ✗ ${label}`, detail !== undefined ? detail : '')
  failed++
}

async function main() {
  // ── CCXT read-only guard ─────────────────────────────────────────────────────
  console.log('\n=== CCXT MCP (read-only guard) ===')

  try {
    buildClient('fetchTicker')
    ok('fetchTicker is allowed by buildClient()')
  } catch (e) {
    fail('buildClient() rejected fetchTicker — should be allowed', (e as Error).message)
  }

  try {
    buildClient('createOrder')
    fail('createOrder should have been blocked by buildClient()')
  } catch {
    ok('createOrder correctly blocked by buildClient()')
  }

  // Live BTC price via Binance public REST — validates real network connectivity
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { price: string }
    ok('BTC/USDT price via Binance public REST', data.price)
  } catch (e) {
    console.warn('  ~ BTC price fetch skipped (no network?):', (e as Error).message)
  }

  // ── CryptoPanic narrative heat ───────────────────────────────────────────────
  console.log('\n=== CryptoPanic MCP ===')

  if (!process.env.CRYPTOPANIC_API_KEY) {
    console.log('  ~ SKIPPED — set CRYPTOPANIC_API_KEY to test live API')
  } else {
    try {
      const heat = await narrativeHeatScore('BTC', '24h')
      if (heat.score >= 0 && heat.score <= 100 && heat.polarity >= -1 && heat.polarity <= 1) {
        ok('BTC 24h heat score/polarity in valid range', heat)
      } else {
        fail('BTC heat out of range', heat)
      }
    } catch (e) {
      fail('narrativeHeatScore() threw', (e as Error).message)
    }
  }

  // ── Aave (gated — must reject) ───────────────────────────────────────────────
  console.log('\n=== Aave MCP (gated — must reject) ===')
  try {
    await getReserveData('USDC')
    fail('getReserveData() should have thrown "not enabled"')
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('not enabled')) {
      ok('Expected rejection from getReserveData()', msg.slice(0, 70) + '...')
    } else {
      fail('Unexpected error from getReserveData()', msg)
    }
  }

  // ── Uniswap PoolSpy (gated — must reject) ───────────────────────────────────
  console.log('\n=== Uniswap PoolSpy MCP (gated — must reject) ===')
  try {
    await getNewPools(['ethereum'], 10_000)
    fail('getNewPools() should have thrown "not enabled"')
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('not enabled')) {
      ok('Expected rejection from getNewPools()', msg.slice(0, 70) + '...')
    } else {
      fail('Unexpected error from getNewPools()', msg)
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n  ${passed > 0 ? '✓' : ''} ${passed} passed  ${failed > 0 ? '✗' : ''} ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
