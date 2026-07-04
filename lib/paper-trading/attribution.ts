/**
 * Strategy attribution (upgrade item 7) — pure helpers that decompose a
 * paper strategy's results into explainable components. Every component is
 * nullable: when the data cannot support a number, the answer is
 * "not enough data", NEVER a fabricated figure.
 *
 * Method notes (each component states its own):
 *  - cost drag: mean modeled round-trip slippage per trade (measured).
 *  - exit contribution: P&L split by exit reason — shows whether the exit
 *    rules (take-profit/stop/timeout) or the entry signal carry the edge.
 *  - sizing contribution: notional-weighted expectancy minus equal-weighted
 *    expectancy. Positive = sizing added value beyond signal selection.
 *  - regime contribution: expectancy in the modal regime minus overall —
 *    only when per-trade regimes were recorded.
 *  - veto benefit: −(mean shadow return) — what rejected trades would have
 *    done. Positive = the gates saved money.
 *  - residual: net expectancy minus (sizing + regime + veto-adjusted
 *    components is NOT additive) — reported as gross-minus-cost-minus-sizing
 *    and explicitly labeled unexplained/lucky.
 */

export interface AttributionComponent {
  /** Percent per trade, or null when the data cannot support it. */
  valuePct: number | null
  note: string
}

export interface ExitReasonSlice {
  reason: string
  count: number
  avgReturnPct: number
}

export interface StrategyAttribution {
  strategyKey: string
  sample: number
  costDrag: AttributionComponent
  exitContribution: AttributionComponent
  exitBreakdown: ExitReasonSlice[]
  sizingContribution: AttributionComponent
  regimeContribution: AttributionComponent
  vetoBenefit: AttributionComponent
  synergyEffect: AttributionComponent
  residual: AttributionComponent
}

export interface AttributionTrade {
  returnPct: number       // fraction
  notionalUsd: number | null
  exitReason: string | null
  closedAt: string
  regime?: string | null
}

const MIN_SAMPLE = 5
const NOT_ENOUGH = (what: string, n: number) =>
  `not enough data — needs ≥${MIN_SAMPLE} ${what}, have ${n}`

const round2 = (v: number) => Math.round(v * 10_000) / 100   // fraction → pct

