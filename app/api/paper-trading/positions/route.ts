import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetClass = new URL(req.url).searchParams.get('assetClass')

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

  if (assetClass) {
    openQuery = openQuery.eq('asset_class', assetClass)
    recentQuery = recentQuery.eq('asset_class', assetClass)
  }

  const [{ data: open }, { data: recent }] = await Promise.all([openQuery, recentQuery])

  return NextResponse.json({ open: open ?? [], recent: recent ?? [] })
}
