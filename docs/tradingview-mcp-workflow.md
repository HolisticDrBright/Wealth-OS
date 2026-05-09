# TradingView MCP — Indicator R&D Workflow

> **Opt-in only.** This tool is disabled by default in `.mcp.json`. Enable it locally during indicator development; never commit with `"disabled": false`.

## What it does

The `tradingview-mcp` server exposes TradingView's Pine Script engine and chart data to Claude Code. During an R&D session you can:

- Pull OHLCV bars for any symbol/timeframe directly in the conversation
- Run a Pine Script indicator and get its output values back as JSON
- Cross-validate `lib/indicators/` TypeScript logic against TradingView's canonical implementation

## Enable locally

```jsonc
// .mcp.json — local change only, do NOT commit
{
  "mcpServers": {
    "tradingview-mcp": {
      "command": "npx",
      "args": ["-y", "tradingview-mcp"],
      "disabled": false   // ← flip this
    }
  }
}
```

Then restart Claude Code (`/reload` or reopen the project).

## Typical session

1. **Pull bars** — ask Claude to fetch e.g. `AAPL` daily bars for the last 90 days via the MCP tool.
2. **Run indicator** — paste a Pine Script snippet; MCP returns output series.
3. **Compare** — copy the numeric output into a vitest fixture and assert your TypeScript function matches.
4. **Commit the test, not the MCP data** — fixture values go in `lib/indicators/__tests__/`; the MCP session is ephemeral.

## Indicator files this supports

| File | Pine equivalent |
|---|---|
| `lib/indicators/rsi-divergence.ts` | Built-in RSI + manual divergence scan |
| `lib/indicators/volume-spike.ts` | `volume > ta.sma(volume, 20) * 3` |
| `lib/indicators/trend-health-score.ts` | EMA200, EMA50 slope, ADX |
| `lib/indicators/support-resistance.ts` | Pivot highs/lows + clustering |

## Production note

`tradingview-mcp` is never imported by application code. It is a developer tool only, similar to Fincept Terminal (see README). It adds zero bytes to the production bundle.
