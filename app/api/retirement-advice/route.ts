import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { RetirementPlan } from '@/lib/types'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your-anthropic-api-key-here') {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 500 })
  }

  const plan: RetirementPlan = await req.json()

  const yearsToRetirement = (plan.target_retirement_age ?? 65) - (plan.current_age ?? 35)
  const totalSavings =
    plan.current_savings_usd +
    plan.ira_balance_usd +
    plan.roth_ira_balance_usd +
    plan.k401_balance_usd +
    plan.taxable_balance_usd

  const systemPrompt = `You are a certified financial planner (CFP) and retirement specialist.
Analyze the user's retirement plan and provide highly personalized, actionable advice.
Use their exact numbers. Format with markdown sections:
1. **Retirement Readiness Score** (0–100) with brief rationale
2. **Key Findings** — what's working, what needs attention
3. **Top 5 Action Items** — specific, numbered, dollar-amounts where applicable
4. **Account Optimization** — IRA/Roth/401k/taxable allocation advice
5. **Risk & Projection Notes** — assumptions, what if scenarios
6. **Timeline Milestones** — key ages and targets to hit

Be concise, specific, and actionable. Reference their actual numbers throughout.`

  const userMessage = `Here is my retirement plan data:

**Current Situation:**
- Current Age: ${plan.current_age ?? 'Not set'}
- Target Retirement Age: ${plan.target_retirement_age}
- Years to Retirement: ${yearsToRetirement}
- Total Savings: $${totalSavings.toLocaleString()}
  - Current Savings: $${plan.current_savings_usd.toLocaleString()}
  - 401(k): $${plan.k401_balance_usd.toLocaleString()}
  - Traditional IRA: $${plan.ira_balance_usd.toLocaleString()}
  - Roth IRA: $${plan.roth_ira_balance_usd.toLocaleString()}
  - Taxable Accounts: $${plan.taxable_balance_usd.toLocaleString()}

**Contributions & Returns:**
- Annual Contribution: $${plan.annual_contribution_usd.toLocaleString()}
- Expected Return: ${plan.expected_return_pct}% per year
- Inflation Rate: ${plan.inflation_rate_pct}% per year

**Retirement Income Needs:**
- Target Monthly Income: $${(plan.target_monthly_income_usd ?? 0).toLocaleString()}
- Social Security (est.): $${plan.social_security_monthly_usd.toLocaleString()}/month
- Pension: $${plan.pension_monthly_usd.toLocaleString()}/month

**Current Projections:**
- Projected Balance at Retirement: $${(plan.projected_retirement_balance_usd ?? 0).toLocaleString()}
- Monthly Income Gap: $${(plan.income_gap_monthly_usd ?? 0).toLocaleString()}
- On Track: ${plan.on_track ? 'Yes' : 'No'}

Please provide personalized retirement advice for 2026 and beyond.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = await client.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 3000,
          thinking: { type: 'adaptive' },
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
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
