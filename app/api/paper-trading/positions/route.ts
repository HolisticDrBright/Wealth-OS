import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: open } = await supabase
    .from('paper_positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  const { data: recent } = await supabase
    .from('paper_positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ open: open ?? [], recent: recent ?? [] })
}
