import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from '@/lib/vault/client'
import { VaultConfigError, VaultPathError } from '@/lib/vault/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { path, content, message, callerId, sha } = body as {
    path?: string
    content?: string
    message?: string
    callerId?: string
    sha?: string
  }

  if (!path || !content || !message || !callerId) {
    return NextResponse.json(
      { error: 'path, content, message, and callerId are required' },
      { status: 400 },
    )
  }

  try {
    const result = await writeFile(path, content, message, callerId, sha)
    return NextResponse.json(result)
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
