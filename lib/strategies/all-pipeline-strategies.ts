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
import { CexLatencyArbStrategy } from './impl/crypto/cex-latency-arb'

// ── TIER 3: Stocks ────────────────────────────────────────────────────────────
import { Activist13dInsiderClusterStrategy } from './impl/stocks/activist-13d-insider-cluster'
import { BuybackAnnouncementMomentumStrategy } from './impl/stocks/buyback-announcement-momentum'

// ── TIER 3: Crypto ────────────────────────────────────────────────────────────
import { EtfBasisArbStrategy } from './impl/crypto/etf-basis-arb'
import { LstBasisArbStrategy } from './impl/crypto/lst-basis-arb'
import { RwaYieldStackStrategy } from './impl/crypto/rwa-yield-stack'

// ── TIER 3: Forex ─────────────────────────────────────────────────────────────
import { London4pmFixEndmonthStrategy } from './impl/forex/london-4pm-fix-endmonth'
import { SwapPointArbitrageStrategy } from './impl/forex/swap-point-arbitrage'

// ── TIER 3: Polymarket ────────────────────────────────────────────────────────
import { PredictionMarketSportsbookArbStrategy } from './impl/polymarket/prediction-market-sportsbook-arb'

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
import { PolymarketMarketMakerStrategy } from './impl/polymarket/polymarket-market-maker'
import { PolymarketKalshiWeatherStrategy } from './impl/polymarket/polymarket-kalshi-weather'

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

// ── TIER 4: Polymarket ────────────────────────────────────────────────────────
import { PolymarketTriangleArbStrategy } from './impl/polymarket/polymarket-triangle-arb'

// ── Weekly Review 2026-05-09 scaffolds (default-disabled) ─────────────────────
import { PeadMicrocapTextStrategy } from './impl/stocks/pead-microcap-text'
import { VixTermStructureStrategy } from './impl/stocks/vix-term-structure'
import { FundingBasisArbHyperliquidStrategy } from './impl/crypto/funding-basis-arb-hyperliquid'
import { PendlePtFixedYieldStrategy } from './impl/crypto/pendle-pt-fixed-yield'
import { MonthEndFixStrategy } from './impl/forex/month-end-fix'
import { JpyInterventionFadeStrategy } from './impl/forex/jpy-intervention-fade'
import { CrossPlatformSportsArbStrategy } from './impl/polymarket/cross-platform-sports-arb'
import { PolymarketThetaDecayStrategy } from './impl/polymarket/polymarket-theta-decay'
import { OdteStrangleHedgedStrategy } from './impl/stocks/odte-strangle-hedged'

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

  // Crypto (9)
  new DcaHalvingStrategy(),
  new FundingBasisArbStrategy(),
  new CexLatencyArbStrategy(),
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

  // TIER 3 (all default-disabled in user_enabled_strategies)
  new Activist13dInsiderClusterStrategy(),
  new BuybackAnnouncementMomentumStrategy(),
  new EtfBasisArbStrategy(),
  new LstBasisArbStrategy(),
  new RwaYieldStackStrategy(),
  new London4pmFixEndmonthStrategy(),
  new SwapPointArbitrageStrategy(),
  new PredictionMarketSportsbookArbStrategy(),

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
  new PolymarketMarketMakerStrategy(),
  new PolymarketKalshiWeatherStrategy(),

  // TIER 4 (all default-disabled in user_enabled_strategies)
  new PolymarketTriangleArbStrategy(),

  // Weekly Review 2026-05-09 scaffolds
  new PeadMicrocapTextStrategy(),
  new VixTermStructureStrategy(),
  new FundingBasisArbHyperliquidStrategy(),
  new PendlePtFixedYieldStrategy(),
  new MonthEndFixStrategy(),
  new JpyInterventionFadeStrategy(),
  new CrossPlatformSportsArbStrategy(),
  new PolymarketThetaDecayStrategy(),
  new OdteStrangleHedgedStrategy(),
]

for (const s of ALL_STRATEGIES) {
  strategyRegistry.register(s)
}

export { strategyRegistry }
export { ALL_STRATEGIES }

export function getAllPipelineStrategies() {
  return ALL_STRATEGIES
}
