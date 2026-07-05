/**
 * P1 — Strategy-Scientist ideation: schema validation, numeric-claim
 * rejection, scorecard injection, and stub-row filing (maturity 'stub').
 */

import { describe, it, expect } from 'vitest'
import {
  containsPerformanceClaim,
  validateRiskReward,
  validateAlphaScan,
  buildRiskRewardPrompt,
  riskRewardReview,
  optimizationProposal,
  alphaScan,
  toAlphaRows,
  toRiskRewardRows,
  type LlmComplete,
} from '@/lib/research/ideation'

const mock = (raw: string): LlmComplete => async () => raw

describe('containsPerformanceClaim', () => {
  it('flags CAGR/Sharpe/percentages/multiples/dollars/return claims', () => {
    for (const s of [
      'improves CAGR', 'raises the Sharpe ratio', 'adds 12% return', 'a 2.5x return',
      'annualized gains', 'lifts win-rate', 'expectancy climbs', '$4,000 more per year',
      'return of 15', 'cuts max drawdown by 30%',
    ]) {
      expect(containsPerformanceClaim(s), s).toBe(true)
    }
  })

  it('passes qualitative mechanism language', () => {
    for (const s of [
      'widen the stop to reduce premature exits',
      'add a volatility filter before entry',
      'require confluence from a second signal',
    ]) {
      expect(containsPerformanceClaim(s), s).toBe(false)
    }
  })
})

describe('validateRiskReward — drops numeric-claim proposals, keeps clean ones', () => {
  it('drops a proposal whose prose asserts performance, keeps the clean one', () => {
    const raw = JSON.stringify({
      proposals: [
        { change: 'Tighten the stop', rationale: 'fewer deep losers', expectedEffect: 'lower tail risk' },
        { change: 'Boost size', rationale: 'this lifts CAGR to 18%', expectedEffect: '2x returns' },
      ],
    })
    const { output, dropped } = validateRiskReward(raw)
    expect(output.proposals).toHaveLength(1)
    expect(output.proposals[0].change).toBe('Tighten the stop')
    expect(dropped).toBe(1)
  })

  it('keeps numbers inside paramGridPatch (params are not claims)', () => {
    const raw = JSON.stringify({
      proposals: [{
        change: 'Grid the stop distance', rationale: 'find a robust plateau',
        expectedEffect: 'steadier exits', paramGridPatch: { stopPct: [0.01, 0.02, 0.03] },
      }],
    })
    const { output } = validateRiskReward(raw)
    expect(output.proposals).toHaveLength(1)
    expect(output.proposals[0].paramGridPatch).toEqual({ stopPct: [0.01, 0.02, 0.03] })
  })

  it('malformed JSON → empty proposals, never throws', () => {
    expect(validateRiskReward('not json').output.proposals).toHaveLength(0)
    expect(validateRiskReward('{}').output.proposals).toHaveLength(0)
  })
})

describe('validateAlphaScan — one numeric claim voids the whole scan', () => {
  it('accepts clean hypotheses', () => {
    const raw = JSON.stringify({
      hypotheses: [
        { hypothesis: 'weekend liquidity thins', mechanism: 'market makers step back', testableSignal: 'wider spreads Sat/Sun' },
      ],
    })
    const out = validateAlphaScan(raw, 'crypto')
    expect(out).not.toBeNull()
    expect(out!.hypotheses).toHaveLength(1)
    expect(out!.market).toBe('crypto')
  })

  it('rejects the ENTIRE output if any hypothesis carries a performance number', () => {
    const raw = JSON.stringify({
      hypotheses: [
        { hypothesis: 'clean idea', mechanism: 'ok', testableSignal: 'ok' },
        { hypothesis: 'this yields 20% edge', mechanism: 'ok', testableSignal: 'ok' },
      ],
    })
    expect(validateAlphaScan(raw, 'crypto')).toBeNull()
  })

  it('empty or malformed → null', () => {
    expect(validateAlphaScan('{"hypotheses":[]}', 'crypto')).toBeNull()
    expect(validateAlphaScan('garbage', 'crypto')).toBeNull()
  })
})

describe('prompt injection carries the REAL scorecard', () => {
  it('embeds the scorecard JSON in the prompt', () => {
    const scorecard = { strategyKey: 'vcp_minervini', expectancyPct: 0.4, winRatePct: 55, maxDrawdownPct: 8 }
    const { prompt, system } = buildRiskRewardPrompt(scorecard)
    expect(prompt).toContain('vcp_minervini')
    expect(prompt).toContain('"expectancyPct": 0.4')
    expect(prompt).toContain('3 RISK REDUCTIONS')
    expect(system).toContain('NEVER state performance numbers')
  })
})

describe('template runners with a mocked LLM', () => {
  it('riskRewardReview returns validated proposals', async () => {
    const out = await riskRewardReview({ strategyKey: 'x' }, mock(JSON.stringify({
      proposals: [{ change: 'add filter', rationale: 'cut noise', expectedEffect: 'fewer whipsaws' }],
    })))
    expect(out.proposals).toHaveLength(1)
  })

  it('optimizationProposal drops proposals lacking a param grid', async () => {
    const out = await optimizationProposal({ strategyKey: 'x' }, mock(JSON.stringify({
      proposals: [
        { change: 'no grid', rationale: 'r', expectedEffect: 'e' },
        { change: 'grid it', rationale: 'r', expectedEffect: 'e', paramGridPatch: { a: [1, 2] } },
      ],
    })))
    expect(out.proposals).toHaveLength(1)
    expect(out.proposals[0].change).toBe('grid it')
  })

  it('alphaScan returns null when numeric claims leak in', async () => {
    const out = await alphaScan('crypto', mock(JSON.stringify({
      hypotheses: [{ hypothesis: '30% edge', mechanism: 'm', testableSignal: 's' }],
    })))
    expect(out).toBeNull()
  })
})

describe('filing rows — research stubs never trade', () => {
  it('alpha rows carry maturity "stub", status "proposed", kind "alpha_hypothesis"', () => {
    const rows = toAlphaRows({
      market: 'crypto',
      hypotheses: [{ hypothesis: 'h', mechanism: 'm', testableSignal: 's' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].maturity).toBe('stub')
    expect(rows[0].status).toBe('proposed')
    expect(rows[0].kind).toBe('alpha_hypothesis')
    expect(rows[0].metadata.hypothesis).toBe('h')
  })

  it('risk/reward rows carry the strategy id, param grid, and stub maturity', () => {
    const rows = toRiskRewardRows('vcp_minervini', {
      proposals: [{ change: 'c', rationale: 'r', expectedEffect: 'e', paramGridPatch: { s: [1] } }],
    }, 'optimization')
    expect(rows[0].kind).toBe('optimization')
    expect(rows[0].strategy_id).toBe('vcp_minervini')
    expect(rows[0].param_grid_patch).toEqual({ s: [1] })
    expect(rows[0].maturity).toBe('stub')
  })
})
