import 'server-only'
import matter from 'gray-matter'
import type { CIODecision, TradeContext } from '@/lib/agents/types'
import type { DecisionFrontmatter, ResearchFrontmatter, OutcomeFrontmatter } from './types'
import type { TradeEvent, PositionClosedEvent, PositionSettledEvent } from '@/lib/meta-poly/ws'

function now(): string {
  return new Date().toISOString()
}

function stringify(fm: Record<string, unknown>, body: string): string {
  return matter.stringify(body, fm)
}

// ─── Decision Note ────────────────────────────────────────────────────────────

export function renderDecisionNote(
  decision: CIODecision,
  ctx: Pick<TradeContext, 'trade'>,
): { path: string; content: string } {
  const ts = now()
  const d = new Date(ts)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const date = ts.slice(0, 10)
  const slug = `${date}-${ctx.trade.symbol}-${decision.decision}`
  const path = `decisions/${year}/${month}/${slug}.md`

  const fm: DecisionFrontmatter = {
    type: 'decision',
    created: ts,
    updated: ts,
    tags: ['decision', ctx.trade.symbol, ctx.trade.asset_class, decision.decision],
    symbol: ctx.trade.symbol,
    action: ctx.trade.action === 'short' || ctx.trade.action === 'cover' ? 'sell' : ctx.trade.action,
    decision: decision.decision,
    finalScore: decision.finalScore,
    confidence: decision.confidence === 'high' ? 3 : decision.confidence === 'medium' ? 2 : 1,
    accountPlacement: decision.accountPlacement,
  }

  const topAgents = Object.entries(decision.agentScores)
    .filter(([k]) => k !== 'OrchestratorAgent')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const agentRows = topAgents
    .map(([name, score]) => {
      const out = decision.agentOutputs.find(o => o.agent === name)
      const short = name.replace(/Agent$/, '')
      return `| ${short} | ${score.toFixed(0)} | ${out?.recommendation ?? '—'} |`
    })
    .join('\n')

  const riskList = decision.riskFactors.map(r => `- ${r}`).join('\n')

  const body = `## Summary

${decision.plainEnglishSummary}

## Decision: ${decision.decision.toUpperCase()}

**Final Score:** ${decision.finalScore.toFixed(1)}/100
**Confidence:** ${decision.confidence}
**Account:** ${decision.accountPlacement}
**Timing:** ${decision.timing}

## Position Sizing

| Recommended | Max Allowed |
|-------------|-------------|
| ${decision.positionSizing.recommended_pct}% | ${decision.positionSizing.max_pct}% |

${decision.positionSizing.rationale}

## Committee Reasoning

${decision.investmentCommitteeView}

## Portfolio Impact

${decision.portfolioImpact}

## Agent Scores

| Agent | Score | Recommendation |
|-------|-------|----------------|
${agentRows}

## Risk Factors

${riskList || '_None identified._'}

## Trade Context

- **Symbol:** [[${ctx.trade.symbol}]]
- **Action:** ${ctx.trade.action}
- **Asset Class:** ${ctx.trade.asset_class}
- **Notional:** $${ctx.trade.notional_value.toLocaleString()}
- **Trader:** ${ctx.trade.trader_name} (@${ctx.trade.trader_handle})
- **Trader Return:** ${ctx.trade.trader_return_pct}%  Win Rate: ${ctx.trade.trader_win_rate}%
`

  return { path, content: stringify(fm as unknown as Record<string, unknown>, body) }
}

// ─── Research Note ────────────────────────────────────────────────────────────

export function renderResearchNote(
  title: string,
  body: string,
  meta: Partial<Pick<ResearchFrontmatter, 'ticker' | 'sector' | 'source' | 'tags'>>,
): { path: string; content: string } {
  const ts = now()
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const path = `research/${slug}.md`

  const fm: ResearchFrontmatter = {
    type: 'research',
    created: ts,
    updated: ts,
    tags: ['research', ...(meta.tags ?? [])],
    ...(meta.ticker ? { ticker: meta.ticker } : {}),
    ...(meta.sector ? { sector: meta.sector } : {}),
    ...(meta.source ? { source: meta.source } : {}),
  }

  const content = `## ${title}\n\n${body}`

  return { path, content: stringify(fm as unknown as Record<string, unknown>, content) }
}

// ─── Outcome Note ─────────────────────────────────────────────────────────────

export interface OutcomeInput {
  symbol: string
  originalDecision: OutcomeFrontmatter['originalDecision']
  entryDate: string
  exitDate?: string
  pnlPct?: number
  hitTarget?: boolean
  notes?: string
}

