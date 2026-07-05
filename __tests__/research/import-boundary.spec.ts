/**
 * P1 guardrail — the research/ideation layer must never import execution,
 * broker, sizing, or strategy-runtime code. This deterministic source scan
 * enforces the burn-in boundary in CI (the ESLint no-restricted-imports rule
 * enforces it at dev time). If this test fails, the R&D layer has reached
 * into the trading path.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const RESEARCH_DIR = join(process.cwd(), 'lib', 'research')

const FORBIDDEN = [
  /from\s+['"]@?\/?.*broker-adapters/,
  /from\s+['"]@?\/?.*broker-router/,
  /from\s+['"]@\/lib\/risk\//,
  /from\s+['"]@\/lib\/brokers\//,
  /from\s+['"]@\/lib\/strategies\/orchestrator/,
  /from\s+['"].*BasePipelineStrategy/,
]

function researchFiles(): string[] {
  return readdirSync(RESEARCH_DIR).filter(f => f.endsWith('.ts')).map(f => join(RESEARCH_DIR, f))
}

describe('research import boundary', () => {
  it('has research source files to check', () => {
    expect(researchFiles().length).toBeGreaterThan(0)
  })

  it('no research file imports broker/risk/strategy-runtime code', () => {
    for (const file of researchFiles()) {
      const src = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(src), `${file} violates the burn-in import boundary (${pattern})`).toBe(false)
      }
    }
  })

  it('the forbidden-pattern matcher actually detects a violation (self-check)', () => {
    const violating = `import { submitOrder } from '@/lib/broker-adapters/router'`
    expect(FORBIDDEN.some(p => p.test(violating))).toBe(true)
  })
})
