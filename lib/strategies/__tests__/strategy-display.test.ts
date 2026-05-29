import { describe, it, expect } from 'vitest'
import {
  getMaturityMeta, isInert, MATURITY_META, edgeTypeLabel, assetClassLabel,
  toDisplayName,
} from '@/lib/strategies/strategy-display'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import {
  tradeabilityFromMaturity, primaryAction, allowsExecute, PRIMARY_ACTION_LABEL,
} from '@/lib/opportunities/tradeability'
import {
  getNoTradeReason, ALL_NO_TRADE_REASONS, NO_TRADE_REASONS,
} from '@/lib/no-trade/reasons'
import { brierToLevel, capUtilToLevel } from '@/lib/risk/levels'

describe('strategy maturity labels', () => {
  it('renders the user-facing "Planned" label for the stub engine status', () => {
    expect(getMaturityMeta('stub').label).toBe('Planned')
  })
  it('renders "Retired" for retired', () => {
    expect(getMaturityMeta('retired').label).toBe('Retired')
    expect(getMaturityMeta('retired').tone).toBe('danger')
  })
  it('labels every maturity status', () => {
    for (const meta of Object.values(MATURITY_META)) {
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })
  it('falls back to Planned for unknown/empty status', () => {
    expect(getMaturityMeta(undefined).label).toBe('Planned')
    expect(getMaturityMeta('nonsense').label).toBe('Planned')
  })
})

describe('stub/retired strategies are not tradable', () => {
  it('stub is neither paper-tradable nor live-eligible', () => {
    expect(MATURITY_META.stub.paperTradable).toBe(false)
    expect(MATURITY_META.stub.liveEligible).toBe(false)
    expect(isInert('stub')).toBe(true)
  })
  it('retired is inert', () => {
    expect(isInert('retired')).toBe(true)
    expect(MATURITY_META.retired.paperTradable).toBe(false)
  })
  it('backtest_ready is not yet paper-tradable', () => {
    expect(MATURITY_META.backtest_ready.paperTradable).toBe(false)
  })
  it('every registry stub strategy maps to a non-tradable maturity', () => {
    const stubs = Object.values(STRATEGY_REGISTRY_CONFIG).filter(c => c.maturityStatus === 'stub')
    expect(stubs.length).toBeGreaterThan(0)
    for (const c of stubs) {
      const meta = getMaturityMeta(c.maturityStatus)
      expect(meta.paperTradable).toBe(false)
      expect(meta.liveEligible).toBe(false)
    }
  })
})

describe('tradeability + action gating', () => {
  it('stub/retired strategies are blocked → primary action is Review (never Execute)', () => {
    const t = tradeabilityFromMaturity('stub')
    expect(t).toBe('blocked')
    expect(allowsExecute(t)).toBe(false)
    expect(PRIMARY_ACTION_LABEL[primaryAction(t)]).toBe('Review')
  })
  it('paper_trading is paper-only and offers Paper Trade, not Execute', () => {
    const t = tradeabilityFromMaturity('paper_trading')
    expect(t).toBe('paper_only')
    expect(allowsExecute(t)).toBe(false)
    expect(PRIMARY_ACTION_LABEL[primaryAction(t)]).toBe('Paper Trade')
  })
  it('live_candidate is only live-eligible when the user has explicitly enabled live', () => {
    expect(tradeabilityFromMaturity('live_candidate')).toBe('paper_only')
    expect(tradeabilityFromMaturity('live_candidate', { liveEnabled: true })).toBe('live_eligible')
    expect(allowsExecute(tradeabilityFromMaturity('live_candidate', { liveEnabled: true }))).toBe(true)
  })
  it('live_disabled never becomes live-eligible even with the flag', () => {
    expect(tradeabilityFromMaturity('live_disabled', { liveEnabled: true })).toBe('paper_only')
  })
})

describe('edge + asset labels', () => {
  it('maps known edge types', () => {
    expect(edgeTypeLabel('onchain')).toBe('On-chain')
    expect(edgeTypeLabel('macro')).toBe('Macro')
  })
  it('maps asset classes including multi-asset', () => {
    expect(assetClassLabel('multi-asset')).toBe('Multi-Asset')
    expect(assetClassLabel('polymarket')).toBe('Polymarket')
  })
  it('humanizes snake_case keys', () => {
    expect(toDisplayName('odte_strangle_hedged')).toBe('Odte Strangle Hedged')
  })
})

describe('no-trade reasons', () => {
  it('exposes all 12 canonical reasons', () => {
    expect(ALL_NO_TRADE_REASONS.length).toBe(12)
  })
  it('looks up a known reason with a non-empty blurb', () => {
    const r = getNoTradeReason('jurisdiction_blocked')
    expect(r.label).toMatch(/Jurisdiction/)
    expect(r.tone).toBe('danger')
    expect(r.blurb.length).toBeGreaterThan(0)
  })
  it('falls back to missing_data for unknown codes', () => {
    expect(getNoTradeReason('???').code).toBe('missing_data')
    expect(getNoTradeReason(null).code).toBe('missing_data')
  })
  it('planned/retired reasons carry the right tones', () => {
    expect(NO_TRADE_REASONS.strategy_planned.tone).toBe('neutral')
    expect(NO_TRADE_REASONS.strategy_retired.tone).toBe('danger')
  })
})

describe('risk badge level helpers', () => {
  it('brierToLevel: lower is safer', () => {
    expect(brierToLevel(0.1).level).toBe('ok')
    expect(brierToLevel(0.22).level).toBe('caution')
    expect(brierToLevel(0.4).level).toBe('risk')
    expect(brierToLevel(null).level).toBe('unknown')
    expect(brierToLevel(undefined).value).toBe('n/a')
  })
  it('capUtilToLevel: nearing the cap escalates', () => {
    expect(capUtilToLevel(0.3).level).toBe('ok')
    expect(capUtilToLevel(0.75).level).toBe('caution')
    expect(capUtilToLevel(0.95).level).toBe('risk')
    expect(capUtilToLevel(0.5).value).toBe('50%')
    expect(capUtilToLevel(null).level).toBe('unknown')
  })
})
