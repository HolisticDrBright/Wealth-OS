# Paper-Trading Validation Runbook

**Status: LIVE TRADING IS DISABLED.** `LIVE_TRADING_ENABLED` is unset
(default off) and every broker adapter is `liveReady: false`. This runbook
governs the two-month paper validation phase and defines exactly what must be
true before that changes. Do not shortcut it.

---

## 1. What the validation phase is

Run the full pipeline — scanners → confluence → CIO committee → risk gates →
PaperBroker fills → learning loop — for **a minimum of 2 calendar months**
against live market data with **zero real orders**. The output is the
per-strategy evidence pack (`getPaperScorecards()`), not P&L bragging rights.

### The safety stack that keeps this paper-only

| Layer | Where | What it does |
|---|---|---|
| Master switch | `LIVE_TRADING_ENABLED` env (unset = off) | Both broker routers return `skipped` before any adapter runs, even with API keys in env |
| Guard tokens | `lib/broker-adapters/execution-guard.ts` | Routers refuse any `submitOrder` without a token minted by `preExecutionGuard` (kill switch → cost gate); tokens are unforgeable (module-private WeakSet, 60s TTL) |
| Live approval | `checkLiveApproval` | Requires registry maturity `live_candidate` AND `user_enabled_strategies.live_enabled = true`. `is_enabled` is never a live signal. No strategy in the registry is `live_candidate` today |
| Capability gate | `BrokerCapabilities.liveReady` | Live routing refuses any adapter not verified against the broker's sandbox — all are `false` |
| Jurisdiction | `selectBroker` / `blockedJurisdictions` | US users can never route to Polymarket/eToro; no legal broker → no broker, with a reason |

## 2. Weekly review (every Monday)

Open **/paper-trading** — the operator dashboard renders this runbook as a
live checklist (auto-computed where the data allows), the full scorecards,
coverage, synergy, and run health. Record, per strategy, in a dated log:

1. Closed-trade count (cumulative and week-over-week)
2. Win rate and net expectancy (after modeled spread + impact)
3. Average win / average loss and the ratio
4. Max drawdown on the compounded per-trade curve
5. Longest loss streak
6. Recorded slippage bps vs the fill-model assumption
   (`lib/paper-trading/fill-model.ts` — spread + linear impact, partial fills
   above the depth cap, deterministic rejection above the cost threshold)
7. Skipped / blocked counts and risk-veto counts (a strategy that only looks
   good because vetoes removed its losers is not good)
8. Rolling Brier score from the learning loop
9. Shadow comparison: rejected trades must not outperform accepted ones
10. The threshold-derived maturity recommendation (`recommendMaturity`)

Also check the ops surface: dead-worker alerts, ledger verification result,
regime state, and the ingest quarantine count.

## 3. Pass/fail criteria (per strategy, end of phase)

A strategy **passes** the paper phase only when ALL of the following hold —
these are the same gates `evaluatePaperToLive` enforces:

- ≥ 30 closed paper trades
- Positive net expectancy after the venue's round-trip cost
- Rolling Brier < 0.22
- Max drawdown ≤ 15%
- Shadow check: rejected trades do not beat accepted trades by > 1%/trade
- No unexplained divergence between recorded fills and the fill model

A strategy **fails** (stays in paper or is demoted by the weekly lifecycle
review) when it trails its passive benchmark (SPY / BTC / UUP / hold-NO) for
two consecutive complete quarters, or shows negative expectancy at ≥ 30
trades.

**The system as a whole passes** only when, additionally:

- The full test suite and build are green
- The hash-chained ledger verifies end-to-end every night
- No safety gate produced a false negative during the phase (audited blocks
  were all justified)
- The kill switch, sleeve halts, and TIPP floors each fired correctly at
  least once (naturally or via drill)

## 4. What must be true BEFORE enabling live trading

Every item, in order — none are optional:

1. **Two full months** of paper validation completed with the weekly logs.
2. At least one strategy passes every gate in §3 and is promoted to
   `live_candidate` in the registry **by a deliberate code change** (reviewed
   PR, not a config flip).
3. `user_enabled_strategies.live_enabled = true` set for that strategy for
   the specific user — an explicit, logged action (`live_approvals` audit
   table).
4. **Broker sandbox verification**: the target adapter tested against the
   broker's real sandbox/paper environment (Alpaca paper API, OANDA
   fxpractice, Coinbase sandbox) — order placement, cancellation, status,
   and reconciliation — then `liveReady: true` set for THAT adapter only, in
   a reviewed PR. This has NOT been done for any adapter.
5. Notional/quantity sizing verified against the sandbox for the exact
   instruments to be traded (the unsafe conversions were removed; the
   adapter must receive correct explicit quantities).
6. The OCO reconciler and position monitor proven against sandbox fills.
7. Risk parameters reviewed: kill-switch drawdown limit, daily loss limit,
   sleeve caps, TIPP floors, per-strategy size caps.
8. Only then: set `LIVE_TRADING_ENABLED=true` in the deployment environment,
   with a small hard notional cap for the first live week.

## 5. Keeping live trading disabled (and proving it)

- Never set `LIVE_TRADING_ENABLED` in any environment during the phase.
- `__tests__/safety/live-trading-gates.spec.ts` proves paper/backtest/stub
  strategies cannot reach adapters even with env keys present, that ungated
  submissions are refused, and that no registry strategy is `live_candidate`.
  Keep it green; treat any red as an incident.
- `__tests__/safety/broker-capabilities.spec.ts` sweeps every adapter for
  `liveReady: false` — flipping one without sandbox evidence fails CI.
- The database default for `live_enabled` is `false` and all rows were
  backfilled false (migration `20260703m`).

## 6. Known modeling assumptions (be honest about them)

- Paper fills use conservative modeled spread + linear impact with
  deterministic partial fills and rejections
  (`lib/paper-trading/fill-model.ts`). Real books are messier; live sizing
  must start far below paper sizing.
- Exit fills use a flat per-class slippage estimate (symmetric with entry).
- Polymarket grading is excluded from the Yahoo-based learning horizon; its
  strategies validate against resolution outcomes.
- The hold-NO benchmark assumes fair-priced binaries (0% expected return).

## 7. Deferred until pre-live

- Plaid (real account aggregation) — not needed for paper validation.
- Live Treasury / yield feeds beyond the current fetchers.
- Real broker sandbox testing (§4.4) — the explicit pre-live milestone.
- Per-broker live reconciliation snapshots (ops-watchdog reports honestly
  that it skips reconciliation in paper mode).
