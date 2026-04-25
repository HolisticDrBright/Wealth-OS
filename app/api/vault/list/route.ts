import { NextRequest, NextResponse } from 'next/server'
import { listDirectory } from '@/lib/vault/client'
import { VaultConfigError, VaultPathError } from '@/lib/vault/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { path } = body as { path?: string }

  if (!path) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  try {
    const items = await listDirectory(path)
    return NextResponse.json({ items })
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
