/**
 * AutoHedge distilled prompts — compilation + structure tests.
 *
 * Verifies that all 4 distilled prompts compile, export the expected shape,
 * and contain the key structural patterns we extracted from AutoHedge.
 */

import { describe, it, expect } from 'vitest'
import { DIRECTOR_CIO_PROMPT, DIRECTOR_CIO_PROMPT_META } from '@/lib/integrations/autohedge-distilled/director-cio-prompt'
import { QUANT_ANALYST_PROMPT, QUANT_ANALYST_PROMPT_META } from '@/lib/integrations/autohedge-distilled/quant-analyst-prompt'
import { RISK_MANAGER_CRO_PROMPT, RISK_MANAGER_CRO_PROMPT_META } from '@/lib/integrations/autohedge-distilled/risk-manager-cro-prompt'
import { EXECUTION_TRADER_PROMPT, EXECUTION_TRADER_PROMPT_META } from '@/lib/integrations/autohedge-distilled/execution-trader-prompt'

describe('AutoHedge distilled prompts', () => {
  // ── Test 1: All 4 prompts compile and export as non-empty strings ────────────
  it('all 4 prompts are non-empty strings', () => {
    expect(typeof DIRECTOR_CIO_PROMPT).toBe('string')
    expect(typeof QUANT_ANALYST_PROMPT).toBe('string')
    expect(typeof RISK_MANAGER_CRO_PROMPT).toBe('string')
    expect(typeof EXECUTION_TRADER_PROMPT).toBe('string')

    expect(DIRECTOR_CIO_PROMPT.length).toBeGreaterThan(500)
    expect(QUANT_ANALYST_PROMPT.length).toBeGreaterThan(500)
    expect(RISK_MANAGER_CRO_PROMPT.length).toBeGreaterThan(500)
    expect(EXECUTION_TRADER_PROMPT.length).toBeGreaterThan(500)
  })

  // ── Test 2: Director CIO prompt contains key AutoHedge patterns ──────────────
  it('Director CIO prompt contains conviction scale and bear case requirement', () => {
    expect(DIRECTOR_CIO_PROMPT).toContain('conviction')
    expect(DIRECTOR_CIO_PROMPT).toContain('bear case')
    expect(DIRECTOR_CIO_PROMPT).toContain('counterfactual')
    expect(DIRECTOR_CIO_PROMPT).toContain('Capital preservation')
  })

  // ── Test 3: Risk Manager prompt contains Kelly and veto conditions ────────────
  it('Risk Manager prompt contains Kelly fraction formula and veto triggers', () => {
    expect(RISK_MANAGER_CRO_PROMPT).toContain('Kelly')
    expect(RISK_MANAGER_CRO_PROMPT).toContain('0.25')
    expect(RISK_MANAGER_CRO_PROMPT).toContain('veto')
    expect(RISK_MANAGER_CRO_PROMPT).toContain('5% of total portfolio')
  })

  // ── Test 4: All metadata objects have required fields ────────────────────────
  it('all prompt metadata objects have required fields', () => {
    const metas = [
      DIRECTOR_CIO_PROMPT_META,
      QUANT_ANALYST_PROMPT_META,
      RISK_MANAGER_CRO_PROMPT_META,
      EXECUTION_TRADER_PROMPT_META,
    ]

    for (const meta of metas) {
      expect(meta).toHaveProperty('variant')
      expect(meta).toHaveProperty('sourceRepo')
      expect(meta).toHaveProperty('distilledAt')
      expect(meta).toHaveProperty('keyPatterns')
      expect(meta.sourceRepo).toContain('AutoHedge')
      expect(meta.variant).toBe('autohedge_distilled_v1')
    }
  })

  // ── Test 5: Execution Trader prompt includes broker routing ──────────────────
  it('Execution Trader prompt includes Wealth OS broker names', () => {
    expect(EXECUTION_TRADER_PROMPT).toContain('Alpaca')
    expect(EXECUTION_TRADER_PROMPT).toContain('Coinbase')
    expect(EXECUTION_TRADER_PROMPT).toContain('OANDA')
    expect(EXECUTION_TRADER_PROMPT).toContain('Polymarket')
  })

  // ── Test 6: Quant Analyst prompt requires confidence intervals ───────────────
  it('Quant Analyst prompt requires explicit confidence intervals on return estimates', () => {
    expect(QUANT_ANALYST_PROMPT).toContain('confidence interval')
    expect(QUANT_ANALYST_PROMPT).toContain('information ratio')
    expect(QUANT_ANALYST_PROMPT).toContain('edge vs noise')
  })
})
