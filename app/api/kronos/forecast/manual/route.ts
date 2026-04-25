/**
 * POST /api/kronos/forecast/manual
 *
 * Trigger an on-demand Kronos forecast for a single symbol/strategy pair.
 * Deducts from the user's kronos budget. Stores the result in kronos_forecasts.
 *
 * Body: { symbol, strategyKey, interval?, horizonHours? }
 *
 * Response: { forecast } on success, { skipped, reason } when gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { kronosClient } from '@/lib/kronos/KronosClient'
import { isStrategyKey } from '@/lib/strategies/strategy-registry'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'

const KRONOS_ESTIMATE_CENTS = 10

export async function POST(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx

  const body = await req.json().catch(() => ({})) as {
    symbol?: string
    strategyKey?: string
    interval?: '1h' | '4h' | '1d'
    horizonHours?: 24 | 48 | 72
  }

  const { symbol, strategyKey, interval = '1d', horizonHours = 24 } = body

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }
  if (!strategyKey) {
    return NextResponse.json({ error: 'strategyKey is required' }, { status: 400 })
  }
  if (!isStrategyKey(strategyKey)) {
    return NextResponse.json({ error: `Unknown strategyKey: ${strategyKey}` }, { status: 400 })
  }

  const cfg = STRATEGY_REGISTRY_CONFIG[strategyKey as StrategyKey]
  if (cfg.kronos === 'skip') {
    return NextResponse.json({
      skipped: true,
      reason: 'kronos not applicable for this strategy',
    })
  }

  const svc = new FeatureFlagService(supabase)
  const gate = await svc.canSpend(userId, 'kronos', KRONOS_ESTIMATE_CENTS)
  if (!gate.allowed) {
    return NextResponse.json({
      skipped: true,
      reason: gate.reason,
    })
  }

  const forecast = await kronosClient.forecast({ symbol, interval, horizonHours })

  const expiresAt = new Date(Date.now() + horizonHours * 3_600_000).toISOString()

  await supabase.from('kronos_forecasts').upsert(
    {
      user_id: userId,
      symbol,
      strategy_key: strategyKey,
      interval,
      horizon_hours: horizonHours,
      skew: forecast.skew,
      skew_strength: forecast.skewStrength,
      p10: forecast.impliedMove.p10,
      p50: forecast.impliedMove.p50,
      p90: forecast.impliedMove.p90,
      confidence_score: forecast.confidenceScore,
      distribution: forecast.distribution,
      generated_at: forecast.generatedAt,
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,symbol,strategy_key,generated_at' }
  )

  svc.logUsage({
    userId,
    featureKey: 'kronos',
    operation: `manual_forecast:${strategyKey}:${symbol}`,
    costCents: KRONOS_ESTIMATE_CENTS,
    metadata: { symbol, strategyKey, skew: forecast.skew },
  }).catch(() => {})

  return NextResponse.json({ forecast })
}
