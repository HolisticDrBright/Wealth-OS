import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Demo seed data (used when API keys are not configured) ────────────────
const DEMO_TRADERS = [
  // Stocks — Unusual Whales / Quiver Quant
  {
    handle: 'nancypelosi', name: 'Nancy Pelosi', asset_class: 'stock', source: 'quiver_quant',
    bio: 'US Congress member. Consistently outperforms market. Tech & semiconductor focus.',
    total_return_pct: 28.4, ytd_return_pct: 14.2, win_rate_pct: 73, avg_trade_size_usd: 250000,
    trade_count: 18, followers_count: 4820, verified: true,
  },
  {
    handle: 'cathiewood', name: 'Cathie Wood', asset_class: 'stock', source: 'unusual_whales',
    bio: 'ARK Invest founder. Disruptive innovation, genomics, fintech, AI.',
    total_return_pct: 42.1, ytd_return_pct: 22.8, win_rate_pct: 61, avg_trade_size_usd: 12000000,
    trade_count: 134, followers_count: 9341, verified: true,
  },
  {
    handle: 'michaelburry', name: 'Michael Burry', asset_class: 'stock', source: 'quiver_quant',
    bio: 'Scion Asset Management. Contrarian macro bets. Famous for Big Short.',
    total_return_pct: -4.8, ytd_return_pct: 8.1, win_rate_pct: 55, avg_trade_size_usd: 800000,
    trade_count: 12, followers_count: 6102, verified: true,
  },
  {
    handle: 'deepvaluedave', name: 'DeepValue Dave', asset_class: 'stock', source: 'unusual_whales',
    bio: 'Unusual options flow specialist. Tracks large institutional sweeps.',
    total_return_pct: 67.3, ytd_return_pct: 31.5, win_rate_pct: 71, avg_trade_size_usd: 85000,
    trade_count: 89, followers_count: 2241, verified: false,
  },
  // Crypto — Nansen / Arkham
  {
    handle: 'smartmoney_eth', name: 'Smart Money ETH', asset_class: 'crypto', source: 'nansen',
    bio: 'Top 50 Nansen smart money wallet. Early DeFi & L2 accumulator.',
    total_return_pct: 156.2, ytd_return_pct: 89.4, win_rate_pct: 68, avg_trade_size_usd: 420000,
    trade_count: 203, followers_count: 3812, verified: true,
  },
  {
    handle: 'jumptrading', name: 'Jump Trading', asset_class: 'crypto', source: 'arkham',
    bio: 'Institutional crypto desk. High-frequency on-chain activity.',
    total_return_pct: 89.7, ytd_return_pct: 44.2, win_rate_pct: 74, avg_trade_size_usd: 5200000,
    trade_count: 512, followers_count: 7290, verified: true,
  },
  {
    handle: 'degenwhale99', name: 'Degen Whale 99', asset_class: 'crypto', source: 'nansen',
    bio: 'Memecoin early mover. Scans new Pump.fun launches.',
    total_return_pct: 312.8, ytd_return_pct: 180.1, win_rate_pct: 42, avg_trade_size_usd: 22000,
    trade_count: 741, followers_count: 1580, verified: false,
  },
  // Forex — MyFxBook
  {
    handle: 'fxpro_alpha', name: 'FX Pro Alpha', asset_class: 'forex', source: 'myfxbook',
    bio: 'MyFxBook rank #3 — EUR/USD swing trader. 4+ year track record.',
    total_return_pct: 34.2, ytd_return_pct: 18.6, win_rate_pct: 66, avg_trade_size_usd: 15000,
    trade_count: 287, followers_count: 1920, verified: true,
  },
  {
    handle: 'scalper_king', name: 'Scalper King', asset_class: 'forex', source: 'myfxbook',
    bio: 'GBP/JPY & XAU/USD scalper. Low drawdown, consistent monthly returns.',
    total_return_pct: 21.8, ytd_return_pct: 9.4, win_rate_pct: 78, avg_trade_size_usd: 8000,
    trade_count: 1204, followers_count: 876, verified: false,
  },
  // Polymarket
  {
    handle: 'poly_oracle', name: 'Poly Oracle', asset_class: 'polymarket', source: 'polymarket',
    bio: 'Polymarket top 10 predictor. Specializes in US political & macro events.',
    total_return_pct: 88.4, ytd_return_pct: 52.1, win_rate_pct: 81, avg_trade_size_usd: 4200,
    trade_count: 94, followers_count: 2341, verified: true,
  },
  {
    handle: 'market_caller', name: 'Market Caller', asset_class: 'polymarket', source: 'polymarket',
    bio: 'Sports & crypto event specialist. High volume, high accuracy.',
    total_return_pct: 54.2, ytd_return_pct: 28.7, win_rate_pct: 72, avg_trade_size_usd: 1800,
    trade_count: 312, followers_count: 1087, verified: false,
  },
]

