/**
 * Per-strategy AI confluence configuration.
 *
 * mirofish: 'high'   — run full MiroFish simulation (costs ~$0.012/call)
 * mirofish: 'medium' — run Claude-fallback simulation (cheaper, same interface)
 * mirofish: 'skip'   — never run MiroFish for this strategy
 *
 * kronos: 'block'  — block trade if Kronos opposes direction (requires flag on)
 * kronos: 'warn'   — include Kronos signal in score but don't block
 * kronos: 'skip'   — ignore Kronos for this strategy
 */

export type MiroFishMode = 'high' | 'medium' | 'skip'
export type KronosMode = 'block' | 'warn' | 'skip'

export interface StrategyAIConfig {
  mirofish: MiroFishMode
  kronos: KronosMode
}

export const STRATEGY_AI_CONFIG: Record<string, StrategyAIConfig> = {
  // ── High-conviction momentum strategies ───────────────────────────────────
  momentum:                   { mirofish: 'high',   kronos: 'block' },
  breakout:                   { mirofish: 'high',   kronos: 'block' },
  trend_following:            { mirofish: 'high',   kronos: 'block' },
  dual_momentum:              { mirofish: 'high',   kronos: 'block' },
  cross_sectional_momentum:   { mirofish: 'high',   kronos: 'warn'  },

  // ── Mean reversion ────────────────────────────────────────────────────────
  mean_reversion:             { mirofish: 'medium', kronos: 'warn'  },
  stat_arb:                   { mirofish: 'medium', kronos: 'warn'  },
  pairs_trading:              { mirofish: 'medium', kronos: 'skip'  },
  bollinger_reversion:        { mirofish: 'medium', kronos: 'warn'  },
  rsi_reversion:              { mirofish: 'medium', kronos: 'skip'  },

  // ── Factor strategies ─────────────────────────────────────────────────────
  value:                      { mirofish: 'medium', kronos: 'skip'  },
  quality:                    { mirofish: 'medium', kronos: 'skip'  },
  low_volatility:             { mirofish: 'skip',   kronos: 'skip'  },
  size:                       { mirofish: 'skip',   kronos: 'skip'  },
  profitability:              { mirofish: 'medium', kronos: 'skip'  },

  // ── Macro / regime strategies ─────────────────────────────────────────────
  macro_regime:               { mirofish: 'high',   kronos: 'warn'  },
  risk_parity:                { mirofish: 'skip',   kronos: 'skip'  },
  global_macro:               { mirofish: 'high',   kronos: 'warn'  },
  carry_trade:                { mirofish: 'medium', kronos: 'warn'  },
  volatility_regime:          { mirofish: 'medium', kronos: 'warn'  },

  // ── Crypto-specific ───────────────────────────────────────────────────────
  crypto_momentum:            { mirofish: 'high',   kronos: 'block' },
  crypto_mean_reversion:      { mirofish: 'medium', kronos: 'warn'  },
  defi_yield:                 { mirofish: 'skip',   kronos: 'skip'  },
  on_chain_signal:            { mirofish: 'high',   kronos: 'warn'  },
  funding_rate_arb:           { mirofish: 'medium', kronos: 'skip'  },

  // ── Options strategies ────────────────────────────────────────────────────
  options_flow:               { mirofish: 'high',   kronos: 'warn'  },
  volatility_selling:         { mirofish: 'medium', kronos: 'skip'  },
  gamma_scalping:             { mirofish: 'skip',   kronos: 'skip'  },
  covered_calls:              { mirofish: 'skip',   kronos: 'skip'  },
  protective_puts:            { mirofish: 'skip',   kronos: 'skip'  },

  // ── Sentiment-driven ─────────────────────────────────────────────────────
  news_sentiment:             { mirofish: 'high',   kronos: 'warn'  },
  earnings_momentum:          { mirofish: 'high',   kronos: 'block' },
  insider_flow:               { mirofish: 'high',   kronos: 'warn'  },
  congressional_flow:         { mirofish: 'medium', kronos: 'skip'  },
  social_sentiment:           { mirofish: 'medium', kronos: 'skip'  },

  // ── Prediction market ─────────────────────────────────────────────────────
  polymarket_arbitrage:              { mirofish: 'high',   kronos: 'skip'  },
  prediction_market:                 { mirofish: 'high',   kronos: 'skip'  },
  polymarket_crypto_binary_5min:     { mirofish: 'medium', kronos: 'skip'  },

  // ── Copy trading ─────────────────────────────────────────────────────────
  copy_trade:                 { mirofish: 'high',   kronos: 'warn'  },
  smart_money_follow:         { mirofish: 'high',   kronos: 'warn'  },

  // ── Retirement / tax ─────────────────────────────────────────────────────
  tax_loss_harvest:           { mirofish: 'skip',   kronos: 'skip'  },
  retirement_glide:           { mirofish: 'skip',   kronos: 'skip'  },
  rebalance:                  { mirofish: 'skip',   kronos: 'skip'  },
}

/** Returns config for a strategy, defaulting to 'medium'/'warn' if not found. */
export function getStrategyAIConfig(strategy: string): StrategyAIConfig {
  return STRATEGY_AI_CONFIG[strategy] ?? { mirofish: 'medium', kronos: 'warn' }
}
