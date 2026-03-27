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
  const unreadOnly = req.nextUrl.searchParams.get('unread') === 'true'

  let query = supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) return apiError(error.message, 500)

  return apiSuccess(data ?? [], { count: data?.length ?? 0 })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { id, all } = body

  const supabase = createAdminClient()

  if (all) {
    await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
    return apiSuccess({ updated: 'all' })
  }

  if (!id) return apiError('id required', 400)

  const { data, error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return apiError('id required', 400)

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('alerts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return apiError(error.message, 500)
  return apiSuccess({ deleted: id })
}
