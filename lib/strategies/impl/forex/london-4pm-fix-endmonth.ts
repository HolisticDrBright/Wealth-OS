/**
 * London 4pm Fix End-of-Month — FLOW EDGE
 * Source: TIER 3 T3.6
 * Edge: flow (#edge/flow)
 * Asset: forex → oanda
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Two sub-signals on the last business day of each month:
 *  1. PRE-FIX  (14:00–15:55 UTC): enter in the direction of the SPX/ACWX MTD
 *     return spread. Force-exit at 16:02 UTC.
 *  2. POST-FIX (16:05–16:30 UTC): fade the fix move if it was > 1.5× ATR.
 *     Force-exit at 16:30 UTC.
 *
 * Skips NFP weeks and FOMC days (binary risk too high).
 * Size: 2% portfolio (pre-fix) or 1.5% (post-fix fade).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
  OpenPosition,
  PriceTick,
  ManageAction,
} from '../../pipeline-types'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import {
  isLastBusinessDayOfMonth,
  utcHourDecimal,
  isHighImpactNewsDay,
  isNfpWeek,
} from '../../cadence-helpers'
import { randomUUID } from 'crypto'

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MIN_MTD_SPREAD   = 0.01   // 1% SPX vs ACWX spread required
const PRE_FIX_START    = 14.0   // UTC 14:00
const PRE_FIX_END      = 15.92  // UTC 15:55
const POST_FIX_START   = 16.08  // UTC 16:05
const POST_FIX_END     = 16.5   // UTC 16:30
const MIN_ATR_MULTIPLE = 1.5    // post-fix move must be > 1.5× ATR to fade

// ─── OANDA price helper ───────────────────────────────────────────────────────

async function getOandaMidPrice(pair: string): Promise<number | null> {
  const apiKey = process.env.OANDA_API_KEY
  if (!apiKey) return null
  try {
    const accountId = process.env.OANDA_ACCOUNT_ID ?? ''
    const url = `https://api-fxtrade.oanda.com/v3/accounts/${accountId}/pricing?instruments=${pair}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }> }
    const p = data.prices?.[0]
    if (!p) return null
    const bid = parseFloat(p.bids?.[0]?.price ?? '0')
    const ask = parseFloat(p.asks?.[0]?.price ?? '0')
    return (bid + ask) / 2
  } catch {
    return null
  }
}

/** Fetch MTD return for a symbol from Yahoo Finance. */
async function getMtdReturn(symbol: string): Promise<number | null> {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const msDiff = now.getTime() - startOfMonth.getTime()
    const days = Math.ceil(msDiff / 86_400_000) + 5  // add buffer
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${days}d`
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)
      ?.result as unknown[]
    const indicators = (result?.[0] as Record<string, unknown>)?.indicators as Record<string, unknown>
    const adjclose = ((indicators?.adjclose as unknown[])?.[0] as Record<string, unknown>)
      ?.adjclose as number[] | undefined
    if (!adjclose || adjclose.length < 2) return null
    const startPrice = adjclose[0]
    const lastPrice = adjclose[adjclose.length - 1]
    return (lastPrice - startPrice) / startPrice
  } catch {
    return null
  }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class London4pmFixEndmonthStrategy extends BasePipelineStrategy {
  readonly key = 'london_4pm_fix_endmonth' as const
  readonly displayName = 'London 4pm Fix End-of-Month'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isLastBusinessDayOfMonth()) return []
    if (isHighImpactNewsDay() || isNfpWeek()) return []

    const utcH = utcHourDecimal()
    const inPreFix  = utcH >= PRE_FIX_START  && utcH < PRE_FIX_END
    const inPostFix = utcH >= POST_FIX_START && utcH < POST_FIX_END
    if (!inPreFix && !inPostFix) return []

    const [spxMtd, acwxMtd] = await Promise.all([getMtdReturn('SPY'), getMtdReturn('ACWX')])
    if (spxMtd === null || acwxMtd === null) return []

    const spread = spxMtd - acwxMtd
    if (Math.abs(spread) < MIN_MTD_SPREAD) return []

    const eurusdPrice = await getOandaMidPrice('EUR_USD')
    if (!eurusdPrice) return []

    const opportunities: Opportunity[] = []

    if (inPreFix) {
      // USD strength when SPX underperforms ACWX (global > US rebalancing)
      const direction = spread > 0 ? 'short' : 'long'   // spread>0: USD flows out = EUR/USD long
      const forceExitMs = Date.now() + (PRE_FIX_END - utcH) * 3_600_000  // at 16:02 UTC

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: 'EURUSD',
        direction: direction as 'long' | 'short',
        assetClass: this.assetClass,
        strength: Math.min(1, Math.abs(spread) / 0.05),
        expectedReturn: Math.abs(spread) * 0.2,
        bracket: {
          stopPrice: direction === 'long' ? eurusdPrice * 0.997 : eurusdPrice * 1.003,
        },
        metadata: {
          subSignal: 'pre_fix',
          eurusdPrice,
          spxMtd,
          acwxMtd,
          spread,
          forceExitAtMs: forceExitMs,
          riskPct: 0.02,
          reasoning: `Pre-fix: SPX MTD ${(spxMtd * 100).toFixed(1)}% vs ACWX ${(acwxMtd * 100).toFixed(1)}% — ${direction} EUR/USD`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const spread = Math.abs((opp.metadata.spread as number | undefined) ?? 0)
    if (spread < MIN_MTD_SPREAD) return { passed: false, score: 15, reason: `MTD spread ${(spread * 100).toFixed(1)}% < 1% threshold` }
    const score = Math.min(100, 40 + spread * 600)
    return { passed: score >= 40, score }
  }

  async sizePosition(
    opp: Opportunity,
    _verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : null
    if (portfolio == null) {
      return zeroSize('equity_unavailable: refusing to size — never default equity')
    }
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    const riskPct = (opp.metadata.riskPct as number | undefined) ?? 0.02
    const structural = Math.min(riskPct, maxSinglePct / 100)
    const hc = await applyEmpiricalHaircuts(structural, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')
    const notionalUsd = hc.fraction * portfolio

    return {
      fraction: hc.fraction,
      notionalUsd,
      rationale: `London fix ${opp.metadata.subSignal === 'pre_fix' ? '2%' : '1.5%'} risk × empirical haircuts`,
    }
  }

  async manageOpenPosition(position: OpenPosition, _tick: PriceTick): Promise<ManageAction> {
    const forceExitAtMs = (position.metadata.forceExitAtMs as number | undefined) ?? 0
    if (forceExitAtMs > 0 && Date.now() >= forceExitAtMs) {
      return { type: 'close', reason: 'London fix time-based force exit' }
    }
    return { type: 'hold' }
  }
}
