import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError, getBearerToken } from '@/lib/api'
import Anthropic from '@anthropic-ai/sdk'

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
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return apiError(error.message, 500)
  return apiSuccess(data ?? [], { count: data?.length ?? 0 })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { symbol, asset_class, context } = body

  if (!symbol) return apiError('symbol required', 400)

  // Run a quick AI screener via Claude
  let opportunity = null

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `You are a financial screener. Analyze ${symbol} (${asset_class ?? 'stock'}) as a trading opportunity.
${context ? `Context: ${context}` : ''}
Return JSON only:
{
  "title": "short opportunity title",
  "description": "2-3 sentence analysis",
  "action": "buy|sell|watch",
  "confidence": "high|medium|low",
  "score": 0-100
}`,
        }],
      })

      const text = (msg.content[0] as { text: string }).text
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const supabase = createAdminClient()
        const { data } = await supabase
          .from('opportunities')
          .insert({
            user_id: userId,
            source: 'screener',
            symbol,
            asset_class: asset_class ?? 'stock',
            is_read: false,
            metadata: { screener_context: context },
            ...parsed,
          })
          .select()
          .single()
        opportunity = data
      }
    } catch { /* fallback below */ }
  }

  if (!opportunity) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('opportunities')
      .insert({
        user_id: userId,
        source: 'screener',
        symbol,
        asset_class: asset_class ?? 'stock',
        title: `${symbol} Screener Result`,
        description: 'Manual screener entry — add ANTHROPIC_API_KEY for AI analysis.',
        action: 'watch',
        confidence: 'low',
        score: 50,
        is_read: false,
        metadata: {},
      })
      .select()
      .single()
    opportunity = data
  }

  return apiSuccess(opportunity, { screened: true })
}
