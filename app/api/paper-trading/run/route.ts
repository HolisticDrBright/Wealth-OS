import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPaperTradingPass } from '@/lib/paper-trading/PaperTradeRunner'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await runPaperTradingPass(user.id, supabase)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[paper-trading/run]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
