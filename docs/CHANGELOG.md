# Wealth OS Changelog

## 2026-07-04 — Round-2 audit residues closed

1. **FINAL in-adapter gate**: `BrokerAdapter.execute()` / `placeBracketOrder()`
   are now non-overridable wrappers (master switch → liveReady → capability)
   around protected `doExecute()` / `doPlaceBracketOrder()` — no direct caller
   can reach broker HTTP, ever. `/api/execute-copy-trades` (the last ungated
   path) runs `preExecutionGuard` per trade and records skipped results as
   `pending` with the reason, never faked `open`.
2. **Cost gate always fires on manual paths**: orders / rebalance / sleeves /
   copy-trades pass a conservative 50 bps default edge (`DEFAULT_MANUAL_EDGE`,
   overridable via `expected_return`) so venues whose 2× round-trip cost eats
   the edge are refused (423 + audit).
3. **Regime → capital allocation**: `CIODecisionEngine.decide` consumes the
   allocator's `regime_state` (crisis 0×, risk_off 0.5×, transition 0.75×)
   when the detector supplied no haircut — regime-conditional weighting now
   shapes live sizing, not just the display API.
4. **Provenance at submission**: live executions write their `decision_log`
   row at SUBMISSION and thread `decision_id` into the order intent (grading
   backfill remains as the safety net).
5. **agent_performance_logs is read**: weekly calibration grades per-agent
   committee scores (≥60 approve / ≤40 reject, neutral abstains) against
   closed positions as a second evidence source; `loadAgentWeights` is cached
   (60s TTL) instead of one DB read per decision.
6. (Residue 6 — the scorecard/promotion surface — was already shipped as the
   /paper-trading operator console earlier today.)

## 2026-07-04 — Validation platform upgrade (hardening gaps + operator/wealth dashboards)

**Safety:** legacy `lib/broker-router.ts` retired to a delegation shim — its
own executeVia* implementations are deleted and every manual API route now
goes through the single adapter router (guard token + master switch +
capability + jurisdiction + liveReady). `/api/orders` persists skipped broker
results as `skipped` (migration 20260704d adds the status + corrects
historical rows) and the response says explicitly when no broker order was
placed; `/api/rebalance` reports skipped_orders. `/api/internal/scan-all`
attributes every audit call to its userId so scheduled scans feed the
per-user scorecards. Key-hygiene test is cross-platform (execFileSync, no
shell).

**Paper validation:** `/paper-trading` is a real operator console — safety
gates, runbook checklist with auto-computed items + blockers, expanded
scorecards (every paper-enabled strategy, incl. zero-trade/blocked-only/
missing-data; activity counters, validation status, entry/exit slippage,
material-cost-impact flag), strategy coverage buckets, portfolio synergy
(exposure, clusters, conflicts, drawdown overlap, concentration warnings,
regime notes), run health, and the fill-model assumptions table with the
modeled-not-live disclaimer.

**Wealth management:** Wealth Checkup on /advisor — emergency fund, idle
cash + live cash yields, Roth/HSA/401k prompts, TLH + wash-sale windows,
rebalance suggestions, honest missing-data list; best-next-dollar waterfall
(rules-based, never moves money, paper bankroll always last); every item
carries a data-quality label (completeness, confidence, rate/tax-constant
freshness, requires-CPA-review, informational-only).

## 2026-07-04 — Final Wiring Fixes (W1–W7) + paper-trading hardening

**Hard live-trading gate (W1 + items 1–4):** new
`lib/broker-adapters/execution-guard.ts` — `LIVE_TRADING_ENABLED` master
switch (default OFF), unforgeable WeakSet guard tokens minted only by
`preExecutionGuard` (kill switch → cost gate) and required by BOTH broker
routers (ungated submissions refused), and `checkLiveApproval` (maturity
`live_candidate` AND `live_enabled=true`; `is_enabled` is never a live
signal). `BasePipelineStrategy.checkLiveGate` blocks every real-adapter
execute() path. Manual API routes (orders/rebalance/sleeves-approve) gated
with 423 + audit rows. `selectBroker` returns `no_legal_broker` when neither
primary nor fallback is legal — a US user can never route to Polymarket.
Migration 20260703m: `live_enabled` default false + backfill, `live_approvals`
audit table.

**Honest execution (items 5–8):** placeholder adapters (eToro, Polymarket
bracket, cex-latency-arb) no longer fake `submitted`; `BrokerCapabilities`
declared per adapter (market/limit/bracket/cancel/status/sizing + `liveReady`,
all false in the paper phase) and enforced at the router; unsafe
notional↔quantity conversions blocked per path (OANDA units guess, IBKR
notional/100, Kraken missing volume, Coinbase unprotected bracket, Tastytrade/
Deribit default-1, Kalshi 0.50 price guess); `CIODecisionEngine.decide` now
AWAITS execution and surfaces broker failures on `Decision.execution`.

**Wiring (W2–W7):** adversarial ingest gate wired into the REAL paths
(sync-news-sentiment, sync-quiver-quant, CryptoPanic headlines) with
quarantine; `canIncreaseRisk` gates the sentiment boost (≥2 admitted sources)
· regime allocator connected — `loadRegimeAdjustedWeights` in the weight read
path; ops-watchdog fires the pre-committed crisis playbook and chains it into
the ledger · committee fail-closed — unparseable votes are `defer`, excluded
from the weighted mean; `agent_weights` table + weekly calibration cron
(softmax over graded accuracy, asymmetric clamp, hardcoded fallback)
(migration 20260704a) · relational provenance — `order_intents.decision_id` +
`outcome_log.order_intent_id` FKs populated at write/grade, tape joins
relationally, ids hashed into ledger payloads (migration 20260704b) · honest
halves — full KB §1 wealth-tier ladder (VHNW/UHNW caps, migration 20260704c),
BTC/UUP/hold-NO lifecycle benchmarks, `loadCategoryPrior` in the live sizing
path.

