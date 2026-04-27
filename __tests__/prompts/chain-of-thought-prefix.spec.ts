/**
 * chain-of-thought-prefix — asserts the CoT prefix is present in all
 * AutoHedge-distilled prompt templates.
 */

import { describe, it, expect } from 'vitest'
import { CHAIN_OF_THOUGHT_PREFIX } from '@/lib/prompts/chain-of-thought-prefix'
import { DIRECTOR_CIO_PROMPT }     from '@/lib/integrations/autohedge-distilled/director-cio-prompt'
import { RISK_MANAGER_CRO_PROMPT } from '@/lib/integrations/autohedge-distilled/risk-manager-cro-prompt'
import { QUANT_ANALYST_PROMPT }    from '@/lib/integrations/autohedge-distilled/quant-analyst-prompt'
import { EXECUTION_TRADER_PROMPT } from '@/lib/integrations/autohedge-distilled/execution-trader-prompt'

describe('CHAIN_OF_THOUGHT_PREFIX', () => {
  it('prefix contains all 5 required steps', () => {
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('1.')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('2.')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('3.')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('4.')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('5.')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('confidence')
    expect(CHAIN_OF_THOUGHT_PREFIX).toContain('invalidate')
  })
})

const ALL_PROMPTS = [
  ['DIRECTOR_CIO_PROMPT',      DIRECTOR_CIO_PROMPT],
  ['RISK_MANAGER_CRO_PROMPT',  RISK_MANAGER_CRO_PROMPT],
  ['QUANT_ANALYST_PROMPT',     QUANT_ANALYST_PROMPT],
  ['EXECUTION_TRADER_PROMPT',  EXECUTION_TRADER_PROMPT],
] as const

describe('all AutoHedge prompts start with the chain-of-thought prefix', () => {
  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} starts with CHAIN_OF_THOUGHT_PREFIX`, () => {
      expect(prompt.startsWith(CHAIN_OF_THOUGHT_PREFIX)).toBe(true)
    })
  }
})
