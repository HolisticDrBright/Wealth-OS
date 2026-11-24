/**
 * POST /api/mobile/next-dollar — the phone's "best next dollar" card actions
 * (roadmap #1 + the raise prompt, #6). Same cores as the web card
 * (lib/advisory/next-dollar-data.ts), as the user under RLS:
 *   { action: 'answer', fact, ...answer }   save a planning fact
 *   { action: 'skip', fact }                "not sure" — move on
 *   { action: 'income', amount_usd }        "my income changed"
 *   { action: 'raise', accept: boolean }    accept / dismiss the raise prompt
 * The card itself comes with GET /api/mobile/home. Nothing here trades.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import {
  answerNextDollarFact, skipNextDollarFact, updateIncome, resolveRaisePrompt, parseFactAnswer,
} from '@/lib/advisory/next-dollar-data'
import { ALL_FACTS, type FactKey } from '@/lib/advisory/next-dollar-card'

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  let res: { ok: boolean; error?: string }
  switch (body.action) {
    case 'answer': {
      const answer = parseFactAnswer(body)
      if (!answer) return NextResponse.json({ error: 'invalid answer' }, { status: 400 })
      res = await answerNextDollarFact(ctx.supabase, ctx.userId, answer)
      break
    }
    case 'skip':
      if (!ALL_FACTS.includes(body.fact as FactKey)) return NextResponse.json({ error: 'unknown question' }, { status: 400 })
      res = await skipNextDollarFact(ctx.supabase, ctx.userId, body.fact as FactKey)
      break
    case 'income':
      res = await updateIncome(ctx.supabase, ctx.userId, Number(body.amount_usd))
      break
    case 'raise':
      res = await resolveRaisePrompt(ctx.supabase, ctx.userId, body.accept === true)
      break
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
