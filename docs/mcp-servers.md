# MCP Servers — Wealth OS Integration Reference

## Active servers

| MCP | Purpose | Status | Required env vars | Strategies that use it |
|---|---|---|---|---|
| `ccxt-mcp` | Multi-exchange read-only data: tickers, order books, OHLCV, funding rates | **Active** | none (public endpoints) | `funding_basis_arb`, `funding_basis_arb_hyperliquid`, `liquidation_hunting` |
| `cryptopanic-mcp` | Crypto news feed + narrative heat scoring | **Active** | `CRYPTOPANIC_API_KEY` | `narrative_rotation` |

## Gated servers (disabled until strategy stub is filled in)

| MCP | Purpose | Status | Activate when | Required env vars |
|---|---|---|---|---|
| `aave-mcp` | Aave protocol reserve data: supply/borrow APY, utilization | **Disabled** | `defi_yield_stack` or `pendle_pt_fixed_yield` is implemented | none |
| `uniswap-poolspy-mcp` | Newly created Uniswap pools by chain + liquidity | **Disabled** | `memecoin_bondingcurve` is implemented | none |

## R&D / developer tools

| MCP | Purpose | Status | Notes |
|---|---|---|---|
| `tradingview-mcp` | Pine Script engine for cross-validating `lib/indicators/` logic | **Disabled** (opt-in) | See `docs/tradingview-mcp-workflow.md` |

---

## Activating a gated server

1. Open `.mcp.json`
2. Find the server entry and set `"disabled": false`
3. Restart Claude Code (`/reload`)
4. Implement the strategy that uses it (the TODO block in the stub shows the API)
5. Re-disable in `.mcp.json` before committing if the strategy isn't production-ready

---

## Why we don't allow write-capable crypto MCPs in production

All trade execution flows through `lib/broker-adapters/` with bracket orders,
position-monitor coverage, and Supabase audit logging. Letting an MCP hold
signing keys or send transactions bypasses our risk controls.

**Read-only MCPs are fine. Write-capable ones are not.**

The following packages are explicitly **NOT wired** and must never be added to `.mcp.json`:

| Package | Why blocked |
|---|---|
| `uniswap-trader-mcp` | Can execute Uniswap swaps — bypasses broker-adapter audit trail |
| `mcp-cryptowallet-evm` | Holds private key, can sign and broadcast arbitrary transactions |

If a new write-capable MCP is proposed, it must go through the risk-controls review
in `lib/broker-adapters/` before being considered.

---

## Integration module locations

```
lib/integrations/
  ccxt/               mcp-config.ts — ALLOWED_TOOLS guard, buildClient()
  cryptopanic/        mcp-config.ts — narrativeHeatScore(), topMovers(), 60s cache
  aave/               mcp-config.ts — getReserveData() (throws until enabled)
  uniswap-poolspy/    mcp-config.ts — getNewPools() (throws until enabled)
```
