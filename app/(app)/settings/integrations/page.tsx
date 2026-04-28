'use client'

import { useState, useEffect } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLink, CheckCircle2, XCircle, AlertCircle, RefreshCw } from 'lucide-react'

interface IntegrationHealth {
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  latencyMs?: number
  // Polymarket-engine specific
  walletConnected?: boolean
  lastTradeAt?: string | null
  trades30d?: number
  avgPnl30d?: number | null
  brierScore30d?: number | null
}

interface Integration {
  id: string
  name: string
  tagline: string
  description: string
  githubUrl: string
  docsUrl?: string
  type: 'mcp_server' | 'docker_service' | 'prompt_library' | 'dev_tooling' | 'external_app'
  deploymentNote: string
  featureKey?: string
  enabledInStrategies?: string[]
  costNote: string
  checkHealthUrl?: string
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'vibe_trading',
    name: 'Vibe-Trading',
    tagline: 'HKUDS multi-agent finance workspace',
    description:
      '17 MCP tools for backtesting, factor analysis, options analysis, and chart pattern recognition. 16 of 17 tools work with zero API keys. Wired into quant_momentum (factor analysis), vcp_minervini (pattern recognition), and options_wheel (options analysis).',
    githubUrl: 'https://github.com/HKUDS/Vibe-Trading',
    type: 'mcp_server',
    deploymentNote: 'Run locally: pip install -r requirements.txt && python mcp_server.py --port 8765. Set VIBE_TRADING_MCP_URL in .env.local.',
    featureKey: 'vibe_trading',
    enabledInStrategies: ['quant_momentum', 'vcp_minervini', 'options_wheel'],
    costNote: 'Free (self-hosted). Set VIBE_TRADING_MCP_URL.',
    checkHealthUrl: '/api/integrations/vibe-trading',
  },
  {
    id: 'camofox',
    name: 'Camofox Browser',
    tagline: 'Anti-detection headless scraping',
    description:
      'C++ anti-detection headless browser that serves as a free fallback when paid data APIs (Quiver Quant, Unusual Whales) are off or budget-exhausted. Scrapes capitoltrades.com, Polymarket Dune dashboards, Reddit sentiment, and Google Trends.',
    githubUrl: 'https://github.com/jo-inc/camofox-browser',
    type: 'docker_service',
    deploymentNote: 'docker compose up -d. Requires Docker. Container starts on port 9377. Add CAMOFOX_URL=http://localhost:9377 to .env.local.',
    featureKey: 'camofox_scraping',
    enabledInStrategies: ['autopilot_congressional', 'polymarket_wallet_copy'],
    costNote: '$0.005/call (5 cents) to cover compute overhead.',
    checkHealthUrl: '/api/integrations/camofox/health',
  },
  {
    id: 'autohedge',
    name: 'AutoHedge Prompts',
    tagline: 'Distilled hedge fund agent prompts',
    description:
      'The-Swarm-Corporation/AutoHedge\'s 4 agent patterns (Director CIO, Quant Analyst, Risk Manager, Execution Trader) distilled into Wealth OS-compatible system prompts. Adds: explicit conviction scale, mandatory bear case, counterfactual stress test, quarter-Kelly sizing.',
    githubUrl: 'https://github.com/The-Swarm-Corporation/AutoHedge',
    docsUrl: '/docs/external/autohedge/INTEGRATION.md',
    type: 'prompt_library',
    deploymentNote: 'No deployment needed. Activate via USE_AUTOHEDGE_DISTILLED_PROMPTS=true in .env.local. Results logged to agent_performance_logs for A/B comparison.',
    featureKey: undefined,
    enabledInStrategies: [],
    costNote: 'No cost. Prompts run on existing Claude API budget.',
  },
  {
    id: 'context_mode',
    name: 'ClawRouter / Context-Mode',
    tagline: 'Dev-only: context window optimiser for Claude Code',
    description:
      'mksglu/context-mode reduces Claude Code context window consumption by up to 98% during development. Configured via .claude/settings.json hooks. NOT deployed to production — development tooling only.',
    githubUrl: 'https://github.com/mksglu/context-mode',
    type: 'dev_tooling',
    deploymentNote: 'Already configured in .claude/settings.json. Install CLI: npm i -g context-mode. Verify: ctx stats. See CONTRIBUTING.md § Context-Mode.',
    costNote: 'Free. Reduces Claude API costs during development by compressing context.',
  },
  {
    id: 'polymarket_engine',
    name: 'Polymarket Trade Engine',
    tagline: 'Oracle-lag execution for BTC/ETH/SOL binary price markets',
    description:
      'KaustubhPatange/polymarket-trade-engine: Python REST wrapper around the Polymarket CLOB API. '
      + 'Powers the polymarket_crypto_binary_5min strategy — places limit orders, detects fills, '
      + 'pre-arms exit at 0.75, and hard-exits 15s before window close. '
      + 'Runs as a local HTTP sidecar on port 7432. Requires a funded Polymarket wallet (MATIC).',
    githubUrl: 'https://github.com/KaustubhPatange/polymarket-trade-engine',
    docsUrl: '/docs/external/polymarket-engine-audit.md',
    type: 'docker_service',
    deploymentNote:
      'pip install -r requirements.txt && python -m polymarket_engine --port 7432 --private-key $POLYMARKET_PRIVATE_KEY. '
      + 'Add POLYMARKET_ENGINE_URL=http://localhost:7432 and POLYMARKET_PRIVATE_KEY to .env.local. '
      + 'Wallet must hold MATIC for gas and USDC.e for position funding.',
    featureKey: 'polymarket_engine',
    enabledInStrategies: ['polymarket_crypto_binary_5min'],
    costNote: '$0.05/order call (compute estimate). Default $5/month budget cap.',
    checkHealthUrl: '/api/integrations/polymarket-engine/health',
  },
  {
    id: 'fincept',
    name: 'Fincept Terminal',
    tagline: 'Manual research companion (standalone desktop app)',
    description:
      'Fincept-Corporation/FinceptTerminal is a native desktop financial terminal for manual research. NOT integrated into the monorepo — install as a standalone app. Wealth OS = autonomous trading layer; Fincept Terminal = manual research layer.',
    githubUrl: 'https://github.com/Fincept-Corporation/FinceptTerminal',
    type: 'external_app',
    deploymentNote: 'Install separately: Windows (MSI), macOS (DMG), Linux (AppImage). See README § Fincept Terminal.',
    costNote: 'Free and open source.',
  },
  {
    id: 'openbb',
    name: 'OpenBB Platform',
    tagline: 'Open-source investment research terminal',
    description:
      'OpenBB-finance/OpenBBTerminal: 200+ data connectors (SEC EDGAR, FRED, Yahoo Finance, Quandl, Intrinio, EOD, Tiingo, etc.). '
      + 'Use as a manual research companion alongside Wealth OS automated strategies. The OpenBB Copilot integration (AI assistant) can be pointed at a local Claude endpoint. '
      + 'Primary use case: ad-hoc research, portfolio attribution analysis, strategy hypothesis testing before committing to automated runs.',
    githubUrl: 'https://github.com/OpenBB-finance/OpenBBTerminal',
    docsUrl: 'https://docs.openbb.co/platform',
    type: 'external_app',
    deploymentNote:
      'pip install openbb. Launch: openbb. For Hub integration: openbb.account.login(). '
      + 'Standalone — no Wealth OS .env config needed unless wiring Copilot to local Claude.',
    costNote: 'Free open source core. Premium data connectors use your own API keys (Bloomberg, Refinitiv, etc.).',
  },
  {
    id: 'polygon_l2',
    name: 'Polygon L2 Order Book',
    tagline: 'Real-time level-2 order book snapshots for OBI confluence',
    description:
      'Polygon.io WebSocket L2 snapshots powering the order book imbalance (OBI) confluence gate (Stage 4.5 in the strategy pipeline). '
      + 'Strategies vcp_minervini, pead, gamma_exposure, and onchain_signal use OBI as a pre-entry confirmation: '
      + 'if the order book opposes the trade direction (bid/ask ratio < 0.55 for longs, > 1.8 for shorts), the CIO engine emits reduce_size. '
      + 'Falls back to IEX Deep for stocks; skipped for forex and polymarket assets.',
    githubUrl: 'https://github.com/polygon-io/client-js',
    type: 'mcp_server',
    deploymentNote:
      'Set POLYGON_API_KEY in .env.local (Starter plan or above for L2 data). '
      + 'IEX fallback requires IEX_API_KEY. OBI is fail-open: if both sources are unreachable, the strategy proceeds normally.',
    featureKey: 'polygon_l2',
    enabledInStrategies: ['vcp_minervini', 'pead', 'gamma_exposure', 'onchain_signal'],
    costNote: '$0.001/snapshot call. Default $5/month budget cap. Falls back to iex_deep (free tier) when budget exhausted.',
  },
  {
    id: 'dexter_research',
    name: 'Dexter — SEC & Earnings Researcher',
    tagline: 'Autonomous researcher over SEC EDGAR, earnings transcripts, analyst reports',
    description:
      'virattt/dexter: Python LLM agent that reads SEC filings (10-K, 10-Q, 8-K), earnings call transcripts, '
      + 'and analyst reports. Returns structured summaries for use in pead, spinoff, merger_arb, and qvm_multifactor strategies. '
      + 'Runs as an HTTP sidecar on port 7433 (DEXTER_URL). Results are cached 24h in dexter_research_cache to minimise repeat LLM calls.',
    githubUrl: 'https://github.com/virattt/dexter',
    type: 'docker_service',
    deploymentNote:
      'pip install dexter-research && python -m dexter --port 7433. '
      + 'Set DEXTER_URL=http://localhost:7433 and OPENAI_API_KEY (or ANTHROPIC_API_KEY) in .env.local. '
      + 'Requires EDGAR_FULL_TEXT_SEARCH_API key for full-text EDGAR search (free at efts.sec.gov).',
    featureKey: 'dexter_research',
    enabledInStrategies: ['pead', 'spinoff', 'merger_arb', 'qvm_multifactor'],
    costNote: '$0.05/research call (approx 1 LLM call). Default $1.50/month budget cap.',
  },
  {
    id: 'financial_datasets_mcp',
    name: 'Financial Datasets MCP',
    tagline: 'Typed financial statement data via MCP protocol',
    description:
      'financial-datasets/mcp-server: second MCP source alongside Vibe-Trading. Provides typed financial data: '
      + 'income statements, balance sheets, cash flows, SEC filings, historical prices, and earnings estimates. '
      + 'Free tier covers most strategy needs; premium endpoints (institutional ownership, analyst estimates) require FINANCIAL_DATASETS_API_KEY. '
      + 'Tool manifest mapped to: pead (earnings), qvm_multifactor (statements), merger_arb (SEC filings), vcp_minervini (price history).',
    githubUrl: 'https://github.com/financial-datasets/mcp-server',
    type: 'mcp_server',
    deploymentNote:
      'npx @financial-datasets/mcp-server --port 8766. '
      + 'Set FINANCIAL_DATASETS_MCP_URL=http://localhost:8766 in .env.local. '
      + 'Optional: FINANCIAL_DATASETS_API_KEY for premium endpoints (institutional ownership, analyst estimates).',
    featureKey: 'financial_datasets_mcp',
    enabledInStrategies: ['pead', 'qvm_multifactor', 'merger_arb', 'vcp_minervini'],
    costNote: 'Free tier: $0/call. Premium tier: ~$15/month subscription. Free tier sufficient for most strategies.',
  },
  {
    id: 'crucix',
    name: 'Crucix On-Chain Whale Aggregator',
    tagline: 'Polygon whale wallet movements with 85% labeled-actor coverage',
    description:
      'Polygon-native whale wallet movement tracker used as supplementary signal for onchain_signal and polymarket_wallet_copy strategies. '
      + 'Covers ~85% of known actors (CEX hot wallets, Polymarket LPs, MEV bots) vs ~40% for direct Polygonscan queries. '
      + 'Wired as confirmation signal: CIO increases size +15% on agreement with strategy direction, reduces -25% on contradiction. '
      + 'See docs/external/crucix-evaluation.md for full coverage comparison and re-evaluation triggers.',
    githubUrl: 'https://github.com/crucix-io/crucix',
    docsUrl: '/docs/external/crucix-evaluation.md',
    type: 'mcp_server',
    deploymentNote:
      'REST API — no self-hosting required. Set CRUCIX_API_KEY in .env.local (free tier: 1,000 req/day; premium for higher limits). '
      + 'Free tier is sufficient for ≤10 symbols monitored at 15-min intervals.',
    featureKey: 'crucix',
    enabledInStrategies: ['onchain_signal', 'polymarket_wallet_copy'],
    costNote: 'Free tier: $0 (1,000 req/day). Premium tier: contact Crucix for pricing.',
  },
  {
    id: 'cex_latency_arb',
    name: 'CEX Latency Arb',
    tagline: 'Cross-venue BTC/ETH/SOL spread capture (paper trade gate)',
    description:
      'Structural delta-neutral strategy that buys at the cheaper venue and sells at the more expensive venue when the spread exceeds 8 bps net of fees. '
      + 'Monitors Coinbase, Kraken, and Binance.US in parallel. Max 0.25% per leg (0.5% combined). Hard exit at 5 minutes. '
      + 'DEFAULT DISABLED — requires explicit opt-in via user_enabled_strategies. '
      + 'PAPER TRADE GATE: 30-day mandatory paper-trade window before live capital. Promotion requires Sharpe > 1.5 AND max drawdown < 5%. '
      + 'See docs/external/cex-latency-arb-audit.md for risk assessment and known limitations (REST polling captures lags >200ms only).',
    githubUrl: 'https://github.com/anthropics/claude-code',
    docsUrl: '/docs/external/cex-latency-arb-audit.md',
    type: 'external_app',
    deploymentNote:
      'No external sidecar required — strategy polls Coinbase, Kraken, and Binance.US public REST APIs directly. '
      + 'Set COINBASE_API_KEY, KRAKEN_API_KEY, BINANCE_US_API_KEY in .env.local for order placement. '
      + 'Enable via Settings → Strategies → CEX Latency Arb toggle (requires user_enabled_strategies opt-in).',
    featureKey: undefined,
    enabledInStrategies: ['cex_latency_arb'],
    costNote: 'No integration cost. Trading fees: ~10 bps round-trip per pair (Coinbase 5bps + Kraken 5bps). Min threshold: 8 bps net.',
  },
  {
    id: 'polymarket_mm',
    name: 'Polymarket Market Maker',
    tagline: 'Automated bid-ask spread income on Polymarket CLOB',
    description: 'Provides liquidity on Polymarket prediction markets. Income strategy analogous to options_wheel. Requires POLYMARKET_PRIVATE_KEY. Mandatory 14-day paper-trade validation before live.',
    githubUrl: 'https://github.com/Polymarket/poly-market-maker',
    type: 'external_app',
    deploymentNote: 'Paper trading only until promotion gates pass. Set POLYMARKET_PRIVATE_KEY in .env.',
    featureKey: 'polymarket_mm',
    enabledInStrategies: ['polymarket_market_maker'],
    costNote: 'Free (0 cents/call). Gas costs on Polygon for live orders.',
  },
  {
    id: 'kalshi_api',
    name: 'Kalshi API',
    tagline: 'CFTC-regulated prediction market (US retail legal)',
    description: 'Connects to Kalshi, a CFTC Designated Contract Market. Used by the polymarket_kalshi_weather strategy for weather market arbitrage between platforms.',
    githubUrl: 'https://github.com/Kalshi/kalshi-python',
    docsUrl: 'https://trading-api.readme.io',
    type: 'external_app',
    deploymentNote: 'Set KALSHI_API_KEY and KALSHI_API_SECRET. US retail accounts supported.',
    featureKey: 'kalshi_api',
    enabledInStrategies: ['polymarket_kalshi_weather'],
    costNote: 'Free API. 50 bps taker fee per contract.',
  },
  {
    id: 'weather_ensemble',
    name: 'Open-Meteo Weather Ensemble',
    tagline: 'Free multi-model ensemble forecasts (GFS, ECMWF, ICON)',
    description: 'Open-Meteo provides GFS 31-member, ECMWF IFS, and ICON ensemble forecasts at no cost. Used by polymarket_kalshi_weather to compute fair probability of weather outcomes.',
    githubUrl: 'https://github.com/open-meteo/open-meteo',
    docsUrl: 'https://open-meteo.com/en/docs',
    type: 'external_app',
    deploymentNote: 'No API key required. Free tier: unlimited calls.',
    featureKey: 'weather_ensemble',
    enabledInStrategies: ['polymarket_kalshi_weather'],
    costNote: 'Free (no API key required).',
  },
  {
    id: 'polymarket_insider_score',
    name: 'Polymarket Insider Score',
    tagline: 'NickNaskida 0-10 insider indicator for wallet copy',
    description: 'Scores each wallet trade on 5 insider-behavior signals: wallet age, market thinness, trade size, prior trade count, and pre-resolution timing. Scores >= 7 preferred for wallet copy.',
    githubUrl: 'https://github.com/nicknaskida/polymarket-insider-detector',
    type: 'external_app',
    deploymentNote: 'No external API required. Feature flag: polymarket_insider_score.',
    featureKey: 'polymarket_insider_score',
    enabledInStrategies: ['polymarket_wallet_copy'],
    costNote: 'Free (local scoring, no API calls).',
  },
  {
    id: 'wallet_funding_trail',
    name: 'Wallet Funding Trail',
    tagline: 'Sybil detection via pselamy funding-trail methodology',
    description: 'Traces wallet funding sources up to 3 hops using Polygonscan. Identifies Binance/Coinbase/Kraken hot-wallet origins and Sybil clusters. Blocks trades from clusters larger than 5.',
    githubUrl: 'https://github.com/pselamy/polymarket-insider-tracker',
    type: 'external_app',
    deploymentNote: 'Optional: set POLYGONSCAN_API_KEY for higher rate limits (free tier works without key).',
    featureKey: 'wallet_funding_trail',
    enabledInStrategies: ['onchain_signal', 'polymarket_wallet_copy'],
    costNote: 'Free via Polygonscan free tier. Optional POLYGONSCAN_API_KEY for 5 req/s.',
  },
]

