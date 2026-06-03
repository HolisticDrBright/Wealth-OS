import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function assetClassFilter(assetClass: string | null): string[] | null {
  if (!assetClass) return null
  if (assetClass === 'crypto') return ['crypto', 'crypto_spot', 'crypto_futures', 'crypto_perp']
  if (assetClass === 'options') return ['options', 'option', 'equity_options']
  if (assetClass === 'stocks') return ['stocks', 'stock', 'equity']
  return [assetClass]
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetClass = new URL(req.url).searchParams.get('assetClass')
  const assetClasses = assetClassFilter(assetClass)

  let openQuery = supabase
    .from('paper_positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  let recentQuery = supabase
    .from('paper_positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(20)

  if (assetClasses) {
    openQuery = openQuery.in('asset_class', assetClasses)
    recentQuery = recentQuery.in('asset_class', assetClasses)
  }

  const [{ data: open }, { data: recent }] = await Promise.all([openQuery, recentQuery])

  if (assetClasses && (!open?.length && !recent?.length)) {
    const { data: copiedRows } = await supabase
      .from('user_copied_positions')
      .select('id, symbol, action, entry_price, current_price, notional_value, pnl_usd, pnl_pct, status, opened_at, closed_at')
      .eq('user_id', user.id)
      .in('asset_class', assetClasses)
      .order('opened_at', { ascending: false })

    if (copiedRows?.length) {
      const mapped = copiedRows.map(r => ({
        id: r.id,
        strategy_key: 'legacy',
        symbol: r.symbol,
        direction: r.action === 'sell' ? 'short' : 'long',
        entry_price: r.entry_price ?? 0,
        current_price: r.current_price ?? r.entry_price ?? null,
        exit_price: r.status === 'closed' ? (r.current_price ?? null) : null,
        notional_usd: r.notional_value ?? 0,
        unrealized_pnl_usd: r.status === 'open' ? (r.pnl_usd ?? 0) : null,
        unrealized_pnl_pct: r.status === 'open' ? (r.pnl_pct ?? 0) : null,
        realized_pnl_usd: r.status === 'closed' ? (r.pnl_usd ?? 0) : null,
        realized_pnl_pct: r.status === 'closed' ? (r.pnl_pct ?? 0) : null,
        exit_reason: r.status === 'closed' ? 'legacy' : null,
        opened_at: r.opened_at,
        closed_at: r.closed_at,
      }))
      return NextResponse.json({
        open: mapped.filter(r => copiedRows.find(c => c.id === r.id)?.status === 'open'),
        recent: mapped.filter(r => copiedRows.find(c => c.id === r.id)?.status === 'closed').slice(0, 20),
      })
    }
  }

  return NextResponse.json({ open: open ?? [], recent: recent ?? [] })
}
