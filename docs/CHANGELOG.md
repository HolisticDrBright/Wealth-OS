# Wealth OS Changelog

## 2026-07-03 — Phase 0 + Backtester (safety wiring)

Implements the full *Phase 0 + Backtester Implementation Brief* (7 items, one
commit each). Theme: the safety-critical pieces existed but weren't wired into
the execution path. All strategies remain in **paper mode**; no promotion-gate
criteria were weakened.

### Item 1 — Runtime kill switch (`d2d7b0c`)
`lib/risk/kill-switch.ts` + `system_flags` migration. Every order now passes
`preTradeRiskCheck()` before reaching a broker: portfolio drawdown from
high-water mark vs `max_drawdown_pct`, daily realized loss vs
`daily_loss_limit_usd`, sleeve `halted` flags, and a global/per-user
`trading_halted` flag (the "Flatten & Halt" hook). Fails CLOSED when state is
unreadable. Wired into both execution paths and all three strategy-level
`execute()` overrides; blocked trades are written to `audit_logs`.

### Item 2 — Cost gate on every entry (`8428744`)
`edgeClearsCosts()` (gross edge ≥ 2× venue round trip) is now enforced at
`CIODecisionEngine.decide()` Gate 0 (so `runRedTeam` overrides can't bypass
it), in `BasePipelineStrategy.runRedTeam`, and in orchestrator stage 5.
Rejections log `edge_below_cost_floor` with gross/cost/net bps and are hard
blocks — never `reduce_size`.

### Item 3 — Empirical Kelly everywhere (`a126e89`)
`lib/risk/empirical-sizing.ts` is the single sizing path. Win probability
comes from rolling calibration (last 20 graded outcomes); with no history a
fixed maturity-floor probe applies (2% × maturity haircut) — **never signal
strength**. `getPortfolioUsd()` returns null on failure and every sizer
REFUSES to size (0 + audit log) — never a $10k default. Stub/retired
strategies are blocked outright. Quarter-Kelly scaling and the 10% cap kept.

### Item 4 — Idempotent orders + OCO reconciliation (`4cac9c0`)
`client_order_id = wos-sha256(opportunityId:leg)[0:20]` — deterministic, so
retries and concurrent workers dedupe broker-side. New `order_intents` table
records every leg; bounded retry (3 attempts) reuses the same id and treats
"duplicate order id" as success. The position monitor reconciles each sweep:
entry fills verify both bracket legs, stop/TP fills cancel the recorded
sibling, partial fills resize legs to the filled quantity.

### Item 5 — Funding-rate sign fixes (`c69b639`)
Carry is collected on BOTH funding signs now: expected returns use |funding|
with direction carried separately; the pipeline impl fetches the REAL perp
mark price (Deribit → Binance) instead of fabricating it from the funding
rate (which made its basis check circular); execution legs flip with the
carry side; exits fire when funding flips against the entry side.

### Item 6 — Small correctness batch (`1526611`)
Cron auth fails closed without `CRON_SECRET`; PositionMonitor refuses the
anon-key fallback; flat-series stddev guards; London 4pm fix runs on
Europe/London wall clock (DST-correct) with tz-aware month-end; VCP ATR gets
period+1 bars; 52-week breakout needs 252 bars; congressional high-alpha
filter uses normalized full-name matching and applies to UW trades; wallet
copy respects its symbol argument and derives the wallet's actual win rate.

### Item 7 — Backtester rewire (`d9c5558`)
`runBacktest` resolves `job.strategy_id` and calls that strategy's
`generateSignal()` per bar step. Bars sorted per symbol, history truncated by
DATE, `assertNoLookahead()` throws on any future bar. Fills at the NEXT bar's
open with per-venue costs. Walk-forward fits `paramGrid()` parameters on train
windows and applies them unseen to test windows (plain OOS splits when a
strategy has no tunables) — the robustness ≥ 0.5 gate finally measures
generalization.

### ⚠️ Operational note
Sizing and cost gating changed materially. **Reset paper-trading track
records** — pre-fix paper history is not comparable evidence for promotion
gates.

### New migrations (apply in Supabase SQL Editor)
- `20260703a_system_flags.sql` — kill-switch flags
- `20260703b_order_intents.sql` — idempotent order legs
