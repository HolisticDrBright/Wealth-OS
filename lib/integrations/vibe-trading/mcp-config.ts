/**
 * Vibe-Trading MCP server configuration.
 *
 * The Vibe-Trading project (HKUDS) ships 17 finance tools as an MCP server.
 * This module holds the static configuration and the tool manifest so the
 * rest of the app can inspect available tools without a live connection.
 *
 * To start the server locally:
 *   git clone https://github.com/HKUDS/Vibe-Trading
 *   cd Vibe-Trading && pip install -r requirements.txt
 *   python mcp_server.py --port 8765
 *
 * In production, set VIBE_TRADING_MCP_URL to the deployed server URL.
 */

export const VIBE_TRADING_MCP_CONFIG = {
  serverUrl: process.env.VIBE_TRADING_MCP_URL ?? 'http://localhost:8765',
  featureKey: 'vibe_trading',
  displayName: 'Vibe-Trading Research Tools',
  githubUrl: 'https://github.com/HKUDS/Vibe-Trading',
  requiresApiKey: false,
} as const

export type VibeTradingTool =
  | 'backtest'
  | 'factor_analysis'
  | 'pattern_recognition'
  | 'analyze_options'
  | 'momentum_analysis'
  | 'volatility_analysis'
  | 'portfolio_optimization'
  | 'correlation_analysis'
  | 'sector_rotation'
  | 'market_regime_detection'
  | 'sentiment_analysis'
  | 'technical_indicators'
  | 'fundamental_analysis'
  | 'macro_analysis'
  | 'pairs_trading'
  | 'risk_analysis'
  | 'event_driven_analysis'

export interface VibeTradingToolManifest {
  name: VibeTradingTool
  description: string
  requiresApiKey: boolean
  usedByStrategies: string[]
}

export const VIBE_TRADING_TOOLS: VibeTradingToolManifest[] = [
  { name: 'backtest',              description: 'Strategy backtesting with custom Python code',                requiresApiKey: false, usedByStrategies: ['quant_momentum', 'vcp_minervini', 'options_wheel'] },
  { name: 'factor_analysis',       description: 'Multi-factor scoring: momentum, value, quality, size',       requiresApiKey: false, usedByStrategies: ['quant_momentum', 'sector_rotation'] },
  { name: 'pattern_recognition',   description: 'Chart pattern detection: VCP, cup-and-handle, flags',        requiresApiKey: false, usedByStrategies: ['vcp_minervini'] },
  { name: 'analyze_options',       description: 'Options strategy analysis and strike selection',              requiresApiKey: false, usedByStrategies: ['options_wheel', 'gamma_exposure'] },
  { name: 'momentum_analysis',     description: 'Cross-sectional and time-series momentum signals',           requiresApiKey: false, usedByStrategies: ['quant_momentum'] },
  { name: 'volatility_analysis',   description: 'Realized vs implied vol, VIX regime detection',             requiresApiKey: false, usedByStrategies: ['options_wheel', 'gamma_exposure'] },
  { name: 'portfolio_optimization',description: 'Mean-variance and risk-parity portfolio construction',       requiresApiKey: false, usedByStrategies: ['sector_rotation'] },
  { name: 'correlation_analysis',  description: 'Rolling correlation matrices and regime detection',          requiresApiKey: false, usedByStrategies: ['correlation_divergence'] },
  { name: 'sector_rotation',       description: 'Relative strength across GICS sectors',                     requiresApiKey: false, usedByStrategies: ['sector_rotation'] },
  { name: 'market_regime_detection',description: 'Markov-switching model for bull/bear/neutral regimes',     requiresApiKey: false, usedByStrategies: ['quant_momentum', 'sector_rotation'] },
  { name: 'sentiment_analysis',    description: 'News and social media sentiment aggregation',                requiresApiKey: true,  usedByStrategies: [] },
  { name: 'technical_indicators',  description: 'RSI, MACD, Bollinger Bands, ATR, and 20+ indicators',       requiresApiKey: false, usedByStrategies: ['vcp_minervini', 'session_breakout'] },
  { name: 'fundamental_analysis',  description: 'Earnings, P/E, EV/EBITDA, and DCF valuation',               requiresApiKey: false, usedByStrategies: ['dividend_aristocrat'] },
  { name: 'macro_analysis',        description: 'Macro regime mapping: rates, FX, commodities',              requiresApiKey: false, usedByStrategies: ['carry_trade', 'macro_news_event'] },
  { name: 'pairs_trading',         description: 'Cointegration and z-score pairs trading signals',           requiresApiKey: false, usedByStrategies: ['correlation_divergence'] },
  { name: 'risk_analysis',         description: 'VaR, CVaR, stress testing, and drawdown analysis',          requiresApiKey: false, usedByStrategies: ['options_wheel', 'vcp_minervini'] },
  { name: 'event_driven_analysis', description: 'Earnings surprise, M&A, and spin-off event models',        requiresApiKey: false, usedByStrategies: ['pead', 'spinoff', 'merger_arb'] },
]
