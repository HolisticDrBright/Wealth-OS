/**
 * "What happened this week" (Phase 3.2c) — PURE plain-English sentence
 * generator. One sentence per action, each with a reason, no jargon. Inputs
 * come straight from existing tables (paper_trades, paper_positions,
 * audit_logs); nothing is invented.
 */

export interface WeeklyInputs {
  /** Closed paper positions this week. */
  closes: Array<{ symbol: string; exitReason: string | null; pnlUsd: number }>
  /** Newly opened paper positions this week. */
  opens: Array<{ symbol: string }>
  /** Blocked/skipped trade decisions this week (audit_logs decision='block'). */
  blocked: Array<{ reason: string | null }>
  /** True if trading was halted (paused) at any point this week. */
  halted: boolean
}

export const MAX_WEEKLY_SENTENCES = 5
const MAX_CLOSE_SENTENCES = 2

function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

function exitPhrase(exitReason: string | null): string {
  switch (exitReason) {
    case 'stop_loss':      return 'it hit the loss limit set when it was bought'
    case 'take_profit':    return 'it reached its profit target'
    case 'timeout':        return 'it reached its planned time limit'
    case 'manual_flatten': return 'you paused all trading'
    default:               return 'its exit rule triggered'
  }
}

function isCostReason(reason: string | null): boolean {
  if (!reason) return false
  const r = reason.toLowerCase()
  return r.includes('cost') || r.includes('fee') || r.includes('edge') || r.includes('slippage')
}

/** Up to MAX_WEEKLY_SENTENCES one-line items; [] when nothing happened. */
export function generateWeeklySummary(i: WeeklyInputs): string[] {
  const out: string[] = []

  if (i.halted) {
    out.push('You paused all trading — nothing new will be bought or sold until you turn it back on.')
  }

  for (const c of i.closes.slice(0, MAX_CLOSE_SENTENCES)) {
    const result = c.pnlUsd >= 0 ? `a ${money(c.pnlUsd)} gain` : `a ${money(c.pnlUsd)} loss`
    out.push(`Sold ${c.symbol} for ${result} because ${exitPhrase(c.exitReason)}.`)
  }
  const extraCloses = i.closes.length - MAX_CLOSE_SENTENCES
  if (extraCloses > 0) {
    const total = i.closes.slice(MAX_CLOSE_SENTENCES).reduce((s, c) => s + c.pnlUsd, 0)
    out.push(`Closed ${extraCloses} more position${extraCloses === 1 ? '' : 's'} for a combined ${total >= 0 ? 'gain' : 'loss'} of ${money(total)} as their exit rules triggered.`)
  }

  const costBlocked = i.blocked.filter(b => isCostReason(b.reason)).length
  const otherBlocked = i.blocked.length - costBlocked
  if (costBlocked > 0) {
    out.push(`Skipped ${costBlocked} trade idea${costBlocked === 1 ? '' : 's'} that would have cost more to place than ${costBlocked === 1 ? 'it was' : 'they were'} likely to earn.`)
  }
  if (otherBlocked > 0) {
    out.push(`Skipped ${otherBlocked} trade idea${otherBlocked === 1 ? '' : 's'} that didn't pass your safety rules.`)
  }

  if (i.opens.length === 1) {
    out.push(`Opened one new practice position in ${i.opens[0].symbol}, sized within your limits.`)
  } else if (i.opens.length > 1) {
    out.push(`Opened ${i.opens.length} new practice positions, each sized within your limits.`)
  }

  return out.slice(0, MAX_WEEKLY_SENTENCES)
}
