import { NextRequest, NextResponse } from 'next/server'
import { CIODecisionEngine } from '@/lib/agents/cio-decision-engine'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { TradeContext } from '@/lib/agents/types'

const engine = new CIODecisionEngine()

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user: sessionUser } } = await supabase.auth.getUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your-anthropic-api-key-here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const { trade, user } = body as TradeContext

  if (!trade?.symbol) {
    return NextResponse.json({ error: 'trade is required' }, { status: 400 })
  }

  // Always use the authenticated user's ID — never trust the client-supplied one
  const verifiedUser = { ...user, id: sessionUser.id }

  try {
    const decision = await engine.analyze({ trade, user: verifiedUser })

    // Persist CIO decision to DB
    try {
      const adminSupabase = createAdminClient()
      await adminSupabase.from('cio_decisions').insert({
        user_id: sessionUser.id,
        trader_trade_id: trade.id ?? null,
        decision: decision.decision,
        reasoning: decision.reasoning,
        investment_committee_view: decision.investmentCommitteeView,
        portfolio_impact: decision.portfolioImpact,
        recommended_pct: decision.positionSizing.recommended_pct,
        confidence: decision.confidence,
        plain_english_summary: decision.plainEnglishSummary,
        agent_scores: decision.agentScores,
        mirofish_score: decision.miroFishScore ?? null,
        final_score: decision.finalScore,
        full_output: decision,
      })
    } catch (dbErr) {
      console.warn('[analyze-trade] DB persist failed:', dbErr)
    }

    return NextResponse.json(decision)
  } catch (err) {
    console.error('[analyze-trade] Engine error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}
