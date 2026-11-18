import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'
import { runHarvestScan } from '@/lib/workers/harvest-scan'

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = getBearerToken(req)
  if (!token) return null
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  return user?.id ?? null
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const result = await runHarvestScan(createAdminClient(), userId, {
    thresholdUsd: body.threshold_usd ?? 250,
    thresholdPct: body.threshold_pct ?? 3,
  })

  return apiSuccess(result)
}