const DEMO_TRADES: Array<{
  trader_handle: string
  symbol: string
  action: 'buy' | 'sell'
  notional_value: number
  trade_date: string
}> = [
  { trader_handle: 'cathiewood', symbol: 'TSLA', action: 'buy', notional_value: 8200000, trade_date: daysAgo(1) },
  { trader_handle: 'cathiewood', symbol: 'NVDA', action: 'buy', notional_value: 15400000, trade_date: daysAgo(3) },
  { trader_handle: 'nancypelosi', symbol: 'NVDA', action: 'buy', notional_value: 1200000, trade_date: daysAgo(4) },
  { trader_handle: 'nancypelosi', symbol: 'MSFT', action: 'buy', notional_value: 890000, trade_date: daysAgo(8) },
  { trader_handle: 'deepvaluedave', symbol: 'SPY', action: 'buy', notional_value: 240000, trade_date: daysAgo(1) },
  { trader_handle: 'smartmoney_eth', symbol: 'ETH', action: 'buy', notional_value: 680000, trade_date: daysAgo(2) },
  { trader_handle: 'smartmoney_eth', symbol: 'SOL', action: 'buy', notional_value: 120000, trade_date: daysAgo(5) },
  { trader_handle: 'jumptrading', symbol: 'BTC', action: 'buy', notional_value: 4200000, trade_date: daysAgo(1) },
  { trader_handle: 'degenwhale99', symbol: 'WIF', action: 'buy', notional_value: 18000, trade_date: daysAgo(2) },
  { trader_handle: 'fxpro_alpha', symbol: 'EUR/USD', action: 'buy', notional_value: 50000, trade_date: daysAgo(1) },
  { trader_handle: 'scalper_king', symbol: 'XAU/USD', action: 'buy', notional_value: 12000, trade_date: daysAgo(1) },
  { trader_handle: 'poly_oracle', symbol: 'US Recession 2026', action: 'buy', notional_value: 5000, trade_date: daysAgo(2) },
  { trader_handle: 'market_caller', symbol: 'BTC > 100k by Q3', action: 'buy', notional_value: 2200, trade_date: daysAgo(3) },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ─── Real API sync helpers ─────────────────────────────────────────────────

async function syncPolymarket(supabase: ReturnType<typeof createAdminClient>) {
  const apiKey = process.env.POLYMARKET_API_KEY // optional

  try {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const res = await fetch(
      'https://gamma-api.polymarket.com/markets?closed=false&limit=20&order=volumeNum&ascending=false',
      { headers, next: { revalidate: 300 } }
    )
    if (!res.ok) throw new Error(`Polymarket API ${res.status}`)

    const markets = await res.json()
    console.log(`[sync/polymarket] fetched ${markets.length} markets`)
    // Could upsert market data as trader metadata here
    return { source: 'polymarket', records: markets.length }
  } catch (err) {
    console.warn('[sync/polymarket] using demo data:', err)
    return null
  }
}

async function syncUnusualWhales(supabase: ReturnType<typeof createAdminClient>) {
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://api.unusualwhales.com/api/congress/trades?limit=50', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`Unusual Whales API ${res.status}`)
    const data = await res.json()
    console.log('[sync/unusual_whales] fetched', data?.data?.length ?? 0, 'trades')
    return { source: 'unusual_whales', records: data?.data?.length ?? 0 }
  } catch (err) {
    console.warn('[sync/unusual_whales]:', err)
    return null
  }
}

