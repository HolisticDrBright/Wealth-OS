import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'

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

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const supabase = createAdminClient()

  const [profileResult, settingsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('user_settings').select('*').eq('user_id', userId).single(),
  ])

  return apiSuccess({
    id: userId,
    profile: profileResult.data,
    settings: settingsResult.data,
  })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { full_name, avatar_url } = body

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name, avatar_url, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}
