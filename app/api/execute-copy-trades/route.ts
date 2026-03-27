import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CIODecisionEngine } from '@/lib/agents/cio-decision-engine'
import { submitOrder } from '@/lib/broker-router'
import { evaluateRules, applySizing } from '@/lib/rules-engine'
import type { TradeContext } from '@/lib/agents/types'
import type { AutopilotRule } from '@/lib/types'

const cioEngine = new CIODecisionEngine()

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

    // Load user's autopilot rules
    const { data: rulesRows } = await supabase
      .from('autopilot_rules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('priority', { ascending: true })
    const rules: AutopilotRule[] = rulesRows ?? []

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

      // Compute copy size
      const copyNotional = Math.min(
        (trade.notional_value ?? 1000) * (maxPct / 100),
        maxDaily ? Math.max(0, maxDaily - todaySpend) : Infinity,
        50000
      )

      if (copyNotional < 1) continue

      // ── Evaluate autopilot rules (first-match wins) ──────────────────────
      const { data: traderRow } = await supabase
        .from('traders').select('*').eq('id', traderId).single()

      if (rules.length > 0) {
        const ruleCtx = {
          symbol: trade.symbol,
          asset_class: trade.asset_class,
          action: trade.action,
          notional_value: copyNotional,
          trader_id: traderId,
          trader_return_pct: traderRow?.total_return_pct ?? 0,
          cio_score: 0,
        }

        const ruleResult = evaluateRules(rules, ruleCtx)
        if (ruleResult) {
          if (ruleResult.action_type === 'skip') {
            errors.push(`${trade.symbol}: skipped by rule`)
            continue
          }
          if (ruleResult.action_type === 'alert_only') {
            // Insert alert and continue without copying
            await supabase.from('alerts').insert({
              user_id: userId,
              type: 'trade_executed',
              title: `Rule alert: ${trade.symbol} ${trade.action}`,
              body: `Autopilot rule triggered for ${trade.symbol} — alert only mode`,
              severity: 'info',
              is_read: false,
              metadata: { trade_id: trade.id, rule_name: ruleResult.matched_rule_name },
            })
            continue
          }
        }
      }

      // ── Run 13-agent CIO analysis ────────────────────────────────────────
      let approvedNotional = copyNotional
      let cioDecisionId: string | undefined

      if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-anthropic-api-key-here') {
        try {
          const { data: userAssets } = await supabase
            .from('assets').select('*').eq('user_id', userId)

          const tradeContext: TradeContext = {
            trade: {
              id: trade.id,
              symbol: trade.symbol,
              action: trade.action as TradeContext['trade']['action'],
              asset_class: trade.asset_class as TradeContext['trade']['asset_class'],
              notional_value: copyNotional,
              trader_name: traderRow?.name ?? 'Unknown',
              trader_handle: traderRow?.handle ?? '',
              trader_return_pct: traderRow?.total_return_pct ?? 0,
              trader_win_rate: traderRow?.win_rate_pct ?? 0,
            },
            user: {
              id: userId,
              total_net_worth: (userAssets ?? []).reduce((s: number, a: { current_value: number }) => s + a.current_value, 0),
              portfolio: userAssets ?? [],
              risk_profile: follow.risk_level as TradeContext['user']['risk_profile'],
              max_allocation_pct: maxPct,
            },
          }

          const cioDecision = await cioEngine.analyze(tradeContext)
          console.log(`[CIO] ${trade.symbol}: ${cioDecision.decision} (score: ${cioDecision.finalScore.toFixed(1)})`)

          if (cioDecision.decision === 'reject') {
            errors.push(`${trade.symbol}: rejected by CIO — ${cioDecision.reasoning}`)
            // Mark trade as scored
            await supabase.from('trader_trades').update({ cio_scored: true }).eq('id', trade.id)
            continue
          }
          if (cioDecision.decision === 'defer') continue

          if (cioDecision.decision === 'reduce') {
            approvedNotional = applySizing(
              {
                action_type: 'reduce',
                sizing_pct: cioDecision.positionSizing.recommended_pct,
                matched_rule_id: 'cio',
                matched_rule_name: 'CIO Decision Engine',
              },
              copyNotional,
              maxPct
            )
          }

          // Mark trade as scored
          await supabase.from('trader_trades').update({ cio_scored: true }).eq('id', trade.id)
        } catch (cioErr) {
          console.warn('[CIO] analysis failed, proceeding with original size:', cioErr)
        }
      }

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
          notional_value: approvedNotional,
          status: 'pending',
          cio_decision_id: cioDecisionId ?? null,
        })
        .select()
        .single()

      if (posErr || !pos) { errors.push(posErr?.message ?? 'insert failed'); continue }

      // Create order record
      const { data: orderRow } = await supabase
        .from('orders')
        .insert({
          user_id: userId,
          symbol: trade.symbol,
          asset_class: trade.asset_class,
          side: trade.action === 'buy' || trade.action === 'cover' ? 'buy' : 'sell',
          order_type: 'market',
          notional_usd: approvedNotional,
          time_in_force: 'day',
          status: 'pending',
          source: 'copy_trade',
          source_ref_id: pos.id,
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single()

      // Route to broker via unified submitOrder
      const result = await submitOrder({
        symbol: trade.symbol,
        asset_class: trade.asset_class,
        side: trade.action === 'buy' || trade.action === 'cover' ? 'buy' : 'sell',
        order_type: 'market',
        notional_usd: approvedNotional,
      })

      const finalStatus = result.status === 'open' || result.status === 'submitted' ? 'open'
        : result.status === 'skipped' ? 'open'
        : 'failed'

      // Update position
      await supabase
        .from('user_copied_positions')
        .update({
          status: finalStatus,
          broker: result.broker ?? trade.asset_class,
          broker_order_id: result.broker_order_id ?? null,
          error_message: result.error ?? result.reason ?? null,
          order_id: orderRow?.id ?? null,
        })
        .eq('id', pos.id)

      // Update order
      if (orderRow) {
        await supabase
          .from('orders')
          .update({
            status: result.status === 'failed' ? 'rejected' : result.status,
            broker: result.broker ?? trade.asset_class,
            broker_order_id: result.broker_order_id ?? null,
            error_message: result.error ?? result.reason ?? null,
          })
          .eq('id', orderRow.id)
      }

      executed++
    }
  }

  return NextResponse.json({ success: true, executed, errors: errors.length ? errors : undefined })
}
