import { NextRequest, NextResponse } from 'next/server'
import { searchVault } from '@/lib/vault/client'
import { VaultConfigError, VaultPathError } from '@/lib/vault/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { query, extension } = body as { query?: string; extension?: string }

  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  try {
    const results = await searchVault(query, extension)
    return NextResponse.json({ results })
  } catch (err) {
    if (err instanceof VaultConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof VaultPathError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
