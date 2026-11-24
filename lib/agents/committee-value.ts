/**
 * AI committee: cost vs value (roadmap #7) — PURE.
 *
 * For every agent that can say "no" to a trade:
 *   cost        what its model calls cost (llm_usage_log, real tokens × price)
 *   veto value  for each graded trade it voted to REJECT, what that trade
 *               would have made after costs, sign-flipped: a vetoed loser is
 *               money saved (+), a vetoed winner is money lost (−). Counted
 *               whether or not the committee followed it — it grades the
 *               agent's signal.
 *   net         veto value − cost
 *
 * Copy-trade committee agents are graded from committee_runs; the strategy
 * pipeline's Kronos / MiroFish / red-team blocks from the shadow portfolio
 * (what blocked trades did afterwards).
 */

import { COMMITTEE_MIN_GRADED_VETOES, PROTECTED_COMMITTEE_AGENTS } from '@/lib/config/product-defaults'

export interface GradedRun {
  votes: Record<string, string>
  outcomeReturn: number | null
  notionalUsd: number
  decision: string
}

export interface UsageRow { agentName: string | null; caller: string; costUsd: number | null; ok: boolean }

export type AgentVerdict = 'keep' | 'cut' | 'never_vetoes' | 'failing' | 'not_enough_evidence' | 'protected'

export interface AgentValueRow {
  agent: string
  /** 'committee' (copy trades) or 'strategy' (Kronos, MiroFish, red team). */
  path: 'committee' | 'strategy'
  calls: number
  failedCalls: number
  costUsd: number
  gradedVotes: number
  vetoes: number
  /** Vetoes of trades that would have lost money. */
  rightVetoes: number
  vetoValueUsd: number
  netUsd: number
  verdict: AgentVerdict
  reason: string
  /** Turned off for this person right now. */
  disabled: boolean
  /** Whether the report allows turning it off (evidence-based, never protected). */
  canDisable: boolean
}

