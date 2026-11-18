/**
 * Phase 1.2 — cron tasks make direct function calls, never HTTP self-fetches.
 *
 * The old route fetched its own sibling routes (sync, copy, simulate,
 * rebalance, harvest-scan, sync-crypto, sync-forex) and even re-fetched
 * /api/cron from daily-ops — all without credentials, so every one of those
 * hops failed auth. These tests pin the fix.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { opsTasksFor, runCronTask, UnknownCronTaskError } from '@/lib/cron/tasks'

describe('no HTTP self-calls remain in the cron path', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

  it.each([
    'app/api/cron/route.ts',
    'lib/cron/tasks.ts',
  ])('%s never builds a self-URL from NEXT_PUBLIC_SITE_URL', (file) => {
    const src = read(file)
    expect(src).not.toContain('NEXT_PUBLIC_SITE_URL')
    expect(src).not.toMatch(/fetch\(\s*[`'"]\$\{baseUrl\}/)
    expect(src).not.toMatch(/\/api\/cron\?task=/)
  })

  it('the cron task file only fetches EXTERNAL data providers', () => {
    const src = read('lib/cron/tasks.ts')
    const fetches = src.match(/fetch\([^)]*\)/g) ?? []
    for (const f of fetches) {
      // Every remaining fetch target must be an absolute third-party URL.
      expect(f).toMatch(/https:\/\/(query1\.finance\.yahoo\.com|api\.stlouisfed\.org)/)
    }
  })
})

describe('opsTasksFor — weekly/monthly schedule selection', () => {
  const BASE = ['tipp-floors', 'sweep', 'ops-watchdog', 'regime-allocator', 'ledger', 'advisory-staleness']

  it('a plain weekday runs only the 6 daily ops jobs', () => {
    // 2026-11-18 is a Wednesday, not the 1st.
    expect(opsTasksFor(new Date('2026-11-18T04:30:00Z'))).toEqual(BASE)
  })

  it('Mondays add lifecycle + agent-calibration', () => {
    // 2026-11-16 is a Monday.
    expect(opsTasksFor(new Date('2026-11-16T04:30:00Z')))
      .toEqual([...BASE, 'lifecycle', 'agent-calibration'])
  })

  it('the 1st of the month adds behavior-gap', () => {
    // 2026-12-01 is a Tuesday.
    expect(opsTasksFor(new Date('2026-12-01T04:30:00Z')))
      .toEqual([...BASE, 'behavior-gap'])
  })

  it('a Monday-the-1st runs both weekly and monthly extras', () => {
    // 2027-02-01 is a Monday.
    expect(opsTasksFor(new Date('2027-02-01T04:30:00Z')))
      .toEqual([...BASE, 'lifecycle', 'agent-calibration', 'behavior-gap'])
  })
})

describe('runCronTask — unknown tasks fail loudly', () => {
  it('throws UnknownCronTaskError for a task that does not exist', async () => {
    await expect(runCronTask('__definitely_not_a_task__'))
      .rejects.toBeInstanceOf(UnknownCronTaskError)
  })
})
