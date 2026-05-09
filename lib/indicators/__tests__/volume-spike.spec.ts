import { describe, it, expect } from 'vitest'
import { isVolumeSpike } from '../volume-spike'

describe('isVolumeSpike', () => {
  const baseLookback = [
    { volume: 1000 },
    { volume: 1000 },
    { volume: 1000 },
    { volume: 1000 },
    { volume: 1000 },
  ]
  // average = 1000

  it('returns true when volume is 4x average with threshold=3', () => {
    const currentBar = { volume: 4000 } // 4x average, above threshold of 3
    expect(isVolumeSpike(currentBar, baseLookback, 3)).toBe(true)
  })

  it('returns false when volume is 2x average with threshold=3', () => {
    const currentBar = { volume: 2000 } // 2x average, below threshold of 3
    expect(isVolumeSpike(currentBar, baseLookback, 3)).toBe(false)
  })

  it('returns false when lookback is empty', () => {
    const currentBar = { volume: 999999 }
    expect(isVolumeSpike(currentBar, [], 3)).toBe(false)
  })

  it('returns false when avg is 0', () => {
    const zeroLookback = [
      { volume: 0 },
      { volume: 0 },
      { volume: 0 },
    ]
    const currentBar = { volume: 1000 }
    expect(isVolumeSpike(currentBar, zeroLookback, 3)).toBe(false)
  })

  it('returns true with custom threshold=2 when volume is above 2x average', () => {
    const currentBar = { volume: 2500 } // 2.5x average, above threshold of 2
    expect(isVolumeSpike(currentBar, baseLookback, 2)).toBe(true)
  })

  it('returns false with custom threshold=2 when volume is exactly 2x average', () => {
    const currentBar = { volume: 2000 } // exactly 2x — must be strictly greater
    expect(isVolumeSpike(currentBar, baseLookback, 2)).toBe(false)
  })
})