export interface CommitteeReport {
  agents: AgentValueRow[]
  totals: {
    runs: number
    gradedRuns: number
    committeeCostUsd: number
    strategyAiCostUsd: number
    otherAiCostUsd: number
    costPerRunUsd: number | null
    vetoValueUsd: number
  }
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`

function verdictFor(r: Omit<AgentValueRow, 'verdict' | 'reason' | 'canDisable'>): { verdict: AgentVerdict; reason: string } {
  if (PROTECTED_COMMITTEE_AGENTS.includes(r.agent)) {
    return { verdict: 'protected', reason: 'Its "no" is a safety rule, not a vote — it is never turned off here.' }
  }
  if (r.calls >= 10 && r.failedCalls >= r.calls / 2) {
    return { verdict: 'failing', reason: `${r.failedCalls} of ${r.calls} calls failed — it costs money but mostly abstains.` }
  }
  if (r.vetoes >= COMMITTEE_MIN_GRADED_VETOES) {
    return r.vetoValueUsd > r.costUsd
      ? { verdict: 'keep', reason: `Its ${r.vetoes} vetoes saved ${usd(r.vetoValueUsd)} against ${usd(r.costUsd)} of calls.` }
      : { verdict: 'cut', reason: `Its ${r.vetoes} vetoes were worth ${usd(r.vetoValueUsd)} — not enough to cover ${usd(r.costUsd)} of calls.` }
  }
  if (r.path === 'strategy' && r.vetoes === 0) {
    return {
      verdict: 'not_enough_evidence',
      reason: r.calls > 0
        ? `No graded blocks yet — it only blocks or shrinks trades, and only blocked ones are shadow-tracked. ${usd(r.costUsd)} of calls so far.`
        : 'No calls or graded blocks in this period.',
    }
  }
  if (r.vetoes === 0 && r.gradedVotes >= COMMITTEE_MIN_GRADED_VETOES) {
    return { verdict: 'never_vetoes', reason: `It voted on ${r.gradedVotes} graded trades and never said no — ${usd(r.costUsd)} for no veto.` }
  }
  return {
    verdict: 'not_enough_evidence',
    reason: `${r.vetoes} graded veto${r.vetoes === 1 ? '' : 'es'} so far — needs ${COMMITTEE_MIN_GRADED_VETOES} to judge.`,
  }
}

function finish(r: Omit<AgentValueRow, 'verdict' | 'reason' | 'canDisable'>): AgentValueRow {
  const v = verdictFor(r)
  const canDisable = r.path === 'committee' && ['cut', 'never_vetoes', 'failing'].includes(v.verdict)
  return { ...r, ...v, canDisable }
}

export function committeeReport(args: {
  runs: GradedRun[]
  totalRuns: number
  usage: UsageRow[]
  committeeAgents: string[]
  /** Strategy-path blocks from the shadow portfolio: realized P&L of each blocked trade. */
  shadowBlocks: Record<string, number[]>
  /** Which strategy-path agents' calls are metered under which caller. */
  strategyCallers: Record<string, string | null>
  disabled: string[]
}): CommitteeReport {
  const costBy = new Map<string, { calls: number; failed: number; cost: number }>()
  const bump = (key: string, u: UsageRow) => {
    const c = costBy.get(key) ?? { calls: 0, failed: 0, cost: 0 }
    c.calls++; if (!u.ok) c.failed++; c.cost += u.costUsd ?? 0
    costBy.set(key, c)
  }
  let committeeCost = 0, strategyCost = 0, otherCost = 0
  const strategyCallerSet = new Set(Object.values(args.strategyCallers).filter((x): x is string => !!x))
  for (const u of args.usage) {
    const cost = u.costUsd ?? 0
    if (u.caller === 'committee' || u.caller === 'cio_synthesis') {
      committeeCost += cost
      if (u.agentName) bump(`committee:${u.agentName}`, u)
    } else if (strategyCallerSet.has(u.caller)) {
      strategyCost += cost
      bump(`caller:${u.caller}`, u)
    } else {
      otherCost += cost
    }
  }

  const graded = args.runs.filter(r => r.outcomeReturn != null)
  const committeeRows = args.committeeAgents.map(agent => {
    let gradedVotes = 0, vetoes = 0, right = 0, value = 0
    for (const r of graded) {
      const v = r.votes[agent]
      if (!v || v === 'defer' || v === 'disabled') continue
      gradedVotes++
      if (v === 'reject') {
        vetoes++
        const pnl = r.outcomeReturn! * r.notionalUsd
        value += -pnl
        if (pnl < 0) right++
      }
    }
    const c = costBy.get(`committee:${agent}`) ?? { calls: 0, failed: 0, cost: 0 }
    return finish({
      agent, path: 'committee', calls: c.calls, failedCalls: c.failed, costUsd: c.cost,
      gradedVotes, vetoes, rightVetoes: right, vetoValueUsd: value, netUsd: value - c.cost,
      disabled: args.disabled.includes(agent),
    })
  })

  const strategyRows = Object.entries(args.strategyCallers).map(([agent, caller]) => {
    const pnls = args.shadowBlocks[agent] ?? []
    const value = pnls.reduce((s, p) => s - p, 0)
    const c = caller ? (costBy.get(`caller:${caller}`) ?? { calls: 0, failed: 0, cost: 0 }) : { calls: 0, failed: 0, cost: 0 }
    return finish({
      agent, path: 'strategy', calls: c.calls, failedCalls: c.failed, costUsd: c.cost,
      gradedVotes: pnls.length, vetoes: pnls.length, rightVetoes: pnls.filter(p => p < 0).length,
      vetoValueUsd: value, netUsd: value - c.cost, disabled: false,
    })
  })

  const agents = [...committeeRows, ...strategyRows].sort((a, b) => a.netUsd - b.netUsd)
  return {
    agents,
    totals: {
      runs: args.totalRuns,
      gradedRuns: graded.length,
      committeeCostUsd: committeeCost,
      strategyAiCostUsd: strategyCost,
      otherAiCostUsd: otherCost,
      costPerRunUsd: args.totalRuns > 0 ? committeeCost / args.totalRuns : null,
      vetoValueUsd: agents.reduce((s, a) => s + a.vetoValueUsd, 0),
    },
  }
}

/** Plain-English text recorded when an agent is turned off. */
export function cutSummary(row: AgentValueRow): string {
  return `Turn off ${row.agent} in my AI committee: ${row.reason} Its vote is dropped from future decisions; turn it back on any time.`
}
