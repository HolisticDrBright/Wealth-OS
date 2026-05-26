import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  getTradesByStrategy,
  getPnlByStrategy,
  getOpenPositions,
  getExitReasonBreakdown,
} from '@/lib/admin/paper-trading-queries'

async function checkAdmin(): Promise<{ userId: string } | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
  if (adminEmails.length > 0 && !adminEmails.includes(user.email ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { userId: user.id }
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const check = await checkAdmin()
  if (check instanceof NextResponse) return check

  const supabase = createAdminClient()

  const [tradesByStrategy, pnlByStrategy, openPositions, exitReasons] = await Promise.all([
    getTradesByStrategy(supabase),
    getPnlByStrategy(supabase),
    getOpenPositions(supabase),
    getExitReasonBreakdown(supabase),
  ])

  return NextResponse.json({ tradesByStrategy, pnlByStrategy, openPositions, exitReasons })
}
