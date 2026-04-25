import Anthropic from '@anthropic-ai/sdk'
import { VAULT_TOOLS, dispatchVaultTool, isVaultToolName } from '../tools/vault-tools'
import type {
  HealthResponse,
  Market,
  Signal,
  PortfolioPosition,
  PortfolioStats,
} from '@/lib/meta-poly/types'

// ─── Context & output types ───────────────────────────────────────────────────

export interface PolymarketContext {
  health: HealthResponse
  topMarkets: Market[]
  recentSignals: Signal[]
  openPositions: PortfolioPosition[]
  portfolioStats: PortfolioStats
}

export interface MarketOpportunity {
  marketId: string
  question: string
  side: 'YES' | 'NO'
  rationale: string
  confidence: 'high' | 'medium' | 'low'
}

export interface PolymarketAnalysis {
  summary: string
  opportunities: MarketOpportunity[]
  portfolioAssessment: string
  riskWarnings: string[]
  sentiment: 'bullish' | 'neutral' | 'bearish'
  vaultPath: string | null
}

// ─── Agent ────────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6'
const MAX_TOOL_ROUNDS = 5

const anthropic = new Anthropic()

export class PolymarketIntelligenceAgent {
  readonly name = 'PolymarketIntelligenceAgent'
  readonly model = MODEL

  private buildSystemPrompt(): string {
    return `You are a Polymarket intelligence analyst embedded in Wealth OS.

Your job is to:
1. Identify the highest-edge prediction market opportunities from current signal and entropy data
2. Assess the health and risk concentration of the open paper-trading portfolio
3. Flag any risk warnings (e.g. over-concentration, stale positions, high spread)
4. Synthesise a concise actionable brief for the trader

You have access to vault tools. At the start of your analysis:
- Call vault_list with prefix "research/polymarket/" to find recent briefs
- If any exist, call vault_read on the most recent to build context on prior analysis
- After forming your analysis, call vault_write to save a Markdown brief under
  research/polymarket/YYYY/MM/YYYY-MM-DD-brief.md (use today's UTC date)

The brief frontmatter should be:
---
date: YYYY-MM-DD
agent: PolymarketIntelligenceAgent
sentiment: bullish|neutral|bearish
opportunities: <count>
---

After all tool calls, return a single JSON object (and nothing else):
{
  "summary": "<2-3 sentence executive summary>",
  "opportunities": [
    {
      "marketId": "<id>",
      "question": "<question>",
      "side": "YES" | "NO",
      "rationale": "<why this market has edge>",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "portfolioAssessment": "<1-2 sentences on portfolio health>",
  "riskWarnings": ["<warning 1>", "<warning 2>"],
  "sentiment": "bullish" | "neutral" | "bearish"
}`
  }

  private buildUserPrompt(ctx: PolymarketContext): string {
    const { health, topMarkets, recentSignals, openPositions, portfolioStats } = ctx

    const topMarketsText = topMarkets
      .slice(0, 10)
      .map(
        m =>
          `  • ${m.question.slice(0, 80)} | YES ${(m.yes_price * 100).toFixed(1)}¢` +
          ` | liq $${(m.liquidity / 1000).toFixed(0)}k` +
          (m.arb_edge > 0.005 ? ` | ARB ${(m.arb_edge * 100).toFixed(1)}%` : '') +
          (m.entropy_bits > 0 ? ` | ${m.entropy_bits.toFixed(2)} bits` : '')
      )
      .join('\n')

    const signalsText = recentSignals
      .slice(0, 10)
      .map(
        s =>
          `  • [${s.strategy}] ${s.side} ${s.question.slice(0, 60)} ` +
          `conf=${(s.confidence * 100).toFixed(0)}%` +
          (s.kl_divergence > 0 ? ` KL=${s.kl_divergence.toFixed(4)}` : '')
      )
      .join('\n')

    const positionsText =
      openPositions.length === 0
        ? '  (none)'
        : openPositions
            .map(
              p =>
                `  • [${p.strategy}] ${p.side} ${p.question.slice(0, 60)} ` +
                `pnl=${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)}`
            )
            .join('\n')

    return `POLYMARKET INTELLIGENCE CONTEXT — ${new Date().toISOString().slice(0, 10)}

SIDECAR STATUS
  Scheduler running: ${health.scheduler_running}
  Paper trading: ${health.paper_trading}
  Balance: $${portfolioStats.balance.toFixed(2)} (started $${portfolioStats.starting_capital})
  Positions: ${openPositions.length}  Pending signals: ${health.pending_signals}

PORTFOLIO STATS
  Unrealized P&L: ${portfolioStats.unrealized_pnl >= 0 ? '+' : ''}$${portfolioStats.unrealized_pnl.toFixed(2)}
  Win rate: ${(portfolioStats.win_rate * 100).toFixed(1)}%
  Sharpe: ${portfolioStats.sharpe_ratio.toFixed(2)}
  Max drawdown: ${(portfolioStats.max_drawdown * 100).toFixed(1)}%
  Exposure: $${portfolioStats.total_exposure.toFixed(2)}

TOP MARKETS (${topMarkets.length} loaded)
${topMarketsText || '  (none)'}

RECENT SIGNALS (${recentSignals.length} total, showing top 10)
${signalsText || '  (none)'}

OPEN POSITIONS
${positionsText}

Analyse this data. Use vault tools to read recent context, then write a brief and return JSON.`
  }

  async analyze(ctx: PolymarketContext): Promise<PolymarketAnalysis> {
    const fallback: PolymarketAnalysis = {
      summary: 'Analysis unavailable.',
      opportunities: [],
      portfolioAssessment: '',
      riskWarnings: [],
      sentiment: 'neutral',
      vaultPath: null,
    }

    try {
      const baseParams = {
        model: this.model,
        max_tokens: 2048,
        system: this.buildSystemPrompt(),
      }

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: this.buildUserPrompt(ctx) },
      ]

      let msg = await anthropic.messages.create({
        ...baseParams,
        tools: VAULT_TOOLS,
        messages,
      })

      let vaultPath: string | null = null
      let rounds = 0

      while (msg.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
        rounds++
        messages.push({ role: 'assistant', content: msg.content })

        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          msg.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map(async block => {
              // Capture vault_write path for metadata
              if (block.name === 'vault_write') {
                const input = block.input as { path?: string }
                if (input.path) vaultPath = input.path
              }
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: isVaultToolName(block.name)
                  ? await dispatchVaultTool(block.name, block.input, this.name)
                  : JSON.stringify({ error: `Unknown tool: ${block.name}` }),
              }
            })
        )

        messages.push({ role: 'user', content: toolResults })
        msg = await anthropic.messages.create({
          ...baseParams,
          tools: VAULT_TOOLS,
          messages,
        })
      }

      const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as Partial<PolymarketAnalysis>

      return {
        summary: parsed.summary ?? fallback.summary,
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
        portfolioAssessment: parsed.portfolioAssessment ?? '',
        riskWarnings: Array.isArray(parsed.riskWarnings) ? parsed.riskWarnings : [],
        sentiment: parsed.sentiment ?? 'neutral',
        vaultPath,
      }
    } catch (err) {
      console.error(`[${this.name}] error:`, err)
      return {
        ...fallback,
        summary: `Analysis error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  }
}
