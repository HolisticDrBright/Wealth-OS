import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const sleeveId = searchParams.get('id')

  if (sleeveId) {
    const { data } = await supabase
      .from('portfolio_sleeves')
      .select('*, positions:sleeve_positions(*), pending_approvals:sleeve_approval_requests(*)')
      .eq('id', sleeveId)
      .eq('user_id', user.id)
      .single()

    if (!data) return apiError('Sleeve not found', 404)
    return apiSuccess(data)
  }

  const { data } = await supabase
    .from('portfolio_sleeves')
    .select('*, positions:sleeve_positions(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return apiSuccess(data ?? [], { count: data?.length ?? 0 })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { name, description, sleeve_type = 'autonomous', ...rest } = body
  if (!name?.trim()) return apiError('name is required')

  const { data, error } = await supabase
    .from('portfolio_sleeves')
    .insert({
      user_id: user.id,
      name: name.trim(),
      description,
      sleeve_type,
      current_value_usd: 0,
      is_active: true,
      approval_required: true,
      approval_threshold_usd: 1000,
      approved_strategies: [],
      approved_asset_classes: rest.approved_asset_classes ?? ['stock'],
      max_position_pct: rest.max_position_pct ?? 10,
      max_drawdown_pct: rest.max_drawdown_pct ?? 20,
      halt_on_breach: true,
      halted: false,
      metadata: {},
      ...rest,
    })
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
    .from('portfolio_sleeves')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}
