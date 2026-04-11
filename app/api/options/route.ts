/**
 * GET  /api/options          — list user's option positions
 * POST /api/options          — add a new option position
 * PATCH /api/options?id=...  — update current_price / underlying_price
 * DELETE /api/options?id=... — close (soft-delete) a position
 *
 * GET /api/options/greeks?symbol=AAPL&strike=200&expiry=2025-01-17&type=call&vol=0.25
 *   — compute live Black-Scholes price + Greeks
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { blackScholes, computeGreeks, computeOptionPnL, type OptionType } from '@/lib/options'
import { getQuote } from '@/lib/market-data'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)

  // Greeks calculator endpoint
  if (searchParams.get('action') === 'greeks') {
    const symbol = searchParams.get('symbol')?.toUpperCase()
    const strike = Number(searchParams.get('strike'))
    const expiry = searchParams.get('expiry')
    const type = (searchParams.get('type') ?? 'call') as OptionType
    const vol = Number(searchParams.get('vol') ?? '0.25')
    const rate = Number(searchParams.get('rate') ?? '0.05')

    if (!symbol || !strike || !expiry) return apiError('symbol, strike, expiry required')

    const quote = await getQuote(symbol)
    const S = quote?.price ?? strike
    const T = Math.max(0, (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365))
    const price = blackScholes(S, strike, T, rate, vol, type)
    const greeks = computeGreeks(S, strike, T, rate, vol, type)
    return apiSuccess({ symbol, strike, expiry, type, underlyingPrice: S, theoreticalPrice: price, greeks })
  }

  const { data } = await supabase
    .from('option_positions')
    .select('*')
    .eq('user_id', user.id)
    .is('closed_at', null)
    .order('expiration', { ascending: true })

  // Enrich with live P&L
  const enriched = (data ?? []).map(pos => {
    const pnl = computeOptionPnL(pos)
    return { ...pos, pnl }
  })

  return apiSuccess(enriched)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const {
    symbol, option_type, strategy, strike, expiration,
    contracts = 1, premium_paid, is_short = false
  } = body

  if (!symbol || !option_type || !strike || !expiration || premium_paid == null) {
    return apiError('symbol, option_type, strike, expiration, premium_paid required')
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('option_positions')
    .insert({
      user_id: user.id,
      symbol: symbol.toUpperCase(),
      option_type,
      strategy: strategy ?? (is_short ? `short_${option_type}` : `long_${option_type}`),
      strike,
      expiration,
      contracts,
      premium_paid,
      is_short,
    })
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return apiError('id required')

  const body = await req.json()
  const { current_price, underlying_price } = body

  const { data, error } = await supabase
    .from('option_positions')
    .update({ current_price, underlying_price })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return apiError(error.message, 500)
  return apiSuccess(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return apiError('id required')

  const { error } = await supabase
    .from('option_positions')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return apiError(error.message, 500)
  return apiSuccess({ closed: true })
}
