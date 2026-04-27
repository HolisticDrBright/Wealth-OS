import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPaperTradingPass } from '@/lib/paper-trading/PaperTradeRunner'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data: paperRows } = await supabase
      .from('user_enabled_strategies')
      .select('strategy_key')
      .eq('user_id', user.id)
      .eq('paper_enabled', true)

    const enabledKeys = (paperRows ?? []).map(r => r.strategy_key as string)

    if (enabledKeys.length === 0) {
      return NextResponse.json({
        runAt: new Date().toISOString(),
        strategiesRun: 0,
        opportunitiesFound: 0,
        decisionsExecute: 0,
        decisionsBlock: 0,
        positionsOpened: 0,
        positionsClosed: 0,
        errors: ['No strategies have paper trading enabled. Toggle strategies on using the Paper switches on the Crypto, Forex, or Options page.'],
      })
    }

    const result = await runPaperTradingPass(user.id, supabase, enabledKeys.length > 0 ? enabledKeys : undefined)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[paper-trading/run]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
