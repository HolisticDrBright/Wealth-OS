/**
 * Auto-registers all 38 strategy implementations with the strategyRegistry
 * singleton. Import this module once at app boot (e.g. from the API entry
 * point or the orchestrator) to ensure all strategies are available.
 */

import { strategyRegistry } from './StrategyRegistry'

// ── Stocks: concrete implementations ─────────────────────────────────────────
import { VcpMinerviniStrategy } from './impl/stocks/vcp-minervini'
import { AutopilotCongressionalStrategy } from './impl/stocks/autopilot-congressional'

// ── Stocks stubs ──────────────────────────────────────────────────────────────
import {
  QuantMomentumStrategy,
  QvmMultifactorStrategy,
  DividendAristocratStrategy,
  SectorRotationStrategy,
  PeadStrategy,
  OptionsWheelStrategy,
  GammaExposureStrategy,
  MergerArbStrategy,
  SpinoffStrategy,
  TailRiskHedgingStrategy,
} from './impl/stocks/stubs'

// ── Crypto: concrete implementations ─────────────────────────────────────────
import { FundingBasisArbStrategy } from './impl/crypto/funding-basis-arb'
import { DcaHalvingStrategy } from './impl/crypto/dca-halving'

// ── Crypto stubs ──────────────────────────────────────────────────────────────
import {
  OnchainSignalStrategy,
  DefiYieldStrategy,
  NarrativeRotationStrategy,
  LiquidationHuntingStrategy,
  AirdropFarmingStrategy,
  MemecoinBondingcurveStrategy,
} from './impl/crypto/stubs'

// ── Forex stubs ───────────────────────────────────────────────────────────────
import {
  IctSmcStrategy,
  CarryTradeStrategy,
  CotPositioningStrategy,
  CbDivergenceStrategy,
  SessionBreakoutStrategy,
  FxTrendfollowingStrategy,
  MacroNewsEventStrategy,
  TriangularArbStrategy,
  CorrelationDivergenceStrategy,
} from './impl/forex/stubs'

// ── Polymarket: concrete implementations ──────────────────────────────────────
import { PolymarketWalletCopyStrategy } from './impl/polymarket/polymarket-wallet-copy'
import { PolymarketInfoLagStrategy } from './impl/polymarket/polymarket-info-lag'
import { PolymarketCryptoBinary5MinStrategy } from './impl/polymarket/polymarket-crypto-binary-5min'

// ── Polymarket stubs ──────────────────────────────────────────────────────────
import {
  PolymarketResolutionRulesStrategy,
  PolymarketBaseRateStrategy,
  PolymarketCrossMarketStrategy,
  PolymarketEventCompressionStrategy,
  PolymarketNarrativeFadeStrategy,
  PolymarketLiquidityPocketStrategy,
  PolymarketNoTradeStrategy,
} from './impl/polymarket/stubs'

// ─── Registration ──────────────────────────────────────────────────────────────

const ALL_STRATEGIES = [
  // Stocks (12)
  new VcpMinerviniStrategy(),
  new QuantMomentumStrategy(),
  new QvmMultifactorStrategy(),
  new DividendAristocratStrategy(),
  new SectorRotationStrategy(),
  new PeadStrategy(),
  new OptionsWheelStrategy(),
  new GammaExposureStrategy(),
  new MergerArbStrategy(),
  new SpinoffStrategy(),
  new TailRiskHedgingStrategy(),
  new AutopilotCongressionalStrategy(),

  // Crypto (8)
  new DcaHalvingStrategy(),
  new FundingBasisArbStrategy(),
  new OnchainSignalStrategy(),
  new DefiYieldStrategy(),
  new NarrativeRotationStrategy(),
  new LiquidationHuntingStrategy(),
  new AirdropFarmingStrategy(),
  new MemecoinBondingcurveStrategy(),

  // Forex (9)
  new IctSmcStrategy(),
  new CarryTradeStrategy(),
  new CotPositioningStrategy(),
  new CbDivergenceStrategy(),
  new SessionBreakoutStrategy(),
  new FxTrendfollowingStrategy(),
  new MacroNewsEventStrategy(),
  new TriangularArbStrategy(),
  new CorrelationDivergenceStrategy(),

  // Polymarket (9)
  new PolymarketResolutionRulesStrategy(),
  new PolymarketBaseRateStrategy(),
  new PolymarketInfoLagStrategy(),
  new PolymarketCrossMarketStrategy(),
  new PolymarketEventCompressionStrategy(),
  new PolymarketNarrativeFadeStrategy(),
  new PolymarketLiquidityPocketStrategy(),
  new PolymarketNoTradeStrategy(),
  new PolymarketWalletCopyStrategy(),
  new PolymarketCryptoBinary5MinStrategy(),
]

for (const s of ALL_STRATEGIES) {
  strategyRegistry.register(s)
}

export { strategyRegistry }
export { ALL_STRATEGIES }
