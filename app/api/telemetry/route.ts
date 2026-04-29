import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let body: { event: string; properties?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  if (!body.event) return NextResponse.json({ ok: false }, { status: 400 })

  await supabase
    .from('user_telemetry_events')
    .insert({ user_id: user?.id ?? null, event: body.event, properties: body.properties ?? {} })
    .then(() => {}, () => {})

  return NextResponse.json({ ok: true })
}
