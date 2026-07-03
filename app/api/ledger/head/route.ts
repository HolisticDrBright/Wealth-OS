/**
 * Public verifiable-ledger head (R5): anyone can fetch the chain head and
 * independently recompute it from the published entries.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GENESIS_HASH } from '@/lib/ledger/chain'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('ledger_entries')
      .select('seq, chain_hash, ts')
      .order('seq', { ascending: false })
      .limit(1)
    const head = (data ?? [])[0] as { seq: number; chain_hash: string; ts: string } | undefined
    return NextResponse.json({
      head: head?.chain_hash ?? GENESIS_HASH,
      seq: head?.seq ?? 0,
      asOf: head?.ts ?? null,
      verify: 'chain_hash[n] = sha256(prev_hash[n] || payload_hash[n]); prev_hash[0] = 64×"0"',
    })
  } catch {
    return NextResponse.json({ head: GENESIS_HASH, seq: 0, asOf: null }, { status: 200 })
  }
}
