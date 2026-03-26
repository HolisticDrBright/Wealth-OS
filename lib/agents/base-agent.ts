import Anthropic from '@anthropic-ai/sdk'
import type { TradeContext, AgentOutput, AgentRecommendation, ConfidenceLevel } from './types'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic()

export abstract class BaseAgent {
  abstract readonly name: string
  abstract readonly model: string
  abstract buildSystemPrompt(): string

  // Override to filter context for this agent (e.g. crypto agent only for crypto trades)
  shouldRun(context: TradeContext): boolean {
    return true
  }

  async run(context: TradeContext): Promise<AgentOutput> {
    const start = Date.now()

    if (!this.shouldRun(context)) {
      return {
        agent: this.name,
        recommendation: 'approve',
        confidence: 'low',
        score: 50,
        reasoning: `${this.name} not applicable for ${context.trade.asset_class} trades.`,
        keyPoints: [],
      }
    }

    const userPrompt = this.buildUserPrompt(context)

    try {
      const msg = await anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: userPrompt }],
      })

      const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as Partial<AgentOutput>

      const output: AgentOutput = {
        agent: this.name,
        recommendation: (parsed.recommendation as AgentRecommendation) ?? 'approve',
        confidence: (parsed.confidence as ConfidenceLevel) ?? 'medium',
        score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50,
        reasoning: parsed.reasoning ?? '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        metadata: parsed.metadata,
      }

      await this.logToAudit(context, output, Date.now() - start)
      return output
    } catch (err) {
      console.error(`[${this.name}] error:`, err)
      return {
        agent: this.name,
        recommendation: 'defer',
        confidence: 'low',
        score: 50,
        reasoning: `Agent error: ${err instanceof Error ? err.message : 'Unknown'}`,
        keyPoints: [],
      }
    }
  }

  protected buildUserPrompt(context: TradeContext): string {
    const { trade, user } = context
    const portfolioSummary = user.portfolio
      .slice(0, 8)
      .map(a => `${a.name} (${a.category}): $${a.current_value.toLocaleString()}`)
      .join('\n  ')

    return `PROPOSED COPY TRADE:
Symbol: ${trade.symbol}
Action: ${trade.action.toUpperCase()}
Asset Class: ${trade.asset_class}
Size: $${trade.notional_value.toLocaleString()}
Trader: ${trade.trader_name} (@${trade.trader_handle})
Trader Stats: ${trade.trader_return_pct}% 30d return, ${trade.trader_win_rate}% win rate

USER PROFILE:
Net Worth: $${user.total_net_worth.toLocaleString()}
Risk Profile: ${user.risk_profile ?? 'moderate'}
Portfolio:
  ${portfolioSummary}

Return your analysis as JSON:
{
  "recommendation": "approve"|"reduce"|"reject"|"defer",
  "confidence": "high"|"medium"|"low",
  "score": <0-100>,
  "reasoning": "<clear explanation>",
  "keyPoints": ["<point 1>", "<point 2>", "<point 3>"]
}`
  }

  private async logToAudit(context: TradeContext, output: AgentOutput, durationMs: number) {
    try {
      const supabase = createAdminClient()
      await supabase.from('audit_logs').insert({
        user_id: context.user.id,
        agent_name: this.name,
        trade_context: {
          symbol: context.trade.symbol,
          action: context.trade.action,
          notional: context.trade.notional_value,
        },
        output,
        duration_ms: durationMs,
      })
    } catch {
      // Non-critical — don't fail if audit logging fails
    }
  }
}
