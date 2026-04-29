import { NextRequest, NextResponse } from 'next/server'

// Vercel Cron hits this endpoint via GET
// Protect with CRON_SECRET to prevent unauthorized triggers
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
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
      // Run for every user who has at least one open paper position
      const { data: rows } = await supabase
        .from('paper_positions')
        .select('user_id')
        .eq('status', 'open')
      const userIds = [...new Set((rows ?? []).map(r => r.user_id as string))]
      if (!userIds.length) {
        return NextResponse.json({ task: 'learning', users: 0, message: 'No users with open positions' })
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
