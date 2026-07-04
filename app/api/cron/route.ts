import { NextRequest, NextResponse } from 'next/server'

// Combined tasks run several jobs sequentially — allow up to a minute.
export const maxDuration = 60

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

    if (task === 'agent-calibration') {
      // W4: weekly committee-weight calibration — graded agent votes →
      // softmax over accuracy with asymmetric clamp → agent_weights table.
      // The engine falls back to hardcoded weights if this never runs.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { runAgentCalibration } = await import('@/lib/agents/agent-calibration')
      const result = await runAgentCalibration(supabase)
      return NextResponse.json({
        task: 'agent-calibration',
        updated: result.updated,
        gradedAgents: Object.keys(result.graded).length,
        weights: result.weights,
      })
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

    if (task === 'behavior-gap') {
      // R8: quarterly behavior-gap report per user — honest both ways.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { computeBehaviorGap } = await import('@/lib/personalization/behavior')
      const { data: rows } = await supabase
        .from('user_behavior_events').select('user_id, event, outcome_usd_delta, ts')
      const byUser = new Map<string, Array<{ event: never; outcomeUsdDelta: number | null; ts: string }>>()
      for (const r of rows ?? []) {
        if (!byUser.has(r.user_id as string)) byUser.set(r.user_id as string, [])
        byUser.get(r.user_id as string)!.push({
          event: r.event as never, outcomeUsdDelta: r.outcome_usd_delta as number | null, ts: r.ts as string,
        })
      }
      let reports = 0
      for (const [uid, events] of byUser) {
        const report = computeBehaviorGap(events)
        if (report.graded === 0) continue
        reports++
        await supabase.from('alerts').insert({
          user_id: uid, type: 'behavior_gap', severity: 'info',
          title: 'Your annual behavior report', message: report.headline,
          created_at: new Date().toISOString(),
        }).then(({ error }) => { if (error) console.warn('[behavior-gap] alert failed:', error.message) })
      }
      return NextResponse.json({ task: 'behavior-gap', users: byUser.size, reports })
    }

    if (task === 'ledger') {
      // R5: nightly ledger sync + full-chain verification. Pull-based hooks
      // over decision_log / order_intents / outcome_log — batch hashing, zero
      // per-trade latency. Any mutated historical row breaks verification.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { chainBatch, verifyChain, GENESIS_HASH } = await import('@/lib/ledger/chain')
      const { sendOpsAlert } = await import('@/lib/ops/alert')

      const { data: existing } = await supabase
        .from('ledger_entries').select('kind, source_id')
      const seen = new Set((existing ?? []).map(r => `${r.kind}:${r.source_id}`))
      const { data: headRow } = await supabase
        .from('ledger_entries').select('chain_hash').order('seq', { ascending: false }).limit(1)
      const head = (headRow ?? [])[0]?.chain_hash ?? GENESIS_HASH

      // W6: provenance ids (decision_id / order_intent_id) are part of the
      // hashed payloads, so the decision→intent→outcome chain itself is
      // tamper-evident.
      const sources: Array<['decision' | 'order_intent' | 'outcome', string, string[]]> = [
        ['decision', 'decision_log', ['id', 'strategy', 'symbol', 'confidence', 'predicted_direction', 'paper_position_id', 'created_at']],
        ['order_intent', 'order_intents', ['id', 'client_order_id', 'leg', 'status', 'broker_order_id', 'decision_id', 'created_at']],
        ['outcome', 'outcome_log', ['id', 'decision_id', 'order_intent_id', 'actual_direction', 'brier_score', 'created_at']],
      ]
      const inputs: Array<{ kind: 'decision' | 'order_intent' | 'outcome'; sourceId: string; payload: unknown }> = []
      for (const [kind, table, cols] of sources) {
        const { data } = await supabase.from(table).select(cols.join(', ')).order('created_at', { ascending: true }).limit(2000)
        for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          const id = String(row.id)
          if (seen.has(`${kind}:${id}`)) continue
          inputs.push({ kind, sourceId: id, payload: row })
        }
      }

      let appended = 0
      if (inputs.length) {
        const { entries } = chainBatch(head, inputs)
        const { error } = await supabase.from('ledger_entries').insert(entries)
        if (error) console.warn('[ledger] append failed:', error.message)
        else appended = entries.length
      }

      const { data: all } = await supabase
        .from('ledger_entries').select('seq, payload_hash, prev_hash, chain_hash').order('seq', { ascending: true })
      const verification = verifyChain((all ?? []) as never)
      if (!verification.valid) {
        await sendOpsAlert(supabase, {
          severity: 'critical',
          title: 'LEDGER VERIFICATION FAILED',
          message: `Chain broken at seq ${verification.brokenAtSeq} — history has been tampered with or corrupted`,
        })
      }
      return NextResponse.json({ task: 'ledger', appended, verification })
    }

    if (task === 'lifecycle') {
      // R6: weekly auto-retirement review. Pure thresholds — demotion is
      // paper_enabled=false + shadow tracking + a filed report; never LLM.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { evaluateLifecycle, quarterOf, isCompleteQuarter, MIN_TRADES_PER_QUARTER } =
        await import('@/lib/strategies/lifecycle')
      const { sendOpsAlert } = await import('@/lib/ops/alert')

      const { data: closed } = await supabase
        .from('paper_positions')
        .select('user_id, strategy_key, asset_class, closed_at, realized_pnl_pct')
        .eq('status', 'closed')
        .limit(20_000)

      // Benchmark quarterly returns per asset class (W7): SPY (stocks/options),
      // BTC-USD (crypto), UUP dollar-carry (forex) via Yahoo; polymarket uses
      // the hold-NO baseline — a fair-priced binary market has ZERO expected
      // return, so a strategy must beat 0% net of costs. A strategy is never
      // demoted against a benchmark we didn't measure.
      const quarterlyReturns = async (symbol: string): Promise<Map<string, number>> => {
        const out = new Map<string, number>()
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=3mo&range=2y`,
            { signal: AbortSignal.timeout(8_000) })
          if (res.ok) {
            const d = await res.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
            const r = d.chart?.result?.[0]
            const ts = r?.timestamp ?? []
            const closes = (r?.indicators?.quote?.[0]?.close ?? [])
            for (let i = 1; i < ts.length; i++) {
              const a = closes[i - 1]; const b = closes[i]
              if (a && b) out.set(quarterOf(new Date(ts[i] * 1000).toISOString()), (b / a - 1) * 100)
            }
          }
        } catch { /* missing feed → that asset class sees no demotions this run */ }
        return out
      }

      const [spyBench, btcBench, fxBench] = await Promise.all([
        quarterlyReturns('SPY'),
        quarterlyReturns('BTC-USD'),
        quarterlyReturns('UUP'),
      ])
      const benchFor = (assetClass: string): Map<string, number> | 'hold_no' | null => {
        switch (assetClass) {
          case 'stocks': case 'stock': case 'options': case 'etf':
            return spyBench.size ? spyBench : null
          case 'crypto':
            return btcBench.size ? btcBench : null
          case 'forex': case 'fx':
            return fxBench.size ? fxBench : null
          case 'polymarket': case 'prediction_market':
            return 'hold_no'
          default:
            return null
        }
      }

      const groups = new Map<string, Map<string, { sum: number; n: number; assetClass: string }>>()
      for (const row of closed ?? []) {
        if (!row.closed_at || row.realized_pnl_pct == null) continue
        const q = quarterOf(row.closed_at as string)
        if (!isCompleteQuarter(q)) continue
        const key = `${row.user_id}|${row.strategy_key}`
        if (!groups.has(key)) groups.set(key, new Map())
        const g = groups.get(key)!
        const cur = g.get(q) ?? { sum: 0, n: 0, assetClass: row.asset_class as string }
        cur.sum += (row.realized_pnl_pct as number) * 100
        cur.n += 1
        g.set(q, cur)
      }

      const demotions: string[] = []
      for (const [key, byQuarter] of groups) {
        const [uid, strategyKey] = key.split('|')
        const assetClass = [...byQuarter.values()][0]?.assetClass ?? ''
        const bench = benchFor(assetClass)
        if (bench === null) continue   // unmeasured benchmark → never demote
        const quarters = [...byQuarter.entries()]
          .filter(([q]) => bench === 'hold_no' || bench.has(q))
          .map(([q, v]) => ({
            quarter: q,
            strategyReturnPct: v.sum,
            benchmarkReturnPct: bench === 'hold_no' ? 0 : bench.get(q)!,
            trades: v.n,
          }))
        const verdict = evaluateLifecycle(strategyKey, quarters)
        if (verdict.demote) {
          demotions.push(`${uid}:${strategyKey}`)
          await supabase.from('user_enabled_strategies')
            .update({ paper_enabled: false })
            .eq('user_id', uid).eq('strategy_key', strategyKey)
          await supabase.from('strategy_retirement_log').insert({
            user_id: uid, strategy_key: strategyKey, reason: verdict.report,
            created_at: new Date().toISOString(),
          }).then(({ error }) => { if (error) console.warn('[lifecycle] retirement log failed:', error.message) })
          await sendOpsAlert(supabase, {
            severity: 'warning', userId: uid,
            title: `Strategy demoted: ${strategyKey}`,
            message: verdict.report,
          })
        }
      }
      return NextResponse.json({
        task: 'lifecycle',
        strategiesReviewed: groups.size,
        demotions,
        minTradesPerQuarter: MIN_TRADES_PER_QUARTER,
      })
    }

    if (task === 'regime-allocator') {
      // R4: daily allocator-regime classification from observable inputs,
      // persisted to regime_state for regime-conditional capital weights.
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { classifyAllocatorRegime } = await import('@/lib/regime/allocator')
      const { detectRegime } = await import('@/lib/regime/cross-asset-regime')

      // Curve via FRED (2s10s); vol/credit reuse the pipeline regime reading.
      let curve2s10s: number | null = null
      const fredKey = process.env.FRED_API_KEY
      if (fredKey) {
        try {
          const res = await fetch(
            `https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${fredKey}&file_type=json&limit=1&sort_order=desc`,
            { signal: AbortSignal.timeout(6_000) })
          if (res.ok) {
            const d = await res.json() as { observations?: Array<{ value?: string }> }
            const v = parseFloat(d.observations?.[0]?.value ?? '')
            if (Number.isFinite(v)) curve2s10s = v
          }
        } catch { /* input stays null — classifier tolerates gaps */ }
      }
      const reading = await detectRegime().catch(() => null)
      const inputs = {
        curve2s10s,
        hyOasBps: reading?.hyOas ?? null,
        realizedVolRatio: reading?.vix != null && reading.thresholds
          ? reading.vix / Math.max(1, reading.thresholds.riskOffVix / 1.5)
          : null,
        breadth: null,   // wired when sleeve 200dma breadth lands
      }
      const regime = classifyAllocatorRegime(inputs)
      await supabase.from('regime_state').upsert({
        as_of: new Date().toISOString().slice(0, 10), regime, inputs,
      }, { onConflict: 'as_of' })
      return NextResponse.json({ task: 'regime-allocator', regime, inputs })
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

      // W3: CRISIS regime fires the pre-committed playbook — never an LLM
      // improvisation. Executed per user, chained into the tamper-evident
      // ledger so the response itself is auditable.
      let playbook: { fired: boolean; regime: string | null; executions: number } = { fired: false, regime: null, executions: 0 }
      try {
        const { data: rs } = await supabase
          .from('regime_state').select('as_of, regime')
          .order('as_of', { ascending: false }).limit(1)
        const regime = (rs ?? [])[0]?.regime ?? null
        playbook.regime = regime
        if (regime === 'crisis') {
          const { CRISIS_PLAYBOOKS, executePlaybook } = await import('@/lib/regime/playbooks')
          const { chainBatch, GENESIS_HASH } = await import('@/lib/ledger/chain')
          const crisisPb = CRISIS_PLAYBOOKS.find(p => p.id === 'liquidity_crash_2020')!

          const { data: users } = await supabase
            .from('user_enabled_strategies').select('user_id')
          const userIds = [...new Set(((users ?? []) as Array<{ user_id: string }>).map(u => u.user_id))]

          const results = []
          for (const uid of userIds) {
            const exec = await executePlaybook(crisisPb, { supabase, userId: uid, dryRun: false })
            results.push({ userId: uid, ...exec })
          }

          // Chain the execution into the ledger (append-only, hash-chained).
          const { data: headRow } = await supabase
            .from('ledger_entries').select('chain_hash').order('seq', { ascending: false }).limit(1)
          const head = (headRow ?? [])[0]?.chain_hash ?? GENESIS_HASH
          const today = new Date().toISOString().slice(0, 10)
          const { entries } = chainBatch(head, [{
            kind: 'playbook',
            sourceId: `${crisisPb.id}:${today}`,
            payload: { playbookId: crisisPb.id, regime, date: today, executions: results },
          }])
          await supabase.from('ledger_entries').insert(entries)

          await sendOpsAlert(supabase, {
            severity: 'critical',
            title: 'CRISIS regime — playbook executed',
            message: `${crisisPb.id} executed for ${results.length} user(s); halts + floor tightening + resting-order cancels applied`,
          })
          playbook = { fired: true, regime, executions: results.length }
        }
      } catch (err) {
        console.warn('[ops-watchdog] crisis playbook check failed:', err instanceof Error ? err.message : err)
      }

      // Reconciliation: with no live broker linked, paper book is truth-by-
      // construction; report skipped honestly instead of fabricating a diff.
      const brokerLinked = !!(process.env.ALPACA_API_KEY || process.env.COINBASE_API_KEY || process.env.OANDA_API_KEY)
      return NextResponse.json({
        task: 'ops-watchdog',
        deadWorkers: dead,
        playbook,
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
      const { evaluateSweepTriggers, tierCapForInvestable } = await import('@/lib/advisory/sweep-engine')
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
            // Full KB §1 tier ladder (W7): mass market → mass affluent →
            // HNW → VHNW → UHNW, falling back to the nearest LOWER tier.
            tierCapFraction: tierCapForInvestable(investable, params),
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

    // ── Daily OPS combined task — the validation-phase jobs in one cron ──────
    // Covers Vercel Hobby's cron limit: one schedule runs every ops job.
    // Weekly jobs (lifecycle demotion, agent calibration) only fire on
    // Mondays so their clamps/cadences behave as designed; the behavior-gap
    // report fires on the 1st of the month.
    if (task === 'daily-ops') {
      const now = new Date()
      const isMonday = now.getUTCDay() === 1
      const isFirstOfMonth = now.getUTCDate() === 1
      const opsTasks = [
        'tipp-floors', 'sweep', 'ops-watchdog', 'regime-allocator',
        'ledger', 'advisory-staleness',
        ...(isMonday ? ['lifecycle', 'agent-calibration'] : []),
        ...(isFirstOfMonth ? ['behavior-gap'] : []),
      ]
      const results: Record<string, string> = {}
      for (const t of opsTasks) {
        try {
          const r = await fetch(`${baseUrl}/api/cron?task=${t}`, {
            headers: { authorization: `Bearer ${cronSecret}` },
          })
          results[t] = r.ok ? 'ok' : `http ${r.status}`
        } catch (e) {
          results[t] = e instanceof Error ? e.message : 'error'
        }
      }
      return NextResponse.json({
        task: 'daily-ops',
        results,
        weeklyTasksRan: isMonday,
        monthlyTasksRan: isFirstOfMonth,
      })
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
