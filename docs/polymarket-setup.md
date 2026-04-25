# Polymarket Setup Guide

Wealth-OS integrates with **Meta_Poly_tarder**, a Python sidecar that handles all strategy execution, order routing, and portfolio management for Polymarket prediction markets. Wealth-OS itself is a pure client — it reads data from and sends commands to the sidecar via HTTP and WebSocket.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.11+ |
| Meta_Poly_tarder | latest |
| Wealth-OS | any (Phase 2c+) |
| Anthropic API key | optional — required for AI Analysis only |

Clone Meta_Poly_tarder alongside this repo:

```bash
git clone <meta-poly-tarder-repo> ../Meta_Poly_tarder
cd ../Meta_Poly_tarder
pip install -e ".[dev]"
```

---

## Environment Variables

### Wealth-OS (`.env.local`)

```bash
# URL of the Meta_Poly_tarder sidecar (server-side fetches)
META_POLY_URL=http://localhost:8000

# Same URL exposed to the browser (WebSocket + client components)
NEXT_PUBLIC_META_POLY_URL=http://localhost:8000

# Required only for the AI Analysis feature
ANTHROPIC_API_KEY=sk-ant-...
```

Copy `.env.local.example` as a starting point:

```bash
cp .env.local.example .env.local
```

### Meta_Poly_tarder

Configure per its own documentation. At minimum you need:

```bash
PAPER_TRADING=true          # Start in paper mode; set false for live orders
POLYMARKET_API_KEY=...      # Polymarket CLOB API key
POLYMARKET_SECRET=...       # Polymarket CLOB API secret
POLYMARKET_PASSPHRASE=...   # Polymarket CLOB API passphrase
```

---

## Starting the Sidecar

```bash
cd ../Meta_Poly_tarder
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

The sidecar exposes:

| Path | Description |
|------|-------------|
| `GET /health` | Service health, paper/live mode, scheduler state |
| `GET /markets` | Active Polymarket markets |
| `GET /signals` | Recent strategy signals |
| `GET /portfolio` | Open positions and stats |
| `GET /settings` | Strategy enable/disable flags |
| `PATCH /settings` | Toggle a strategy flag |
| `POST /paper/close/{market_id}` | Close a paper position manually |
| `WS /ws/live` | Real-time event stream |

Once the sidecar is running, open Wealth-OS and navigate to **Polymarket** in the sidebar. The service status banner will turn green when the WebSocket connects.

---

## Paper vs Live Trading

The sidecar starts in paper mode (`PAPER_TRADING=true`). All positions are simulated; no real orders reach the Polymarket CLOB.

To enable live trading:

1. Follow the instructions in `docs/enabling-live-trading.md` inside the Meta_Poly_tarder repo.
2. Restart the sidecar with `PAPER_TRADING=false`.
3. The Wealth-OS banner will show **LIVE** in amber to indicate real-money mode.

> **Important:** Live trading on Polymarket is not available to US persons per Polymarket's Terms of Service. You will be prompted to acknowledge this the first time you enable a strategy in the UI.

---

## Strategy Toggles

Individual strategies can be enabled or disabled from the **Positions** tab without restarting the sidecar. Each toggle sends a `PATCH /settings` request to the sidecar.

Available strategies:

| Strategy | Key | Description |
|----------|-----|-------------|
| Avellaneda | `avellaneda_enabled` | Market-making via Avellaneda-Stoikov model |
| Entropy | `entropy_enabled` | High-entropy market selection |
| Theta | `theta_enabled` | Time-decay arb on near-expiry markets |
| Ensemble AI | `ensemble_enabled` | Multi-model signal consensus |
| Binance Arb | `binance_arb_enabled` | Cross-venue arbitrage vs Binance futures |

Toggles are optimistic — the UI updates immediately and reverts if the sidecar returns an error.

---

## AI Analysis

The **AI Analysis** button runs `PolymarketIntelligenceAgent`, which:

1. Reads recent vault briefs under `research/polymarket/`.
2. Fetches live context from the sidecar (markets, signals, positions, portfolio stats).
3. Calls Claude (`claude-sonnet-4-6`) with vault tool access to write a new research brief.
4. Returns a structured analysis: summary, opportunities, portfolio assessment, risk warnings, and sentiment.

Requires `ANTHROPIC_API_KEY` in `.env.local`. Vault briefs are written to:

```
research/polymarket/YYYY/MM/YYYY-MM-DD-brief.md
```

---

## Vault Integration

Trade events from the WebSocket are recorded automatically to the Obsidian vault:

| Event | Vault path | Template |
|-------|-----------|----------|
| Trade opened (`trade`) | `decisions/YYYY/MM/YYYY-MM-DD-poly-{id8}-{side}.md` | `renderPolyTradeNote` |
| Position closed (`position_closed`) | `outcomes/YYYY/MM/YYYY-MM-DD-poly-{id8}-outcome.md` | `renderPolyOutcomeNote` |
| Position settled (`position_settled`) | `outcomes/YYYY/MM/YYYY-MM-DD-poly-{id8}-outcome.md` | `renderPolyOutcomeNote` |
| Manual close (UI button) | `outcomes/YYYY/MM/YYYY-MM-DD-poly-{id8}-outcome.md` | `renderOutcomeNote` |

Vault writes are **best-effort** — a failure to write never blocks the trade or close operation. The tab must be open to relay WebSocket events; background recording is not supported in this architecture.

---

## Troubleshooting

### Banner shows "Circuit open"

The circuit breaker trips after 3 consecutive sidecar failures and waits 60 seconds before retrying. Check that the sidecar is running and `META_POLY_URL` is correct, then wait for the countdown to expire.

### Banner shows "Disconnected"

The WebSocket at `/ws/live` could not connect. Check:
- Sidecar is running
- `NEXT_PUBLIC_META_POLY_URL` is reachable from the browser (not just the server)
- No firewall blocking port 8000

### "Sidecar offline" on the Polymarket page

If the sidecar is down at page load, Wealth-OS shows a setup guide with quick-start commands. Start the sidecar and refresh.

### Strategy toggle returns error

The sidecar rejected the `PATCH /settings` request. Check the sidecar logs. The toggle will revert automatically in the UI.

### AI Analysis returns "Analysis failed"

Check that `ANTHROPIC_API_KEY` is set in `.env.local` and that the sidecar is reachable. The `/api/polymarket/analyze` route requires both.
