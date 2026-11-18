# Wealth OS

AI-powered personal investment platform. Autonomous trading layer with 39 strategies across stocks, crypto, forex, and prediction markets.

## Architecture

```
app/           — Next.js 16 App Router (UI + API routes)
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

Open [http://localhost:3120](http://localhost:3120) — the dev server runs on port **3120** (`next dev -p 3120`).

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

## MCP Integrations

Wealth OS wires four crypto MCP servers. See [`docs/mcp-servers.md`](docs/mcp-servers.md) for the full reference.

| MCP | State | Purpose |
|---|---|---|
| `ccxt-mcp` | **Active** | Multi-exchange read-only data (tickers, OHLCV, funding rates) |
| `cryptopanic-mcp` | **Active** | Crypto news + narrative heat scores for `narrative_rotation` |
| `aave-mcp` | Gated | Aave reserve APY data — enable when `pendle_pt_fixed_yield` is implemented |
| `uniswap-poolspy-mcp` | Gated | New Uniswap pools — enable when `memecoin_bondingcurve` is implemented |

Write-capable MCPs (`uniswap-trader-mcp`, `mcp-cryptowallet-evm`) are explicitly blocked — all execution goes through `lib/broker-adapters/`.

## Developer R&D Loop

Wealth OS ships an opt-in [TradingView MCP](docs/tradingview-mcp-workflow.md) integration for validating indicator logic against TradingView's Pine Script engine during development.

```bash
# 1. Enable in .mcp.json (local only, never commit)
#    Set "disabled": false in the tradingview-mcp entry

# 2. Restart Claude Code — MCP tools appear automatically

# 3. Ask Claude to pull bars, run Pine Script, compare to lib/indicators/ output

# 4. Commit the vitest fixture, revert .mcp.json
```

See `docs/tradingview-mcp-workflow.md` for full instructions.

## Database Migrations

> The migration filenames use a `YYYYMMDD<letter>_name.sql` pattern that the
> Supabase CLI does not accept, so `supabase db push` skips them all. Apply
> them by pasting into the Supabase SQL editor instead, in this order:

```
supabase/schema.sql                 # base schema first
supabase/migrations/20260425_tier1_strategies.sql
supabase/migrations/20260425_external_integrations.sql
supabase/migrations/20260427_order_book_imbalance.sql
supabase/migrations/20260427_polymarket_engine.sql
supabase/migrations/20260427_tier2_features.sql
supabase/migrations/20260428_paper_trading.sql
supabase/migrations/20260428_paper_trading_add_neutral.sql
supabase/migrations/20260506_risk_profiles.sql
supabase/migrations/20260509_learning_loop_columns.sql
supabase/migrations/20260509_weekly_review_strategies.sql
supabase/migrations/20260509b_odte_strangle.sql
supabase/migrations/20260509c_user_state.sql
supabase/migrations/20260509d_deep_scan_strategies.sql
supabase/migrations/20260509e_risk_profile_user_state.sql
supabase/migrations/20260510_strategy_hardening.sql
supabase/migrations/20260529_audit_logs_missing_columns.sql
supabase/migrations/20260529b_audit_logs_insert_policy.sql
supabase/migrations/20260529c_paper_trade_runs.sql
supabase/migrations/20260529d_shadow_positions.sql
supabase/migrations/20260610a_wash_sale_blocklist.sql
supabase/migrations/20260610b_tax_loss_ledger.sql
supabase/migrations/20260610c_rebalance_tax_columns.sql
supabase/migrations/20260610d_paper_run_regime.sql
supabase/migrations/20260703a_system_flags.sql
supabase/migrations/20260703b_order_intents.sql
supabase/migrations/20260703c_advisory_module.sql
supabase/migrations/20260703d_ui_prefs.sql
supabase/migrations/20260703e_adversarial_defense.sql
supabase/migrations/20260703f_pit_facts.sql
supabase/migrations/20260703g_corpus_aggregates.sql
supabase/migrations/20260703h_sleeve_floors.sql
supabase/migrations/20260703i_r3_finishers.sql
supabase/migrations/20260703j_regime_state.sql
supabase/migrations/20260703k_ledger.sql
supabase/migrations/20260703l_behavior_events.sql
supabase/migrations/20260703m_live_trading_safety.sql
supabase/migrations/20260704a_agent_weights.sql
supabase/migrations/20260704b_provenance.sql
supabase/migrations/20260704c_wealth_tiers.sql
supabase/migrations/20260704d_orders_skipped_status.sql
supabase/migrations/20260704f_wealth_foundation.sql
supabase/migrations/20260704g_research_proposals.sql
supabase/migrations/20260704h_business_context.sql
supabase/migrations/20260704i_income_growth_params.sql
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
