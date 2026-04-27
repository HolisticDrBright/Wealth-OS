import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PolymarketEngineClient } from '@/lib/integrations/polymarket-engine/PolymarketEngineClient'

export async function GET() {
  const supabase = await createClient()

  const { ok, latencyMs, walletConnected } = await PolymarketEngineClient.ping()

  const status = ok ? 'ok' : 'down'

  void supabase
    .from('integration_health_log')
    .insert({ integration: 'polymarket_engine', status, latency_ms: latencyMs })

  // Fetch last trade timestamp and 30-day summary from audit_logs (best-effort)
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentTrades } = await supabase
    .from('audit_logs')
    .select('decided_at, metadata')
    .eq('strategy_key', 'polymarket_crypto_binary_5min')
    .gte('decided_at', since30d)
    .order('decided_at', { ascending: false })
    .limit(100)

  const lastTradeAt = recentTrades?.[0]?.decided_at ?? null

  // Approximate 30-day PnL from user_copied_positions if available
  const { data: positions } = await supabase
    .from('user_copied_positions')
    .select('pnl_pct')
    .eq('strategy_key', 'polymarket_crypto_binary_5min')
    .gte('opened_at', since30d)
    .not('pnl_pct', 'is', null)

  const pnlValues = (positions ?? []).map(p => p.pnl_pct as number).filter(n => typeof n === 'number')
  const avgPnl30d = pnlValues.length > 0
    ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length
    : null

  // Brier score from mirofish predictions in audit_logs
  const { data: brierRows } = await supabase
    .from('audit_logs')
    .select('mirofish_score, decision')
    .eq('strategy_key', 'polymarket_crypto_binary_5min')
    .eq('mirofish_used', true)
    .gte('decided_at', since30d)
    .not('mirofish_score', 'is', null)

  const brierPairs = (brierRows ?? []).map(r => {
    const predicted = (r.mirofish_score as number) / 100
    const actual = r.decision === 'execute' ? 1 : 0
    return (predicted - actual) ** 2
  })
  const brierScore30d = brierPairs.length >= 5
    ? brierPairs.reduce((a, b) => a + b, 0) / brierPairs.length
    : null

  return NextResponse.json(
    {
      integration: 'polymarket_engine',
      status,
      latencyMs,
      walletConnected,
      engineUrl: process.env.POLYMARKET_ENGINE_URL ?? 'http://localhost:7432',
      lastTradeAt,
      trades30d: pnlValues.length,
      avgPnl30d,
      brierScore30d,
    },
    { status: ok ? 200 : 503 }
  )
}
