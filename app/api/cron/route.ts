import { NextRequest, NextResponse } from 'next/server'

// Vercel Cron hits this endpoint via GET
// Protect with CRON_SECRET to prevent unauthorized triggers.
// FAILS CLOSED: no secret configured = nobody can trigger tasks
// (the old check skipped auth entirely when CRON_SECRET was unset).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const task = req.nextUrl.searchParams.get('task') ?? 'sync'
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  try {
    if (task === 'sync') {
      const res = await fetch(`${baseUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: ['all'] }),
      })
      const data = await res.json()
      return NextResponse.json({ task: 'sync', result: data })
    }

    if (task === 'copy') {
      const res = await fetch(`${baseUrl}/api/execute-copy-trades`, {
        method: 'POST',
      })
      const data = await res.json()
      return NextResponse.json({ task: 'copy', result: data })
    }

    if (task === 'simulate') {
      // Find pending jobs and kick them off
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { data: pendingJobs } = await supabase
        .from('simulation_jobs')
        .select('id')
        .eq('status', 'pending')
        .limit(5)

      const results = await Promise.allSettled(
        (pendingJobs ?? []).map(job =>
          fetch(`${baseUrl}/api/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: job.id }),
          }).then(r => r.json())
        )
      )
      return NextResponse.json({ task: 'simulate', dispatched: pendingJobs?.length ?? 0, results })
    }

    if (task === 'score') {
      const { runAutoScoring } = await import('@/lib/auto-scorer')
      const result = await runAutoScoring(10)
      return NextResponse.json({ task: 'score', ...result })
    }

    if (task === 'rebalance') {
      const res = await fetch(`${baseUrl}/api/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute: false }),
      })
      const data = await res.json()
      return NextResponse.json({ task: 'rebalance', result: data })
    }

    if (task === 'harvest-scan') {
      const res = await fetch(`${baseUrl}/api/tax-harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      return NextResponse.json({ task: 'harvest-scan', result: data })
    }

    if (task === 'sync-crypto') {
      const res = await fetch(`${baseUrl}/api/kraken?action=prices`)
      const data = await res.json()
      return NextResponse.json({ task: 'sync-crypto', result: data })
    }

    if (task === 'sync-forex') {
      const res = await fetch(`${baseUrl}/api/oanda?action=rates`)
      const data = await res.json()
      return NextResponse.json({ task: 'sync-forex', result: data })
    }

    if (task === 'paper-trading') {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()

      // Find every user who has at least one strategy paper-enabled
      const { data: rows } = await supabase
        .from('user_enabled_strategies')
        .select('user_id, strategy_key')
        .eq('paper_enabled', true)

      const byUser = new Map<string, string[]>()
      for (const row of rows ?? []) {
        const uid = row.user_id as string
        const key = row.strategy_key as string
        if (!byUser.has(uid)) byUser.set(uid, [])
        byUser.get(uid)!.push(key)
      }

      if (byUser.size === 0) {
        return NextResponse.json({ task: 'paper-trading', users: 0, message: 'No users have paper trading enabled' })
      }

      const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')

      const results = await Promise.allSettled(
        [...byUser.entries()].map(([userId, enabledKeys]) =>
          runPaperTradingPass(userId, supabase, enabledKeys)
        )
      )

      const summary = results.map((r, i) => ({
        userId: [...byUser.keys()][i],
        ...(r.status === 'fulfilled'
          ? r.value
          : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }),
      }))

      return NextResponse.json({ task: 'paper-trading', users: byUser.size, summary })
    }

    if (task === 'promote') {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { data: users } = await supabase
        .from('user_enabled_strategies')
        .select('user_id')
        .eq('paper_enabled', true)
      const userIds = [...new Set((users ?? []).map(r => r.user_id as string))]
      const { runPromotionPipeline } = await import('@/lib/workers/promotion-pipeline')
      const results = await Promise.allSettled(
        userIds.map(uid => runPromotionPipeline(supabase, uid))
      )
      const summary = results.map(r =>
        r.status === 'fulfilled'
          ? r.value.map(s => ({ strategy: s.strategy, passed: s.result.passed, failedGates: s.result.failedGates }))
          : []
      ).flat()
      return NextResponse.json({ task: 'promote', users: userIds.length, summary })
    }

    if (task === 'learning') {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      // Run for every user who has any paper position (open or closed) — closed positions
      // still have decision_log entries that may need grading or outcome data to learn from.
      const { data: rows } = await supabase
        .from('paper_positions')
        .select('user_id')
      const userIds = [...new Set((rows ?? []).map(r => r.user_id as string))]
      if (!userIds.length) {
        return NextResponse.json({ task: 'learning', users: 0, message: 'No users with paper positions' })
      }
      const { runLearningPass } = await import('@/lib/learning/loop')
      const results = await Promise.allSettled(userIds.map(uid => runLearningPass(uid)))
      const summary = results.map((r, i) => ({
        userId: userIds[i],
        ...(r.status === 'fulfilled'
          ? r.value
          : { updated: false, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) }),
      }))
      return NextResponse.json({ task: 'learning', users: userIds.length, summary })
    }

    if (task === 'advisory-staleness') {
      // Flags tax_constants / kb_parameters unverified for >90 days — stale
      // limits must surface as alerts, never silently produce outdated advice.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { listStaleConstants } = await import('@/lib/advisory/constants')
      const stale = await listStaleConstants(supabase)
      if (stale.length > 0) {
        await supabase.from('alerts').insert({
          type: 'advisory_constants_stale',
          severity: 'warning',
          title: `${stale.length} advisory constant(s) unverified for >90 days`,
          message: stale.map(s => `${s.table}.${s.key} (${s.daysStale}d)`).join(', '),
          created_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.warn('[advisory-staleness] alert insert failed:', error.message)
        })
      }
      return NextResponse.json({ task: 'advisory-staleness', staleCount: stale.length, stale })
    }

    if (task === 'ops-watchdog') {
      // R7: dead-man switch + position reconciliation. Silent workers and
      // unreconciled positions alert through the single ops channel.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { findDeadWorkers } = await import('@/lib/ops/reconcile')
      const { sendOpsAlert } = await import('@/lib/ops/alert')

      const { data: beats } = await supabase.from('worker_heartbeats').select('worker, last_seen')
      const dead = findDeadWorkers((beats ?? []) as Array<{ worker: string; last_seen: string }>)
      for (const d of dead) {
        await sendOpsAlert(supabase, {
          severity: 'critical',
          title: `Worker silent: ${d.worker}`,
          message: `No heartbeat for ${Math.round(d.silentMs / 60000)}m (>3× cadence) — de-risk per playbook and investigate`,
        })
      }

      // Reconciliation: with no live broker linked, paper book is truth-by-
      // construction; report skipped honestly instead of fabricating a diff.
      const brokerLinked = !!(process.env.ALPACA_API_KEY || process.env.COINBASE_API_KEY || process.env.OANDA_API_KEY)
      return NextResponse.json({
        task: 'ops-watchdog',
        deadWorkers: dead,
        reconciliation: brokerLinked ? 'broker adapters present — wire per-broker snapshots' : 'skipped (paper mode, no broker linked)',
      })
    }

    if (task === 'tipp-floors') {
      // Daily TIPP ratchet (R2): F_t = max(F_prev × e^(r·dt), k × V_t) per
      // user per sleeve. The floor only ever rises here.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { updateFloorState } = await import('@/lib/advisory/tipp-state')
      const { loadKbParameters } = await import('@/lib/advisory/constants')
      const { fetchCurrentYields } = await import('@/lib/advisory/yields')
      const params = await loadKbParameters(supabase)
      const yields = await fetchCurrentYields()
      const rAnnual = (yields.tbill3moPct ?? 0) / 100

      const { data: open } = await supabase
        .from('paper_positions').select('user_id, asset_class, notional_usd, unrealized_pnl_usd').eq('status', 'open')
      const byUserSleeve = new Map<string, number>()
      for (const r of open ?? []) {
        const key = `${r.user_id}|${r.asset_class}`
        byUserSleeve.set(key, (byUserSleeve.get(key) ?? 0) + ((r.notional_usd as number) ?? 0) + ((r.unrealized_pnl_usd as number) ?? 0))
      }

      let updated = 0
      for (const [key, valueUsd] of byUserSleeve) {
        const [uid, sleeveKey] = key.split('|')
        const m = sleeveKey === 'crypto' || sleeveKey === 'polymarket'
          ? params.tipp_multiplier_crypto : params.tipp_multiplier_equity
        const { data: row } = await supabase
          .from('sleeve_floors').select('floor_usd, hwm_usd, peak_cushion_usd, updated_at')
          .eq('user_id', uid).eq('sleeve_key', sleeveKey).maybeSingle()
        const dtDays = row?.updated_at
          ? Math.max(0, (Date.now() - new Date(row.updated_at as string).getTime()) / 86_400_000)
          : 1
        const next = updateFloorState(
          {
            floorUsd: Number(row?.floor_usd ?? 0),
            hwmUsd: Number(row?.hwm_usd ?? 0),
            peakCushionUsd: Number(row?.peak_cushion_usd ?? 0),
          },
          valueUsd, params.tipp_floor_k, rAnnual, dtDays
        )
        const { error } = await supabase.from('sleeve_floors').upsert({
          user_id: uid, sleeve_key: sleeveKey,
          floor_usd: next.floorUsd, hwm_usd: next.hwmUsd, peak_cushion_usd: next.peakCushionUsd,
          k: params.tipp_floor_k, multiplier: m, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,sleeve_key' })
        if (error) console.warn('[tipp-floors] upsert failed:', error.message)
        else updated++
      }
      return NextResponse.json({ task: 'tipp-floors', sleeves: updated, rAnnual })
    }

    if (task === 'sweep') {
      // Monthly sweep evaluation (KB §6): derive sleeve state per user from
      // paper positions + assets, run the trigger cascade, surface actions as
      // alerts. Recommendations only — the engine never moves money.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { evaluateSweepTriggers } = await import('@/lib/advisory/sweep-engine')
      const { loadKbParameters } = await import('@/lib/advisory/constants')
      const params = await loadKbParameters(supabase)

      const { data: users } = await supabase
        .from('paper_positions').select('user_id').eq('status', 'open')
      const userIds = [...new Set((users ?? []).map(r => r.user_id as string))]
      let actionsTotal = 0

      for (const uid of userIds) {
        const [{ data: open }, { data: assets }, { data: flags }, { data: profile }, { data: floors }] = await Promise.all([
          supabase.from('paper_positions').select('asset_class, notional_usd').eq('user_id', uid).eq('status', 'open'),
          supabase.from('assets').select('current_value').eq('user_id', uid),
          supabase.from('system_flags').select('user_id, enabled').eq('key', 'trading_halted'),
          supabase.from('financial_profile').select('monthly_essential_expenses_usd, liquid_cash_usd, income_stability').eq('user_id', uid).maybeSingle(),
          supabase.from('sleeve_floors').select('sleeve_key, floor_usd, hwm_usd, peak_cushion_usd').eq('user_id', uid),
        ])
        const floorBySleeve = new Map((floors ?? []).map(f => [f.sleeve_key as string, f]))
        const investable = (assets ?? []).reduce((s, r) => s + ((r.current_value as number) ?? 0), 0)
        if (investable <= 0) continue

        const months = profile?.income_stability === 'self_employed' ? params.emergency_months_self_employed
          : profile?.income_stability === 'variable' ? params.emergency_months_family
          : params.emergency_months_w2
        const byClass = new Map<string, number>()
        for (const r of open ?? []) {
          byClass.set(r.asset_class as string, (byClass.get(r.asset_class as string) ?? 0) + ((r.notional_usd as number) ?? 0))
        }

        const actions = evaluateSweepTriggers({
          emergencyFundUsd: (profile?.liquid_cash_usd as number) ?? 0,
          emergencyTargetUsd: months * ((profile?.monthly_essential_expenses_usd as number) ?? 0),
          tradingHalted: (flags ?? []).some(f => f.enabled && (f.user_id === null || f.user_id === uid)),
          investableAssetsUsd: investable,
          sleeves: [...byClass.entries()].map(([key, valueUsd]) => ({
            key, valueUsd,
            // Persisted TIPP ratchet state (R2) — daily tipp-floors job maintains it.
            floorUsd: Number(floorBySleeve.get(key)?.floor_usd ?? 0),
            peakCushionUsd: Number(floorBySleeve.get(key)?.peak_cushion_usd ?? 0),
            initialBankrollUsd: 0,
            ratchetHwmUsd: Number(floorBySleeve.get(key)?.hwm_usd ?? 0),
            sigmaRealized: null, sigmaTarget: null,
            weightFraction: investable > 0 ? valueUsd / investable : 0,
            tierCapFraction: investable < 100_000 ? params.sleeve_cap_mass_market : params.sleeve_cap_mass_affluent,
            kellyCapFraction: params.kelly_fraction_max,
            suspended: false,
          })),
          headroom: { iraUsd: 0, hsaUsd: 0, solo401kUsd: 0, daysToDeadline: 365 },
          allocations: [],
        }, params)

        for (const a of actions) {
          actionsTotal++
          await supabase.from('alerts').insert({
            user_id: uid,
            type: 'sweep_recommendation',
            severity: a.priority <= 3 ? 'critical' : 'info',
            title: `Sweep: ${a.trigger} — $${Math.round(a.amountUsd).toLocaleString()}`,
            message: a.rationale,
            created_at: new Date().toISOString(),
          }).then(({ error }) => { if (error) console.warn('[sweep] alert insert failed:', error.message) })
        }
      }
      return NextResponse.json({ task: 'sweep', users: userIds.length, actions: actionsTotal })
    }

    if (task === 'news-sentiment') {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      // Gather all unique tickers currently held in open paper positions
      const { data: positions } = await supabase
        .from('paper_positions')
        .select('symbol, asset_class')
        .eq('status', 'open')
        .in('asset_class', ['stocks', 'options'])
      const tickers = [...new Set((positions ?? []).map(p => (p.symbol as string).split(/[-/]/)[0].toUpperCase()))]
      const { runSyncNewsSentiment } = await import('@/lib/workers/sync-news-sentiment')
      // Use a system-level userId (null user_id written to DB for cron-sourced rows)
      const result = await runSyncNewsSentiment(supabase, 'cron', tickers)
      return NextResponse.json({ task: 'news-sentiment', ...result })
    }

    // ── Daily combined task (runs all tasks sequentially for Hobby plan) ──────
    if (task === 'daily') {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const results: Record<string, unknown> = {}

      // 1. Sync crypto prices
      try {
        const r = await fetch(`${baseUrl}/api/kraken?action=prices`)
        results.syncCrypto = r.ok ? 'ok' : `http ${r.status}`
      } catch { results.syncCrypto = 'error' }

      // 2. Sync forex rates
      try {
        const r = await fetch(`${baseUrl}/api/oanda?action=rates`)
        results.syncForex = r.ok ? 'ok' : `http ${r.status}`
      } catch { results.syncForex = 'error' }

      // 3. News sentiment for open stock/options positions
      try {
        const { data: stockPos } = await supabase
          .from('paper_positions')
          .select('symbol, asset_class')
          .eq('status', 'open')
          .in('asset_class', ['stocks', 'options'])
        const tickers = [...new Set((stockPos ?? []).map(p => (p.symbol as string).split(/[-/]/)[0].toUpperCase()))]
        if (tickers.length) {
          const { runSyncNewsSentiment } = await import('@/lib/workers/sync-news-sentiment')
          const sr = await runSyncNewsSentiment(supabase, 'cron', tickers)
          results.newsSentiment = sr
        } else {
          results.newsSentiment = 'skipped (no stock positions)'
        }
      } catch (e) { results.newsSentiment = e instanceof Error ? e.message : 'error' }

      // 4. Paper trading (exit stale positions + open new ones for all users)
      try {
        const { data: stratRows } = await supabase
          .from('user_enabled_strategies')
          .select('user_id, strategy_key')
          .eq('paper_enabled', true)
        const byUser = new Map<string, string[]>()
        for (const row of stratRows ?? []) {
          const uid = row.user_id as string
          if (!byUser.has(uid)) byUser.set(uid, [])
          byUser.get(uid)!.push(row.strategy_key as string)
        }
        if (byUser.size > 0) {
          const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
          const ptResults = await Promise.allSettled(
            [...byUser.entries()].map(([uid, keys]) => runPaperTradingPass(uid, supabase, keys))
          )
          results.paperTrading = {
            users: byUser.size,
            summary: ptResults.map((r, i) => ({
              userId: [...byUser.keys()][i],
              ...(r.status === 'fulfilled' ? r.value : { error: String(r.reason) }),
            })),
          }
        } else {
          results.paperTrading = 'skipped (no users with paper enabled)'
        }
      } catch (e) { results.paperTrading = e instanceof Error ? e.message : 'error' }

      // 5. Auto-scoring
      try {
        const { runAutoScoring } = await import('@/lib/auto-scorer')
        results.score = await runAutoScoring(10)
      } catch (e) { results.score = e instanceof Error ? e.message : 'error' }

      return NextResponse.json({ task: 'daily', ...results })
    }

    return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