**Validation tooling (items 9–12):** per-strategy paper scorecards
(`lib/actions/paper-scorecard.ts` — expectancy, loss streak, slippage vs
model, blocked/veto counts, maturity recommendation, promotion readiness) ·
deterministic fill model (`lib/paper-trading/fill-model.ts` — spread +
size-dependent impact, partial fills, rejections; assumptions documented) ·
npm audit 11 → 2 moderate (next 16.2.10, @anthropic-ai/sdk 0.110.0; remaining
two live inside next's vendored postcss) · **docs/paper-trading-validation-
runbook.md** — the 2-month protocol, weekly metrics, pass/fail criteria, and
the explicit pre-live checklist. Live trading remains disabled.

## 2026-07-03 — Gap Top Three + Remaining Items (R1–R8)

**Gap Top Three brief:** Item B adversarial defense (typed extraction sandbox,
ingest_quarantine, source admission, canIncreaseRisk assembly gate, 46-case
red-team CI corpus) · Item A point-in-time layer (pit_facts append-only store,
backtester as-of metadata, invisibility CI test) + corpus tooling
(to_parquet/build_views/aggregate.py, wallet_stats/category_bias/
hourly_liquidity aggregates, wallet-copy reads real recertified stats,
Kelly priors from measured category bias, shadow-only fallback) · Item C
block-bootstrap household Monte Carlo (lib/planning, known-answer annuity
tests, PlanningCard with P(goal) + ΔP chips).

**Remaining Items brief:** R2 persisted TIPP floors (sleeve_floors + daily
ratchet cron; sweep reads real state) · R3 TCA surface + measured cost
overrides into the edge gate + Discuss-with-AI + deadline reminders +
provider_options · R1 corpus scripts complete · R7 ops hardening
(reconciliation diff, dead-man switch, key-hygiene CI grep, chaos test) ·
R4 regime allocator (observable-input classifier tested on 2020/2022/2024
fixtures, regime-conditional softmax weights, four crisis playbooks as code)
· R6 auto-retirement funnel (two failing quarters vs passive benchmark →
automatic demotion, pure thresholds) · R5 hash-chained ledger (append-only
+ trigger, nightly verify, /api/ledger/head, tamper tests) · R8
personalization (behavior events, honest behavior-gap report, bounded
monotonic guardrail strictness).

**R0 (user action):** the 107GB Polymarket corpus bulk load runs on your
machine/VPS — runbook in scripts/poly-corpus/README.md.

**New migrations:** 20260703e (quarantine/source_scores), f (pit_facts),
g (corpus aggregates), h (sleeve_floors), i (cost_overrides/provider_options),
j (regime_state), k (ledger_entries), l (user_behavior_events) — plus re-run
20260703c for the new kb_parameters.

## 2026-07-03 — Advisory Module + Sweep Engine + UI upgrade (first pass)

### Advisory Module (`9f79fbd`)
`tax_constants` (year-keyed, source-URL'd — no limit ever hardcoded; 2026
seed verified against IRS Notice 25-67/Pub 15), `kb_parameters` (KB §9),
`financial_profile`, `advisory_log`. Seven rules (S-corp with honest corrected
math, Roth/backdoor gated on pro-rata, emergency fund with live yields, HSA,
deductions checklist, Solo 401(k) with S-corp interaction, banking hygiene).
ESLint forbids numeric literals in rule files. Staleness job wired into cron
(`task=advisory-staleness`). 29 table-driven tests.

### Sweep Engine (`ee4f055`)
KB §5–6 as pure functions: Merton share, Thorp drawdown-constrained Kelly,
TIPP ratcheting floor, vol brake, Daryanani bands, deferral hurdle; all nine
sweep triggers in order with sleeve claiming; tax-aware funding order (STCG
only when forced); waterfall destination routing; sleeve refill gate. 25 tests.

### UI upgrade — priority widgets (`aa973dc`)
Risk Strip on every page (PAPER badge, kill-switch state, DD/daily-loss vs
limits, exposure chips) + global Flatten & Halt with impact-summary confirm
(integration-tested against the kill switch) + advisory cards on /advisor
(ranked, show-the-math, status lifecycle, disclaimer+CPA CTA, live yields) +
underwater drawdown shading on the equity hero + Trade Tape with per-fill
reasoning provenance.

### Follow-ups queued (UI brief remainder + Gap Analysis)
Advisor/Terminal density mode toggle (user-prefs persisted) · full 13-agent
debate transcript panel · strategy leaderboard metric columns
(CAGR/Sortino/Calmar/SQN) · calibration reliability diagram · Polymarket
model-vs-market fair-value chart · Gap Analysis top picks (point-in-time DB +
Polymarket corpus, adversarial-input defense, household Monte Carlo).

### New migration (apply in Supabase SQL Editor)
- `20260703c_advisory_module.sql` — tax_constants + kb_parameters (seeded),
  financial_profile, advisory_log


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