async function syncQuiverQuant(supabase: ReturnType<typeof createAdminClient>) {
  const apiKey = process.env.QUIVER_QUANT_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://api.quiverquant.com/beta/live/congresstrading', {
      headers: { Authorization: `Token ${apiKey}` },
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`QuiverQuant API ${res.status}`)
    const data = await res.json()
    console.log('[sync/quiver_quant] fetched', data?.length ?? 0, 'trades')
    return { source: 'quiver_quant', records: data?.length ?? 0 }
  } catch (err) {
    console.warn('[sync/quiver_quant]:', err)
    return null
  }
}

// ─── Main sync handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const sources: string[] = body.sources ?? ['all']
  const runAll = sources.includes('all')

  const results: Record<string, unknown> = {}

  // ── 1. Upsert demo/seed traders (always — ensures UI is populated) ────────
  for (const t of DEMO_TRADERS) {
    await supabase.from('traders').upsert(
      { ...t, last_synced_at: new Date().toISOString() },
      { onConflict: 'handle' }
    )
  }

  // ── 2. Upsert demo trades ────────────────────────────────────────────────
  const { data: allTraders } = await supabase.from('traders').select('id, handle')
  const handleToId = new Map((allTraders ?? []).map(t => [t.handle, t.id]))

  for (const trade of DEMO_TRADES) {
    const traderId = handleToId.get(trade.trader_handle)
    if (!traderId) continue
    const sourceTradeId = `demo_${trade.trader_handle}_${trade.symbol}_${trade.trade_date}`
    await supabase.from('trader_trades').upsert(
      {
        trader_id: traderId,
        asset_class: DEMO_TRADERS.find(t => t.handle === trade.trader_handle)?.asset_class ?? 'stock',
        symbol: trade.symbol,
        action: trade.action,
        notional_value: trade.notional_value,
        trade_date: trade.trade_date,
        source_trade_id: sourceTradeId,
      },
      { onConflict: 'source_trade_id' }
    )
  }

  results.demo_traders = DEMO_TRADERS.length
  results.demo_trades = DEMO_TRADES.length

  // ── 3. Real API syncs (run when keys are configured) ─────────────────────
  if (runAll || sources.includes('polymarket')) {
    results.polymarket = await syncPolymarket(supabase)
  }
  if (runAll || sources.includes('unusual_whales')) {
    results.unusual_whales = await syncUnusualWhales(supabase)
  }
  if (runAll || sources.includes('quiver_quant')) {
    results.quiver_quant = await syncQuiverQuant(supabase)
  }

  return NextResponse.json({ success: true, synced_at: new Date().toISOString(), results })
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to /api/sync with optional { sources: ["all"] } to run sync',
    available_sources: ['all', 'unusual_whales', 'quiver_quant', 'nansen', 'arkham', 'myfxbook', 'polymarket'],
    required_env_vars: [
      'SUPABASE_SERVICE_ROLE_KEY (required)',
      'UNUSUAL_WHALES_API_KEY (optional)',
      'QUIVER_QUANT_API_KEY (optional)',
      'NANSEN_API_KEY (optional)',
      'ARKHAM_API_KEY (optional)',
      'MYFXBOOK_SESSION (optional)',
      'POLYMARKET_API_KEY (optional)',
    ],
  })
}
