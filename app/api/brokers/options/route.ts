/**
 * GET /api/brokers/options?assetClass=stocks
 *
 * Returns all broker options the authenticated user CAN use for a given asset
 * class, filtered by their jurisdiction. Each entry includes availability,
 * fees, and paper-trading support so the frontend can render a picker.
 *
 * Query params:
 *   assetClass  Required. One of: stocks | options | crypto_spot | crypto_perp | forex | polymarket | futures
 *
 * Response: { brokers: BrokerOption[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveFeatureFlags } from '@/lib/feature-flags/middleware'
import { createClient } from '@/lib/supabase/server'
import {
  BROKER_CONFIGS,
  ASSET_DEFAULT_BROKER,
  isBrokerAllowed,
  type AssetClass,
  type Broker,
  type Jurisdiction,
} from '@/lib/brokers/asset-broker-routing'

const VALID_ASSET_CLASSES: AssetClass[] = [
  'stocks', 'options', 'crypto_spot', 'crypto_perp', 'forex', 'polymarket', 'futures',
]

export interface BrokerOption {
  broker: Broker
  displayName: string
  apiTier: string
  legalStatus: string
  supportsPaperTrading: boolean
  supportsFractionalShares: boolean
  fees: { perTradeBps: number; takerBps?: number; makerBps?: number; perContractCents?: number }
  isDefault: boolean
  isFallback: boolean
  isConfigured: boolean
}

export async function GET(req: NextRequest) {
  const ctx = await resolveFeatureFlags(req)
  if (ctx.error) return ctx.error

  const { userId } = ctx
  const { searchParams } = new URL(req.url)
  const assetClassParam = searchParams.get('assetClass')

  if (!assetClassParam || !VALID_ASSET_CLASSES.includes(assetClassParam as AssetClass)) {
    return NextResponse.json(
      { error: `assetClass must be one of: ${VALID_ASSET_CLASSES.join(', ')}` },
      { status: 400 }
    )
  }

  const assetClass = assetClassParam as AssetClass

  // Read user's jurisdiction
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('user_settings')
    .select('jurisdiction')
    .eq('id', userId)
    .single()
  const jurisdiction: Jurisdiction = (settings?.jurisdiction as Jurisdiction | undefined) ?? 'us'

  const defaults = ASSET_DEFAULT_BROKER[assetClass]

  // Filter + enrich brokers for this asset class
  const brokers: BrokerOption[] = Object.entries(BROKER_CONFIGS)
    .filter(([, cfg]) => cfg.assetClasses.includes(assetClass))
    .filter(([broker]) => isBrokerAllowed(broker as Broker, jurisdiction))
    .map(([broker, cfg]) => ({
      broker: broker as Broker,
      displayName: cfg.displayName,
      apiTier: cfg.apiTier,
      legalStatus: cfg.legalStatus,
      supportsPaperTrading: cfg.supportsPaperTrading,
      supportsFractionalShares: cfg.supportsFractionalShares,
      fees: cfg.fees,
      isDefault: broker === defaults.primary,
      isFallback: broker === defaults.fallback,
      isConfigured: !!process.env[cfg.apiKeyEnvKey],
    }))
    .sort((a, b) => {
      // Default first, then fallback, then rest alphabetically
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      if (a.isFallback && !b.isFallback) return -1
      if (!a.isFallback && b.isFallback) return 1
      return a.displayName.localeCompare(b.displayName)
    })

  return NextResponse.json({ brokers, assetClass, jurisdiction })
}
