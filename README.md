# Wealth OS

AI-powered personal investment platform. Autonomous trading layer with 39 strategies across stocks, crypto, forex, and prediction markets.

## Architecture

```
app/           — Next.js 15 App Router (UI + API routes)
lib/           — Core business logic
  agents/      — CIO Decision Engine, MiroFish, 12 committee agents
  strategies/  — 39 strategy implementations (Tier 1 paper-trading, Tier 2 pending)
  integrations/— External tool wrappers (Vibe-Trading, Camofox, AutoHedge)
  workers/     — Background sync workers (Kronos, Quiver, News Sentiment)
  brokers/     — Broker routing and adapters (Alpaca, Coinbase, OANDA, Polymarket)
supabase/      — Schema + migrations
docs/          — Build plans, integration guides
```

## Quick Start

```bash
npm install
cp .env.local.example .env.local  # fill in Supabase + broker keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See `.env.local.example` for the full list. Minimum required:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional (enables specific features):

```env
ANTHROPIC_API_KEY=         # MiroFish + CIO synthesis
QUIVER_QUANT_API_KEY=      # Congressional trades (falls back to Camofox scraping)
VIBE_TRADING_MCP_URL=      # Vibe-Trading MCP server (default: http://localhost:8765)
CAMOFOX_URL=               # Camofox Docker container (default: http://localhost:9377)
USE_AUTOHEDGE_DISTILLED_PROMPTS=false  # A/B test AutoHedge CIO prompts
```

## External Integrations

All integrations are visible in **Settings → Integrations** in the dashboard.

### 1. Vibe-Trading (HKUDS) — MCP Research Tools

17 finance tools for backtesting, factor analysis, options analysis, and pattern recognition. 16 of 17 tools work with zero API keys.

```bash
git clone https://github.com/HKUDS/Vibe-Trading
cd Vibe-Trading && pip install -r requirements.txt
python mcp_server.py --port 8765
```

Set `VIBE_TRADING_MCP_URL=http://localhost:8765` in `.env.local`. Feature flag: `vibe_trading`.

### 2. Camofox Browser (jo-inc) — Anti-Detection Scraping

Free-tier fallback for congressional trades, Polymarket Dune dashboards, and Reddit/X sentiment.

```bash
docker compose up -d        # starts camofox on port 9377
```

Set `CAMOFOX_URL=http://localhost:9377` in `.env.local`. Feature flag: `camofox_scraping`.  
Health check: `GET /api/integrations/camofox/health`

### 3. AutoHedge Prompts (The-Swarm-Corporation) — Read-Only Reference

4 agent prompts distilled into `lib/integrations/autohedge-distilled/`. A/B tested against native CIO prompts.

```env
USE_AUTOHEDGE_DISTILLED_PROMPTS=true   # activate distilled variant
```

Results logged to `agent_performance_logs`. Compare in `/calibration` → Integration Lift.

### 4. ClawRouter / Context-Mode (mksglu) — Dev Tooling Only

Reduces Claude Code context window usage during development. Pre-configured in `.claude/settings.json`. **NOT deployed to production.**

```bash
npm i -g context-mode && ctx stats   # verify active
```

### 5. Fincept Terminal — Manual Research Companion

Standalone desktop app. **Not in the monorepo.** Install separately alongside Wealth OS.

| Platform | Install |
|---|---|
| Windows | MSI from [github.com/Fincept-Corporation/FinceptTerminal/releases](https://github.com/Fincept-Corporation/FinceptTerminal/releases) |
| macOS | DMG from same releases page |
| Linux | AppImage from same releases page |
| pip | `pip install fincept-terminal && fincept` |

**Wealth OS** = autonomous execution. **Fincept Terminal** = manual research. Use both.

## Database Migrations

Run in Supabase SQL editor in order:

```
supabase/schema.sql
supabase/migrations/20260425_tier1_strategies.sql
supabase/migrations/20260425_external_integrations.sql
```

## Tests

```bash
npx vitest run                              # all tests
npx vitest run __tests__/integrations/     # integration tests only
npx vitest run __tests__/strategies/       # strategy tests only
```

## Paper Trading

Tier 1 strategies are in paper-trading mode. Monitor lift in `/calibration`. Tier 2 requires ≥ 60 days of positive paper performance.

## Deploy on Vercel

```bash
vercel --prod
```

Set all env vars in the Vercel dashboard. Docker services (Camofox) must be hosted separately.
