/**
 * POST /api/portfolio-chat
 * Body: { message: string, conversationHistory?: Array<{role, content}> }
 *
 * Streams a Claude response with full portfolio context injected:
 * positions, net worth, recent orders, risk metrics, and budget.
 * The user can ask natural language questions about their portfolio.
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 503 })
  }

  const { message, conversationHistory = [] } = await req.json()
  if (!message?.trim()) return new Response('message required', { status: 400 })

  // Fetch portfolio context in parallel
  const [
    { data: assets },
    { data: transactions },
    { data: netWorth },
    { data: orders },
    { data: budget },
  ] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', user.id).limit(50),
    supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(20),
    supabase.from('net_worth_entries').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(6),
    supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('budgets').select('*').eq('user_id', user.id).limit(20),
  ])

  const totalAssets = assets?.reduce((s, a) => s + (a.current_value ?? 0), 0) ?? 0
  const latestNetWorth = netWorth?.[0]?.net_worth ?? 0

  const systemPrompt = `You are a sophisticated portfolio assistant for Wealth OS, a personal financial command center.
You have access to the user's full financial picture. Answer questions concisely and with specific numbers from their data.

PORTFOLIO SNAPSHOT:
- Total asset value: $${totalAssets.toLocaleString()}
- Latest net worth: $${latestNetWorth.toLocaleString()}

HOLDINGS (${assets?.length ?? 0} positions):
${assets?.map(a => `- ${a.name}${a.symbol ? ` (${a.symbol})` : ''}: $${(a.current_value ?? 0).toLocaleString()} [${a.category}]`).join('\n') ?? 'No holdings'}

RECENT TRANSACTIONS (last 20):
${transactions?.map(t => `- ${t.date}: ${t.type} $${Math.abs(t.amount).toLocaleString()} — ${t.description ?? t.category}`).join('\n') ?? 'None'}

NET WORTH TREND (last 6 months):
${netWorth?.map(n => `- ${n.date}: $${n.net_worth.toLocaleString()}`).join('\n') ?? 'No data'}

RECENT ORDERS (last 20):
${orders?.map(o => `- ${o.created_at?.slice(0, 10)}: ${o.side?.toUpperCase()} ${o.quantity ?? ''} ${o.symbol} @ ${o.order_type} — ${o.status}`).join('\n') ?? 'None'}

BUDGET CATEGORIES:
${budget?.map(b => `- ${b.category}: $${b.spent?.toLocaleString() ?? 0} spent / $${b.limit_amount?.toLocaleString() ?? 0} limit`).join('\n') ?? 'No budget set'}

Answer the user's question using this data. Be specific with numbers. If asked about allocation, exposure, or concentration — calculate it from the holdings above.
If asked about something not in the data (e.g., options greeks, live prices), say so and explain what data would be needed.`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory.slice(-10), // keep last 10 turns
    { role: 'user', content: message },
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  })
}
