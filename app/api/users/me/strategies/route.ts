/**
 * GET  /api/users/me/strategies
 *   Returns all 38 strategies with per-user enabled state, allocation_pct,
 *   and AI configuration (mirofish tier, kronos tier, edge type).
 *
 * PUT  /api/users/me/strategies
 *   Body: { strategy_key, is_enabled, allocation_pct? }
 *   Upserts a row in user_enabled_strategies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { isStrategyKey, STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx

  const { data: userRows } = await supabase
    .from('user_enabled_strategies')
    .select('strategy_key, is_enabled, allocation_pct, paper_enabled')
    .eq('user_id', userId)

  const enabledMap = new Map(
    (userRows ?? []).map(r => [r.strategy_key as StrategyKey, {
      is_enabled: r.is_enabled,
      allocation_pct: r.allocation_pct,
      paper_enabled: r.paper_enabled,
    }])
  )

  const strategies = (Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, typeof STRATEGY_REGISTRY_CONFIG[StrategyKey]][])
    .map(([key, cfg]) => ({
      strategyKey: key,
      displayName: toDisplayName(key),
      assetClass: cfg.assetClass,
      edgeType: cfg.edgeType,
      mirofish: cfg.mirofish,
      kronos: cfg.kronos,
      defaultBroker: cfg.defaultBroker,
      isEnabled: enabledMap.get(key)?.is_enabled ?? false,
      allocationPct: enabledMap.get(key)?.allocation_pct ?? null,
      paperEnabled: enabledMap.get(key)?.paper_enabled ?? false,
    }))

  return NextResponse.json({ strategies })
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx

  const body = await req.json().catch(() => ({})) as {
    strategy_key?: string
    is_enabled?: boolean
    allocation_pct?: number
    paper_enabled?: boolean
  }

  if (!body.strategy_key || !isStrategyKey(body.strategy_key)) {
    return NextResponse.json(
      { error: `Unknown strategy_key: "${body.strategy_key}"` },
      { status: 400 }
    )
  }

  if (typeof body.is_enabled !== 'boolean' && typeof body.paper_enabled !== 'boolean') {
    return NextResponse.json({ error: 'is_enabled or paper_enabled (boolean) is required' }, { status: 400 })
  }

  if (body.allocation_pct !== undefined) {
    if (body.allocation_pct < 0 || body.allocation_pct > 100) {
      return NextResponse.json({ error: 'allocation_pct must be 0–100' }, { status: 400 })
    }
  }

  const now = new Date().toISOString()

  // Step 1: ensure the row exists (insert with defaults if new, ignore if already exists)
  const { error: ensureError } = await supabase
    .from('user_enabled_strategies')
    .upsert(
      { user_id: userId, strategy_key: body.strategy_key, is_enabled: false, paper_enabled: false, updated_at: now },
      { onConflict: 'user_id,strategy_key', ignoreDuplicates: true }
    )
  if (ensureError) {
    console.error('[strategies PUT] ensure error:', ensureError)
    return NextResponse.json({ error: ensureError.message }, { status: 500 })
  }

  // Step 2: update only the specific fields being changed
  const updateFields: Record<string, unknown> = { updated_at: now }
  if (typeof body.is_enabled === 'boolean')    updateFields.is_enabled    = body.is_enabled
  if (typeof body.paper_enabled === 'boolean') updateFields.paper_enabled = body.paper_enabled
  if (body.allocation_pct !== undefined)       updateFields.allocation_pct = body.allocation_pct ?? null

  const { error } = await supabase
    .from('user_enabled_strategies')
    .update(updateFields)
    .eq('user_id', userId)
    .eq('strategy_key', body.strategy_key as string)

  if (error) {
    console.error('[strategies PUT] update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    strategyKey: body.strategy_key,
    isEnabled: body.is_enabled,
    allocationPct: body.allocation_pct ?? null,
    paperEnabled: body.paper_enabled ?? null,
    updatedAt: now,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDisplayName(key: StrategyKey): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
