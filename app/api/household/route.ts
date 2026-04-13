import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { data } = await supabase
    .from('households')
    .select('*, members:household_members(*), goals:household_goals(*)')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return apiSuccess(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { name, household_type = 'family' } = body
  if (!name?.trim()) return apiError('name is required')

  const { data, error } = await supabase
    .from('households')
    .insert({ owner_user_id: user.id, name: name.trim(), household_type, total_net_worth_usd: 0, metadata: {} })
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data, undefined)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { id, ...updates } = body
  if (!id) return apiError('id is required')

  const { data, error } = await supabase
    .from('households')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}
