/**
 * PUT /api/strategies/:strategyKey/broker
 *
 * Set a per-strategy broker override for the authenticated user.
 * Validates that the override broker is legal in the user's jurisdiction
 * before saving.
 *
 * Body: { broker: Broker }
 *
 * Response: { strategyKey, broker, reason: 'user_override', updated_at }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { createClient } from '@/lib/supabase/server'
import {
  BROKER_CONFIGS,
  isBrokerAllowed,
  type Broker,
  type Jurisdiction,
} from '@/lib/brokers/asset-broker-routing'
import { isStrategyKey } from '@/lib/strategies/strategy-registry'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ strategyKey: string }> }
) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { userId } = ctx
  const { strategyKey } = await params

  if (!isStrategyKey(strategyKey)) {
    return NextResponse.json({ error: `Unknown strategyKey: ${strategyKey}` }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { broker?: string }
  const broker = body.broker as Broker | undefined

  if (!broker) {
    return NextResponse.json({ error: 'broker is required' }, { status: 400 })
  }
  if (!BROKER_CONFIGS[broker]) {
    return NextResponse.json(
      { error: `Unknown broker: ${broker}. Valid brokers: ${Object.keys(BROKER_CONFIGS).join(', ')}` },
      { status: 400 }
    )
  }

  // Check user's jurisdiction
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('user_settings')
    .select('jurisdiction')
    .eq('id', userId)
    .single()
  const jurisdiction: Jurisdiction = (settings?.jurisdiction as Jurisdiction | undefined) ?? 'us'

  if (!isBrokerAllowed(broker, jurisdiction)) {
    return NextResponse.json(
      { error: `Broker "${BROKER_CONFIGS[broker].displayName}" is not available in your jurisdiction (${jurisdiction})` },
      { status: 422 }
    )
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_strategy_broker_overrides')
    .upsert(
      { user_id: userId, strategy_key: strategyKey, broker, updated_at: now },
      { onConflict: 'user_id,strategy_key' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    strategyKey,
    broker,
    displayName: BROKER_CONFIGS[broker].displayName,
    reason: 'user_override',
    updated_at: now,
  })
}

/**
 * DELETE /api/strategies/:strategyKey/broker — remove override, revert to default
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ strategyKey: string }> }
) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { supabase, userId } = ctx
  const { strategyKey } = await params

  await supabase
    .from('user_strategy_broker_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('strategy_key', strategyKey)

  return NextResponse.json({ strategyKey, broker: null, reason: 'default' })
}
