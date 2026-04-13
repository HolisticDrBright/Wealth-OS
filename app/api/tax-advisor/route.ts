import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your-anthropic-api-key-here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const { assets, transactions, goals = [], income } = body

  if (!Array.isArray(assets) || !Array.isArray(transactions)) {
    return NextResponse.json({ error: 'assets and transactions arrays are required' }, { status: 400 })
  }

  const totalAssetValue = assets.reduce((s: number, a: { current_value: number }) => s + (a.current_value ?? 0), 0)
  const totalIncome = transactions
    .filter((t: { type: string; amount: number }) => t.type === 'income')
    .reduce((s: number, t: { amount: number }) => s + t.amount, 0)
  const totalExpenses = transactions
    .filter((t: { type: string; amount: number }) => t.type === 'expense')
    .reduce((s: number, t: { amount: number }) => s + t.amount, 0)

  const assetSummary = assets.map((a: { name: string; category: string; current_value: number; purchase_price?: number; symbol?: string }) => ({
    name: a.name,
    category: a.category,
    value: a.current_value,
    gainLoss: a.purchase_price ? a.current_value - a.purchase_price : null,
    symbol: a.symbol,
  }))

  const goalSummary = goals.map((g: { name: string; target_amount: number; current_amount: number; target_date?: string }) => ({
    name: g.name,
    target: g.target_amount,
    current: g.current_amount,
    targetDate: g.target_date,
  }))

  const systemPrompt = `You are an expert US tax advisor and financial planner with deep knowledge of current tax law.
Analyze the user's financial data and provide highly personalized, actionable tax optimization strategies for 2026.
Be specific, concrete, and reference actual numbers from their data.
Format your response with clear sections using markdown. Include:
1. **Tax Situation Summary** - brief assessment based on their data
2. **Top 5 Tax Optimization Strategies** - numbered, with specific dollar estimates where possible
3. **Investment Tax Efficiency** - analysis of their portfolio tax exposure
4. **Important 2026 Deadlines** - specific dates relevant to their situation
5. **Next Steps** - prioritized action items

Be precise and actionable. Reference their actual asset names, amounts, and categories in your advice.`

  const userMessage = `Here is my current financial data for tax optimization analysis:

**Portfolio Summary:**
- Total Asset Value: $${totalAssetValue.toLocaleString()}
- Assets: ${JSON.stringify(assetSummary, null, 2)}

**Income & Expenses (from tracked transactions):**
- Tracked Income: $${totalIncome.toLocaleString()}
- Tracked Expenses: $${totalExpenses.toLocaleString()}
${income ? `- Reported Annual Income: $${income.toLocaleString()}` : ''}

**Financial Goals:**
${goalSummary.length > 0 ? JSON.stringify(goalSummary, null, 2) : 'No goals set yet'}

Please analyze this data and provide personalized tax optimization strategies for 2026.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = await client.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text))
            }
          }
        }

        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`\n\n**Error:** ${msg}`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
