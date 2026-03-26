import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Broker stubs — replace with real SDK calls when keys are configured ──

async function executViaAlpaca(symbol: string, action: string, notional: number) {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_SECRET_KEY
  if (!key || !secret) return { status: 'skipped', reason: 'ALPACA_API_KEY not configured' }

  try {
    const baseUrl = 'https://paper-api.alpaca.markets' // paper trading — change to live for real
    const res = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        notional: notional.toFixed(2),
        side: action === 'buy' ? 'buy' : 'sell',
        type: 'market',
        time_in_force: 'day',
      }),
    })
    const data = await res.json()
    if (!res.ok) return { status: 'failed', error: data.message ?? 'Alpaca error' }
    return { status: 'open', broker_order_id: data.id, broker: 'alpaca' }
  } catch (err) {
    return { status: 'failed', error: String(err) }
  }
}

async function executeViaBinance(symbol: string, action: string, notional: number) {
  const key = process.env.BINANCE_API_KEY
  if (!key) return { status: 'skipped', reason: 'BINANCE_API_KEY not configured' }
  // Binance execution stub — requires HMAC signing
  return { status: 'skipped', reason: 'Binance execution: add HMAC signing implementation' }
}

async function executeViaOanda(symbol: string, action: string, notional: number) {
  const key = process.env.OANDA_API_KEY
  const account = process.env.OANDA_ACCOUNT_ID
  if (!key || !account) return { status: 'skipped', reason: 'OANDA_API_KEY not configured' }
  // OANDA execution stub
  return { status: 'skipped', reason: 'OANDA execution: add fxTrade implementation' }
}

async function executeViaPolymarket(symbol: string, action: string, notional: number) {
  const key = process.env.POLYMARKET_PRIVATE_KEY
  if (!key) return { status: 'skipped', reason: 'POLYMARKET_PRIVATE_KEY not configured' }
  // Polymarket CLOB stub
  return { status: 'skipped', reason: 'Polymarket CLOB: add CLOB client implementation' }
}

function routeToBroker(assetClass: string, symbol: string, action: string, notional: number) {
  switch (assetClass) {
    case 'stock': return executViaAlpaca(symbol, action, notional)
    case 'crypto': return executeViaBinance(symbol, action, notional)
    case 'forex': return executeViaOanda(symbol, action, notional)
    case 'polymarket': return executeViaPolymarket(symbol, action, notional)
    default: return Promise.resolve({ status: 'skipped', reason: `Unknown asset class: ${assetClass}` })
  }
}

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get all active auto-copy settings
  const { data: autoCopyUsers } = await supabase
    .from('user_followed_traders')
    .select('*, traders(id, asset_class)')
    .eq('auto_copy_enabled', true)

  if (!autoCopyUsers?.length) {
    return NextResponse.json({ success: true, message: 'No users with auto-copy enabled', executed: 0 })
  }

  let executed = 0
  const errors: string[] = []

  for (const follow of autoCopyUsers) {
    const traderId = follow.trader_id
    const userId = follow.user_id
    const maxPct = follow.max_allocation_pct_per_trade ?? 5
    const maxDaily = follow.max_daily_copy_usd
    const allowedClasses: string[] = follow.copy_asset_classes ?? ['stock', 'crypto', 'forex', 'polymarket']

    // Get recent trades not yet copied by this user
    const { data: recentTrades } = await supabase
      .from('trader_trades')
      .select('*')
      .eq('trader_id', traderId)
      .gte('trade_date', since)
      .order('trade_date', { ascending: false })

    if (!recentTrades?.length) continue

    // Get already-copied trade IDs for this user
    const { data: alreadyCopied } = await supabase
      .from('user_copied_positions')
      .select('trader_trade_id')
      .eq('user_id', userId)
      .eq('trader_id', traderId)
      .in('trader_trade_id', recentTrades.map(t => t.id))

    const copiedIds = new Set((alreadyCopied ?? []).map(p => p.trader_trade_id))

    // Check daily spend
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const { data: todayPositions } = await supabase
      .from('user_copied_positions')
      .select('notional_value')
      .eq('user_id', userId)
      .gte('opened_at', startOfDay.toISOString())

    const todaySpend = (todayPositions ?? []).reduce((s, p) => s + (p.notional_value ?? 0), 0)

    for (const trade of recentTrades) {
      if (copiedIds.has(trade.id)) continue
      if (!allowedClasses.includes(trade.asset_class)) continue

      // Compute copy size (% of trade notional, capped by daily limit)
      const copyNotional = Math.min(
        (trade.notional_value ?? 1000) * (maxPct / 100),
        maxDaily ? Math.max(0, maxDaily - todaySpend) : Infinity,
        50000 // hard cap $50k per position
      )

      if (copyNotional < 1) continue

      // Create position record
      const { data: pos, error: posErr } = await supabase
        .from('user_copied_positions')
        .insert({
          user_id: userId,
          trader_id: traderId,
          trader_trade_id: trade.id,
          symbol: trade.symbol,
          asset_class: trade.asset_class,
          action: trade.action,
          notional_value: copyNotional,
          status: 'pending',
        })
        .select()
        .single()

      if (posErr || !pos) { errors.push(posErr?.message ?? 'insert failed'); continue }

      // Route to broker
      const result = await routeToBroker(trade.asset_class, trade.symbol, trade.action, copyNotional)

      await supabase
        .from('user_copied_positions')
        .update({
          status: result.status === 'open' ? 'open' : result.status === 'skipped' ? 'open' : 'failed',
          broker: (result as { broker?: string }).broker ?? trade.asset_class,
          broker_order_id: (result as { broker_order_id?: string }).broker_order_id ?? null,
          error_message: (result as { error?: string; reason?: string }).error ?? (result as { reason?: string }).reason ?? null,
        })
        .eq('id', pos.id)

      executed++
    }
  }

  return NextResponse.json({ success: true, executed, errors: errors.length ? errors : undefined })
}
