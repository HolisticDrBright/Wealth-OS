import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const asset_class = searchParams.get('asset_class') ?? undefined
  const is_free = searchParams.get('is_free') === 'true' ? true : undefined
  const sort = (searchParams.get('sort') ?? 'subscribers') as 'subscribers' | 'return' | 'rating' | 'newest'

  const supabase = await createClient()
  let query = supabase
    .from('marketplace_listings')
    .select('*')
    .eq('is_published', true)

  if (asset_class) query = query.contains('asset_classes', [asset_class])
  if (is_free) query = query.eq('price_monthly_usd', 0)

  const sortMap = { subscribers: 'subscriber_count', return: 'total_return_pct', rating: 'avg_rating', newest: 'created_at' }
  query = query.order(sortMap[sort] ?? 'subscriber_count', { ascending: false }).limit(50)

  const { data, error } = await query
  if (error) return apiError(error.message, 500)
  return apiSuccess(data, { count: data.length })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const { title, description, strategy_type, asset_classes, price_monthly_usd, trader_id } = body

  if (!title?.trim()) return apiError('title is required')

  const { data, error } = await supabase
    .from('marketplace_listings')
    .insert({
      publisher_user_id: user.id,
      title: title.trim(),
      description,
      strategy_type: strategy_type ?? 'copy_trade',
      asset_classes: asset_classes ?? [],
      price_monthly_usd: price_monthly_usd ?? 0,
      trader_id: trader_id ?? null,
      is_published: false,
      metadata: {},
    })
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data, undefined)
}
