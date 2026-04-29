import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CamofoxClient } from '@/lib/integrations/camofox/CamofoxClient'

export async function GET() {
  const supabase = await createClient()
  const { ok, latencyMs } = await CamofoxClient.ping()

  const status = ok ? 'ok' : 'down'

  // Log the health check result (best-effort)
  supabase
    .from('integration_health_log')
    .insert({ integration: 'camofox', status, latency_ms: latencyMs })
    .then(() => {}, () => {})

  return NextResponse.json(
    { integration: 'camofox', status, latencyMs, dockerUrl: process.env.CAMOFOX_URL ?? 'http://localhost:9377' },
    { status: ok ? 200 : 503 }
  )
}