function StatusBadge({ status }: { status: IntegrationHealth['status'] }) {
  if (status === 'ok')      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Online</Badge>
  if (status === 'down')    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Offline</Badge>
  if (status === 'degraded')return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><AlertCircle className="h-3 w-3 mr-1" />Degraded</Badge>
  return <Badge variant="outline" className="text-muted-foreground">Not checked</Badge>
}

function TypeBadge({ type }: { type: Integration['type'] }) {
  const map: Record<Integration['type'], string> = {
    mcp_server: 'MCP Server',
    docker_service: 'Docker Service',
    prompt_library: 'Prompt Library',
    dev_tooling: 'Dev Tooling',
    external_app: 'External App',
  }
  return <Badge variant="secondary" className="text-xs">{map[type]}</Badge>
}

export default function IntegrationsPage() {
  const [health, setHealth] = useState<Record<string, IntegrationHealth>>({})
  const [checking, setChecking] = useState<string | null>(null)

  async function checkHealth(integration: Integration) {
    if (!integration.checkHealthUrl) return
    setChecking(integration.id)
    try {
      const res = await fetch(integration.checkHealthUrl)
      const data = await res.json() as {
        status: string; latencyMs?: number;
        walletConnected?: boolean; lastTradeAt?: string | null;
        trades30d?: number; avgPnl30d?: number | null; brierScore30d?: number | null
      }
      setHealth(prev => ({
        ...prev,
        [integration.id]: {
          status: (data.status as IntegrationHealth['status']) ?? 'unknown',
          latencyMs: data.latencyMs,
          walletConnected: data.walletConnected,
          lastTradeAt: data.lastTradeAt,
          trades30d: data.trades30d,
          avgPnl30d: data.avgPnl30d,
          brierScore30d: data.brierScore30d,
        },
      }))
    } catch {
      setHealth(prev => ({ ...prev, [integration.id]: { status: 'down' } }))
    } finally {
      setChecking(null)
    }
  }

  useEffect(() => {
    // Auto-check health for services that expose a health endpoint
    INTEGRATIONS.filter(i => i.checkHealthUrl).forEach(i => checkHealth(i))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <Topbar
        title="Integrations"
        subtitle="External tools and research services wired into Wealth OS"
      />

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          12 integrations configured. All paid-path integrations route through the{' '}
          <span className="font-mono text-xs bg-muted px-1 rounded">FeatureFlagService</span>{' '}
          budget gate. Every integration degrades gracefully when unreachable.
        </p>

        {INTEGRATIONS.map(integration => {
          const h = health[integration.id] ?? { status: 'unknown' }
          const isChecking = checking === integration.id

          return (
            <Card key={integration.id} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">{integration.name}</CardTitle>
                      <TypeBadge type={integration.type} />
                      {integration.checkHealthUrl && <StatusBadge status={h.status} />}
                      {h.latencyMs && (
                        <span className="text-xs text-muted-foreground">{h.latencyMs}ms</span>
                      )}
                    </div>
                    <CardDescription>{integration.tagline}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {integration.checkHealthUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => checkHealth(integration)}
                        disabled={isChecking}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${isChecking ? 'animate-spin' : ''}`} />
                        Check
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" asChild>
                      <a href={integration.githubUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        GitHub
                      </a>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{integration.description}</p>

                {integration.enabledInStrategies && integration.enabledInStrategies.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Used by:</span>
                    {integration.enabledInStrategies.map(s => (
                      <Badge key={s} variant="outline" className="text-xs font-mono">{s}</Badge>
                    ))}
                  </div>
                )}

                <div className="bg-muted/40 rounded-md p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Setup</p>
                  <p className="text-xs text-foreground/80 font-mono leading-relaxed">{integration.deploymentNote}</p>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span><span className="font-medium">Cost:</span> {integration.costNote}</span>
                  {integration.featureKey && (
                    <span><span className="font-medium">Flag:</span>{' '}
                      <span className="font-mono bg-muted px-1 rounded">{integration.featureKey}</span>
                    </span>
                  )}
                </div>

                {/* Polymarket-engine extended health stats */}
                {integration.id === 'polymarket_engine' && h.status !== 'unknown' && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                    <div className="bg-muted/30 rounded p-2 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Wallet</p>
                      <p className={`text-xs font-semibold ${h.walletConnected ? 'text-green-400' : 'text-red-400'}`}>
                        {h.walletConnected == null ? '—' : h.walletConnected ? 'Connected' : 'Disconnected'}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded p-2 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Trades (30d)</p>
                      <p className="text-xs font-semibold text-foreground">{h.trades30d ?? '—'}</p>
                    </div>
                    <div className="bg-muted/30 rounded p-2 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg PnL (30d)</p>
                      <p className={`text-xs font-semibold ${h.avgPnl30d == null ? 'text-muted-foreground' : h.avgPnl30d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {h.avgPnl30d == null ? '—' : `${(h.avgPnl30d * 100).toFixed(1)}%`}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded p-2 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Brier (30d)</p>
                      <p className={`text-xs font-semibold ${h.brierScore30d == null ? 'text-muted-foreground' : h.brierScore30d < 0.10 ? 'text-green-400' : h.brierScore30d < 0.20 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {h.brierScore30d == null ? '—' : h.brierScore30d.toFixed(3)}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {/* AI Feature Cards */}
        <div className="pt-4 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">AI Scoring Features</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Insider Score</CardTitle>
                <CardDescription className="text-xs">NickNaskida 0-10 rubric</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>+3 wallet age &lt; 7d</p>
                <p>+2 market vol24h &lt; $50k</p>
                <p>+2 trade size &gt; $5k</p>
                <p>+2 prior trades &lt; 10</p>
                <p>+1 timing &lt; 60min before resolution</p>
                <p className="pt-1 font-medium text-foreground/70">Threshold: &gt;= 7 = insider-like</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Funding Trail</CardTitle>
                <CardDescription className="text-xs">pselamy Sybil detection</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>Traces up to 3 hops via Polygonscan</p>
                <p>Identifies CEX hot-wallet origins</p>
                <p>Binance / Coinbase / Kraken labels</p>
                <p>Sybil cluster detection</p>
                <p className="pt-1 font-medium text-foreground/70">Blocks trades: cluster &gt; 5 wallets</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Weather Ensemble</CardTitle>
                <CardDescription className="text-xs">Open-Meteo fair-value model</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>GFS 31-member ensemble</p>
                <p>ECMWF IFS forecast</p>
                <p>ICON model integration</p>
                <p>No API key required</p>
                <p className="pt-1 font-medium text-foreground/70">Used by: polymarket_kalshi_weather</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
