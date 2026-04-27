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
          6 integrations configured. All paid-path integrations route through the{' '}
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
      </div>
    </div>
  )
}