export function computeAttribution(args: {
  strategyKey: string
  trades: AttributionTrade[]
  entrySlipsBps: number[]
  exitSlipsBps: number[]
  shadowReturnsPct: number[]   // fractions
  /** Loss-day overlap vs the rest of the book (0..1), when computed. */
  drawdownOverlapMax?: number | null
}): StrategyAttribution {
  const { trades } = args
  const n = trades.length
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length

  // ── cost drag (measured from recorded modeled slippage) ────────────────────
  const slips = [...args.entrySlipsBps, ...args.exitSlipsBps]
  const costDrag: AttributionComponent = slips.length === 0
    ? { valuePct: null, note: NOT_ENOUGH('recorded fills', 0) }
    : {
        valuePct: -round2((mean(args.entrySlipsBps.length ? args.entrySlipsBps : [0]) +
          mean(args.exitSlipsBps.length ? args.exitSlipsBps : [0])) / 10_000),
        note: 'mean modeled round-trip slippage per trade (spread + impact)',
      }

  // ── exit contribution ───────────────────────────────────────────────────────
  const withExit = trades.filter(t => t.exitReason != null)
  const byReason = new Map<string, number[]>()
  for (const t of withExit) {
    const list = byReason.get(t.exitReason as string) ?? []
    list.push(t.returnPct)
    byReason.set(t.exitReason as string, list)
  }
  const exitBreakdown: ExitReasonSlice[] = [...byReason.entries()]
    .map(([reason, rets]) => ({ reason, count: rets.length, avgReturnPct: round2(mean(rets)) }))
    .sort((a, b) => b.count - a.count)
  let exitContribution: AttributionComponent
  if (withExit.length < MIN_SAMPLE) {
    exitContribution = { valuePct: null, note: NOT_ENOUGH('closed trades with exit reasons', withExit.length) }
  } else {
    const stops = byReason.get('stop_loss') ?? []
    const tps = byReason.get('take_profit') ?? []
    exitContribution = {
      valuePct: tps.length && stops.length
        ? round2(mean(tps) * (tps.length / withExit.length) + mean(stops) * (stops.length / withExit.length))
        : null,
      note: tps.length && stops.length
        ? 'take-profit + stop-loss P&L weighted by frequency — the exit rules’ share of expectancy'
        : 'exit mix has no stop/take-profit pairs yet — see the breakdown',
    }
  }

  // ── sizing contribution ─────────────────────────────────────────────────────
  const sized = trades.filter(t => t.notionalUsd != null && t.notionalUsd > 0)
  let sizingContribution: AttributionComponent
  if (sized.length < MIN_SAMPLE) {
    sizingContribution = { valuePct: null, note: NOT_ENOUGH('sized trades', sized.length) }
  } else {
    const totalNotional = sized.reduce((s, t) => s + (t.notionalUsd as number), 0)
    const weighted = sized.reduce((s, t) => s + t.returnPct * (t.notionalUsd as number), 0) / totalNotional
    const equal = mean(sized.map(t => t.returnPct))
    sizingContribution = {
      valuePct: round2(weighted - equal),
      note: 'notional-weighted minus equal-weighted expectancy — positive means sizing added value',
    }
  }

  // ── regime contribution ─────────────────────────────────────────────────────
  const withRegime = trades.filter(t => t.regime != null)
  let regimeContribution: AttributionComponent
  if (withRegime.length < MIN_SAMPLE) {
    regimeContribution = { valuePct: null, note: NOT_ENOUGH('trades with recorded regimes', withRegime.length) }
  } else {
    const counts = new Map<string, number[]>()
    for (const t of withRegime) {
      const list = counts.get(t.regime as string) ?? []
      list.push(t.returnPct)
      counts.set(t.regime as string, list)
    }
    const modal = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0]
    const overall = mean(withRegime.map(t => t.returnPct))
    regimeContribution = {
      valuePct: round2(mean(modal[1]) - overall),
      note: `expectancy in the modal regime (${modal[0]}) minus overall`,
    }
  }

  // ── veto benefit ────────────────────────────────────────────────────────────
  const vetoBenefit: AttributionComponent = args.shadowReturnsPct.length < MIN_SAMPLE
    ? { valuePct: null, note: NOT_ENOUGH('resolved shadow (vetoed) trades', args.shadowReturnsPct.length) }
    : {
        valuePct: round2(-mean(args.shadowReturnsPct)),
        note: 'what vetoed trades would have returned, sign-flipped — positive means the gates saved money',
      }

  // ── synergy / correlation effect ────────────────────────────────────────────
  const synergyEffect: AttributionComponent = args.drawdownOverlapMax == null
    ? { valuePct: null, note: 'not enough data — needs loss-day overlap vs the rest of the book' }
    : {
        valuePct: null,
        note: `max loss-day overlap with another strategy: ${(args.drawdownOverlapMax * 100).toFixed(0)}% — high overlap means the diversification benefit is smaller than it looks`,
      }

  // ── residual: net expectancy minus the MEASURED components ─────────────────
  let residual: AttributionComponent
  if (n < MIN_SAMPLE || costDrag.valuePct == null || sizingContribution.valuePct == null) {
    residual = { valuePct: null, note: NOT_ENOUGH('trades with cost + sizing components', n) }
  } else {
    const netPct = round2(mean(trades.map(t => t.returnPct)))
    const explained = costDrag.valuePct + sizingContribution.valuePct
    residual = {
      valuePct: Math.round((netPct - explained) * 100) / 100,
      note: 'net expectancy minus measured cost drag and sizing effect — the unexplained (possibly lucky) share',
    }
  }

  return {
    strategyKey: args.strategyKey,
    sample: n,
    costDrag,
    exitContribution,
    exitBreakdown,
    sizingContribution,
    regimeContribution,
    vetoBenefit,
    synergyEffect,
    residual,
  }
}
