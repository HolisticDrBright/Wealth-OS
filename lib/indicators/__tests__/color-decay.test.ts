import { describe, it, expect } from 'vitest'
import { computeColorDecaySchedule, isMonthlyOpex } from '../color-decay'

// Helper: build a Date at a specific ET hour:minute on a non-opex Wednesday (2026-05-20)
// May is EDT (UTC-4), so ET = UTC - 4h → UTC = ET + 4h
function etTime(hour: number, minute: number, day = 20): Date {
  // 2026-05-20 is a Wednesday, not a third Friday → isMonthlyOpex=false
  return new Date(Date.UTC(2026, 4, day, hour + 4, minute, 0)) // month 4 = May (0-indexed)
}

// Third Friday of May 2026 = May 15, 2026
function opexFriday(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 4, 15, hour + 4, minute, 0))
}

describe('computeColorDecaySchedule', () => {
  it('nextHedgeWindow is after currentTime', () => {
    const now = etTime(9, 30) // 9:30 ET, before first window at 10:00
    const { nextHedgeWindow } = computeColorDecaySchedule(1000, now)
    expect(new Date(nextHedgeWindow).getTime()).toBeGreaterThan(now.getTime())
  })

  it('hedge window falls at 10:00 ET when current time is 9:30 ET', () => {
    const now = etTime(9, 30)
    const { nextHedgeWindow } = computeColorDecaySchedule(1000, now)
    const windowDate = new Date(nextHedgeWindow)
    // 10:00 ET = 14:00 UTC (EDT, UTC-4)
    expect(windowDate.getUTCHours()).toBe(14)
    expect(windowDate.getUTCMinutes()).toBe(0)
  })

  it('hedge window falls at 14:30 ET when current time is 13:00 ET', () => {
    const now = etTime(13, 0)
    const { nextHedgeWindow } = computeColorDecaySchedule(1000, now)
    const windowDate = new Date(nextHedgeWindow)
    // 14:30 ET = 18:30 UTC (EDT)
    expect(windowDate.getUTCHours()).toBe(18)
    expect(windowDate.getUTCMinutes()).toBe(30)
  })

  it('wraps to next-day 10:00 ET when past last window (15:45 ET)', () => {
    const now = etTime(16, 0) // after 15:45 — last window passed
    const { nextHedgeWindow } = computeColorDecaySchedule(0, now)
    const windowDate = new Date(nextHedgeWindow)
    // Should be next day's 10:00 ET = 14:00 UTC
    expect(windowDate.getUTCHours()).toBe(14)
    expect(windowDate.getUTCMinutes()).toBe(0)
    // Next day
    expect(windowDate.getUTCDate()).toBe(21)
  })

  it('confidence is within [0, 1]', () => {
    const times = [etTime(9, 0), etTime(10, 1), etTime(14, 29), etTime(15, 44), etTime(16, 10)]
    for (const t of times) {
      const { confidence } = computeColorDecaySchedule(2000, t)
      expect(confidence).toBeGreaterThanOrEqual(0)
      expect(confidence).toBeLessThanOrEqual(1)
    }
  })

  it('confidence peaks when very close to a hedge window', () => {
    const justBefore = etTime(9, 59) // 1 min before 10:00 window
    const farBefore  = etTime(8, 0)  // 2h before
    const { confidence: near } = computeColorDecaySchedule(1000, justBefore)
    const { confidence: far  } = computeColorDecaySchedule(1000, farBefore)
    expect(near).toBeGreaterThan(far)
  })

  it('expectedFlowDirection is buy for positive netGammaUsd', () => {
    const { expectedFlowDirection } = computeColorDecaySchedule(10_000, etTime(9, 55))
    expect(expectedFlowDirection).toBe('buy')
  })

  it('expectedFlowDirection is sell for negative netGammaUsd', () => {
    const { expectedFlowDirection } = computeColorDecaySchedule(-10_000, etTime(9, 55))
    expect(expectedFlowDirection).toBe('sell')
  })

  it('expectedFlowDirection is neutral when netGammaUsd is small', () => {
    const { expectedFlowDirection } = computeColorDecaySchedule(100, etTime(9, 55))
    expect(expectedFlowDirection).toBe('neutral')
  })

  it('opex day boosts confidence compared to non-opex', () => {
    const regular = computeColorDecaySchedule(1000, etTime(15, 30))
    const opex    = computeColorDecaySchedule(1000, opexFriday(15, 30))
    expect(opex.confidence).toBeGreaterThan(regular.confidence)
  })
})

describe('isMonthlyOpex', () => {
  it('returns true for third Friday of May 2026 (May 15)', () => {
    expect(isMonthlyOpex(new Date('2026-05-15T14:00:00Z'))).toBe(true)
  })

  it('returns false for second Friday of May 2026 (May 8)', () => {
    expect(isMonthlyOpex(new Date('2026-05-08T14:00:00Z'))).toBe(false)
  })

  it('returns false for a Wednesday', () => {
    expect(isMonthlyOpex(new Date('2026-05-20T14:00:00Z'))).toBe(false)
  })

  it('returns false for fourth Friday (May 22, 2026)', () => {
    expect(isMonthlyOpex(new Date('2026-05-22T14:00:00Z'))).toBe(false)
  })
})