export function renderOutcomeNote(input: OutcomeInput): { path: string; content: string } {
  const ts = now()
  const ed = new Date(input.entryDate)
  const year = ed.getUTCFullYear()
  const month = String(ed.getUTCMonth() + 1).padStart(2, '0')
  const slug = `${input.entryDate}-${input.symbol}-outcome`
  const path = `outcomes/${year}/${month}/${slug}.md`

  const fm: OutcomeFrontmatter = {
    type: 'outcome',
    created: ts,
    updated: ts,
    tags: ['outcome', input.symbol, input.originalDecision],
    symbol: input.symbol,
    originalDecision: input.originalDecision,
    entryDate: input.entryDate,
    ...(input.exitDate ? { exitDate: input.exitDate } : {}),
    ...(input.pnlPct !== undefined ? { pnlPct: input.pnlPct } : {}),
    ...(input.hitTarget !== undefined ? { hitTarget: input.hitTarget } : {}),
  }

  const pnlLine = input.pnlPct !== undefined
    ? `**P&L:** ${input.pnlPct >= 0 ? '+' : ''}${input.pnlPct.toFixed(2)}%`
    : '**P&L:** _pending_'

  const targetLine = input.hitTarget !== undefined
    ? `**Hit Target:** ${input.hitTarget ? 'Yes' : 'No'}`
    : '**Hit Target:** _pending_'

  const body = `## Outcome: [[${input.symbol}]]

- **Original Decision:** ${input.originalDecision}
- **Entry Date:** ${input.entryDate}
- **Exit Date:** ${input.exitDate ?? '_open_'}
- ${pnlLine}
- ${targetLine}

## Notes

${input.notes ?? '_No notes recorded._'}

## Links

- [[decisions/${input.entryDate}-${input.symbol}-${input.originalDecision}|Original Decision Note]]
- [[tickers/${input.symbol}|${input.symbol} Ticker Page]]
`

  return { path, content: stringify(fm as unknown as Record<string, unknown>, body) }
}

// ─── Polymarket trade note (decision) ─────────────────────────────────────────

export function renderPolyTradeNote(
  event: TradeEvent,
): { path: string; content: string } {
  const ts = now()
  const d = new Date(ts)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const date = ts.slice(0, 10)
  const slug = event.market_id.slice(0, 8)
  const path = `decisions/${year}/${month}/${date}-poly-${slug}-${event.side.toLowerCase()}.md`

  const fm = {
    type: 'decision',
    created: ts,
    updated: ts,
    tags: ['decision', 'polymarket', event.strategy, event.side.toLowerCase()],
    market_id: event.market_id,
    side: event.side,
    strategy: event.strategy,
    entry_price: event.price,
    size_usdc: event.size,
    paper: event.paper,
  }

  const body = `## Polymarket Trade Opened

| Field | Value |
|-------|-------|
| Market ID | \`${event.market_id}\` |
| Side | **${event.side}** |
| Strategy | ${event.strategy} |
| Entry Price | ${(event.price * 100).toFixed(1)}¢ |
| Size | $${event.size.toFixed(2)} |
| Mode | ${event.paper ? 'Paper' : '**LIVE**'} |

## Notes

_Trade opened via Meta_Poly_tarder scheduler._
`

  return { path, content: stringify(fm as unknown as Record<string, unknown>, body) }
}

// ─── Polymarket outcome note ──────────────────────────────────────────────────

export function renderPolyOutcomeNote(
  event: PositionClosedEvent | PositionSettledEvent,
): { path: string; content: string } {
  const ts = now()
  const d = new Date(ts)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const date = ts.slice(0, 10)
  const slug = event.market_id.slice(0, 8)
  const path = `outcomes/${year}/${month}/${date}-poly-${slug}-outcome.md`

  const isSettled = 'outcome' in event
  const reason = 'reason' in event ? (event as PositionClosedEvent).reason : undefined
  const outcome = isSettled ? (event as PositionSettledEvent).outcome : undefined

  const fm = {
    type: 'outcome',
    created: ts,
    updated: ts,
    tags: ['outcome', 'polymarket'],
    market_id: event.market_id,
    pnl: event.pnl,
    ...(reason ? { exit_reason: reason } : {}),
    ...(outcome ? { market_outcome: outcome } : {}),
  }

  const pnlStr = `${event.pnl >= 0 ? '+' : ''}$${event.pnl.toFixed(2)}`

  const body = `## Polymarket Position Closed

| Field | Value |
|-------|-------|
| Market ID | \`${event.market_id}\` |
| P&L | **${pnlStr}** |
${reason ? `| Exit Reason | ${reason} |` : ''}
${outcome ? `| Market Outcome | ${outcome} |` : ''}

## Notes

_Position closed via ${isSettled ? 'market settlement' : 'scheduler exit signal'}._
`

  return { path, content: stringify(fm as unknown as Record<string, unknown>, body) }
}
