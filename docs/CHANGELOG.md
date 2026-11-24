# Wealth OS Changelog

## 2026-11-24 — Roadmap #1: best next dollar on Home (+ #6 raise prompt)

- **Home card, web and phone** (`NextDollarCard`): "Your best next dollar"
  on Simple Home and the phone Home. It shows ONE thing: the highest-ranked
  question still unanswered, or the recommendation once we know enough. It
  walks the existing waterfall in order (`lib/advisory/next-dollar-card.ts`).
  `rankNextDollar`'s `bestNext` alone skips steps with missing data, so a blank
  profile was told to "invest in taxable"; the card asks about essentials
  first and never jumps past an unknown higher step.
- **One question at a time, plain English**: monthly essentials, employer
  match, debt above 6%, health plan, household income, filing status, IRA
  and 401(k) contributions so far this year. Answers are saved where they
  already live (`financial_profile`, `employer_benefits`, `debt_accounts`).
  "Not sure" moves on and is listed later ("we couldn't check …"). Steps that
  need tax limits we don't have are skipped and said so, instead of asking
  the person something they can't fix.
- **One emergency-fund definition**: the waterfall and the `/advisor`
  checkup now use the ladder's Tier 1 Safety (6 months of essentials + goals
  due within 2 years, against cash-like holdings). The old one
  (`liquid_cash_usd` vs expenses × kb months, 3 by default) is retired, as are
  the checkup's "idle cash above target" math on it. Shared mapper:
  `lib/advisory/next-dollar-inputs.ts`.
- **More honest inputs**: no debt rows now means "unknown" unless the person
  says "none" (it used to read as no debt only when a row existed). IRA room
  needs this year's contributions (it used to assume $0).
- **Raise prompt (#6)**: when reported household income rises at least
  `RAISE_MIN_INCREASE`, suggest adding `RAISE_SAVE_SHARE` of the after-tax raise
  (`RAISE_TAKE_HOME_FRACTION` of gross) to the primary goal's monthly deposit,
  rounded to `DEPOSIT_ROUND_USD`. Example: $80k → $90k suggests +$290/month.
  "Raise my deposit" updates the goal; "Not now" just acknowledges. Either way
  the prompt waits for the next raise. "Income changed? Update it" is on the card.
- Phone: `POST /api/mobile/next-dollar` (answer / skip / income / raise),
  bearer-authenticated; the card comes with `GET /api/mobile/home`.
- **Pre-existing bug fixed**: `getDebtAccounts` ordered by `created_at`, which
  `debt_accounts` doesn't have, so the read failed and no debt ever reached the
  checkup. It now orders by `updated_at`.

Nothing in this feature trades or touches positions (tested).

**New constants**: `RAISE_MIN_INCREASE` 0.03, `RAISE_TAKE_HOME_FRACTION` 0.70,
`RAISE_SAVE_SHARE` 0.50, `DEPOSIT_ROUND_USD` 5.

**New migration**: `20260704o_next_dollar.sql` — `next_dollar_state` (owner
RLS): "no high-interest debt" confirmation, skipped questions, income baseline.

**Not verifiable here**: current-year `tax_constants` rows (without them the
HSA / Roth / 401(k) steps show as "couldn't check"); the screens weren't
viewed against a live database.

## 2026-11-24 — Wealth-manager allocation: summary (Phases 1–6)

Paper mode throughout. No live trading enabled, no strategy promoted, no
maturity status changed, no strategy signal logic changed. Every new control
only shrinks or blocks a trade relative to before.

### New migrations (all RLS)
| Migration | Phase | What |
|---|---|---|
| `20260704l_ladder.sql` | 2 | `ladder_state` (owner RLS); `setup_ladder` approval kind |
| `20260704m_core_positions.sql` | 3 | exit_reason CHECK widened (`manual_flatten`, `rebalance`); `(user_id, strategy_key, status)` index; `paper_deposits` (owner RLS); `core_rebalance` + `deposit` approval kinds; user INSERT policy on `paper_trades` for `'core'`/`'safety'` rows only |
| `20260704n_scan_heartbeats.sql` | 6 | `scan_heartbeats` (users read system + own rows, write only their own unscheduled runs; service role all); creates the missing `worker_heartbeats` |

### Every constant (`lib/config/product-defaults.ts`; each is a changeable product default)
| Constant | Default |
|---|---|
| `CORE_FUNDS` | usStocks VTI, intlStocks VXUS, bonds BND, cashLike SGOV |
| `US_SHARE_OF_STOCKS` | 0.70 |
| `PROFILE_MIX` (stocks/bonds/cash) | vault .20/.60/.20, conservative .40/.50/.10, balanced .60/.35/.05, growth .80/.18/.02, speculative .90/.08/.02 |
| `DEFAULT_PROFILE_KEY` | 'balanced' |
| `EMERGENCY_FUND_MONTHS` | 6 |
| `SHORT_HORIZON_YEARS` | 2 |
| `CASH_LIKE_CATEGORIES` | ['cash'] |
| `LADDER_EXCLUDED_CATEGORIES` | ['real_estate'] |
| `GLIDE_FULL_HORIZON_YEARS` | 10 |
| `GLIDE_SHORT_FRACTION` | 0.25 |
| `PROFILE_TILT_MAX` | 0.15 |
| `GLIDE_REFERENCE_PROFILE` | 'balanced' |
| `CORE_DRIFT_THRESHOLD` | 0.05 |
| `CORE_MIN_TRADE_USD` | 10 |
| `DEFAULT_EXPLORE_CAP_FRACTION` | 0.10 |
| `EXPLORE_CAP_HARD_MAX_FRACTION` | 0.25 |
| `VOL_MIN_OBSERVATIONS` | 20 |
| `VOL_LOOKBACK_DAYS` | 90 |
| `DEFAULT_ANNUAL_VOL` | stocks 0.40, options 1.00, crypto 0.90, forex 0.15, multi-asset 0.40 |
| `VOL_FLOOR_ANNUAL` | 0.05 |
| `EXPLORE_RISK_REFERENCE_VOL` | 0.20 |
| `MAX_POSITION_RISK_SHARE` | 0.20 |
| `SPECULATIVE_BOOK_CAP` | 0.10 |
| `SPECULATIVE_REGIME_MULTIPLIER` | RISK_ON 0.5, NEUTRAL 0.5, RISK_OFF 0, CRISIS 0 |
| `SCAN_STALE_HOURS` | 6 |
| `MARKET_TIMEZONE` | 'America/New_York' |
| `MARKET_OPEN_MINUTES` / `MARKET_CLOSE_MINUTES` | 570 (9:30) / 960 (16:00) |
| `SCAN_GAP_LOOKBACK_DAYS` | 90 |

The promotion minimum of 30 closed trades is the existing
`MIN_CLOSED_TRADES` in `lib/strategies/promotion-gates.ts` (now exported, value
unchanged).

### Not verifiable without live Supabase credentials (or the live network)
1. That migrations l, m and n (and earlier 20260703c `financial_profile`, j, k)
   are applied. Until they are, the ladder reads "needs expenses" (Explore
   stays $0), deposits and heartbeats fail softly, and the readiness page says
   heartbeats are unavailable.
2. The constraint names `paper_positions_exit_reason_check` and
   `automation_approvals_kind_check` are Postgres's default names. If the remote
   names differ, the old CHECK survives and pauses still can't close positions
   (`closeAt` then falls back to `'manual'` and reports it).
3. User-session RLS for the new writes: Core/Safety inserts and updates on
   `paper_positions`, the new `paper_trades` insert policy, `paper_deposits`,
   `scan_heartbeats` reads of system rows.
4. The `alerts` table's live shape. The base schema has `type` CHECK without
   `'ops'` and `body` (not `message`); existing `sendOpsAlert`, advisory-staleness
   and behavior-gap inserts use `'ops'`/`message` and may be failing today
   (pre-existing). The new stale-scan alert uses the base shape (`'system'`,
   `body`, `action_url`, `metadata`).
5. `worker_heartbeats` may already exist remotely in another shape; the
   migration only creates it if missing.
6. Market data at run time: Yahoo daily closes (realized vol), BND/S&P monthly
   series (bad-year), SGOV/VTI/VXUS/BND prices for fund trades. In this sandbox
   all fall back (default vols; bad-year hidden; fund trades report "no price").
7. Whether the GitHub Actions scheduler is running (`WEALTH_OS_API_KEY`,
   `NEXT_PUBLIC_SITE_URL` secrets). After deploy the stale banner shows during
   market hours until the first scheduled scan records a heartbeat (≤ 15 min if
   healthy).
8. The real effect on burn-in of the correlation caps now binding (Phase 3 fix)
   and the per-position risk ceiling (Phase 4).

### Phase 5 questionable strategies (nothing moved; owner decisions)
Full table with reasoning: `docs/strategy-book-review.md`.
| Strategy | Book now | Suggested | One-line reason |
|---|---|---|---|
| `vix_term_structure` | convexity | carry | **Sells** SPX put spreads (short vol) in the one book open in CRISIS (backtest_ready, can't trade yet) |
| `factor_crowded_trade_fade` | convexity | event | Stub; the brief's "convexity keeps only…" conflicts with "move nothing else", so it was left in place |
| `onchain_signal` | trend | event / speculative | Buys BTC/ETH below the 30-day SMA (counter-trend) |
| `dca_halving` | trend | speculative | Dip-buying crypto beta, not momentum |
| `narrative_rotation` | trend | speculative | 24h alt-coin momentum, similar to memecoins |
| `london_4pm_fix_endmonth` | arb | event | Directional month-end flow trade |
| `month_end_fix` | arb | event | Directional USD fade on the fix; same exposure as above |
| `correlation_divergence` | arb | event | Statistical convergence with tail risk, not structural arb |
| `cex_latency_arb` | arb | arb (review) | Latency edge a polled paper sim can't validate |
| `polymarket_wallet_copy` | info | event / copy | Follows others' flow; no information edge of its own |
| `defi_yield` | carry | speculative | Principal-loss tail (hacks, depegs) on 12%+ "stable" yields |
| `dividend_aristocrat` | carry | trend / retire | Long equity beta that duplicates Core |
| `qvm_multifactor` | trend | event / factor | Mostly value/quality, not momentum |
| `liquidation_hunting` | event (+convexity) | speculative | Fast, leveraged cascade trades |

### Flagged for the owner (from earlier phases)
- The sweep engine's kb_parameters sleeve caps (5% under $100k, 10% from $100k
  to $5M, 15%, 20%) disagree with the flat 10% Explore cap. They only drive
  alerts. Unchanged, decision pending.

## 2026-11-24 — Wealth-manager allocation, Phase 6: protect the track record

- **Scan heartbeat** (`lib/ops/scan-heartbeat.ts`, table `scan_heartbeats`):
  every scan run writes a row at start (`running`) and finish (`ok`/`failed`
  with counts or the error): scheduled `scan-all` (GitHub Actions / VPS
  timer), the daily cron's paper pass, and manual "Run now" (recorded as
  unscheduled, so it never makes the scheduler look healthy). A heartbeat that
  can't be written never changes the scan itself.
- **Stale = market hours AND no successful scheduled scan in
  `SCAN_STALE_HOURS`** (US equities clock, DST-aware; holidays not modeled, which is the
  strict side). When stale: a banner on every authenticated web page (Simple
  and Pro wording) and on the phone Home, plus one `alerts` row per stale
  episode per user. A failed `scan-all` while stale also goes to the ops
  channel.
- **Promotion readiness page** (`/strategies/readiness`, Pro mode, sidebar ›
  Strategies › Readiness): READ-ONLY. Every registered strategy (all 62, any
  maturity) with maturity, closed paper trades vs 30, net result after costs
  (realized P&L minus the gate's round-trip cost model, shown as gross − costs),
  max drawdown, each promotion gate's pass/fail, and scan gaps since the
  strategy's first trade. No promote button, form or write path (tested).
- **Gap flags**: a gap is any past stretch between successful scheduled scans
  during which the stale banner would have shown. Listed with dates on the
  readiness page (last `SCAN_GAP_LOOKBACK_DAYS` days) and counted per strategy.
- Drawdown math moved to `lib/strategies/track-record.ts` (shared with the
  Strategy Health Board's pipeline, unchanged behavior).
- Small Phase 3 follow-up: the correlation-cap book now normalizes copied
  positions' asset class (`'stock'` → `'stocks'`) so copies count toward the
  asset-class cap (only tightens).

**Pre-existing gap fixed**: `worker_heartbeats`, read by the ops watchdog's
dead-man switch and written by the position monitor, had no migration, so the
dead-man switch could never fire. Migration n creates it if missing.

**New constants**: `SCAN_STALE_HOURS` 6, `MARKET_TIMEZONE` 'America/New_York',
`MARKET_OPEN_MINUTES` 570, `MARKET_CLOSE_MINUTES` 960, `SCAN_GAP_LOOKBACK_DAYS` 90.

**New migration**: `20260704n_scan_heartbeats.sql`.

## 2026-11-24 — Wealth-manager allocation, Phase 5: book labels

- **New `speculative` book** (`lib/strategies/strategy-books.ts`): cap
  `SPECULATIVE_BOOK_CAP` (0.10) on both dollar and risk-unit share; regime
  multipliers `SPECULATIVE_REGIME_MULTIPLIER` (owner decision: RISK_ON 0.5,
  NEUTRAL 0.5, RISK_OFF 0, CRISIS 0). Added to `BOOK_META`, every regime
  table, `ALL_BOOKS`, the Risk Room and Strategy Health Board panels.
- **Moves (exactly six)**: `memecoin_bondingcurve` (trend), `airdrop_farming`
  (carry) and `polymarket_crypto_binary_5min` (info) to **speculative**;
  `liquidation_hunting`, `gamma_exposure` and `jpy_intervention_fade`
  (convexity) to **event**. Nothing else moved (tested against the full
  pre-Phase-5 map). No maturity status changed.
- **Dual counting** (owner decision): a moved strategy counts against BOTH its
  new and its old book (`ALSO_COUNTS_AGAINST`, `booksFor`). Its exposure is
  added to both books, counted once in totals, and a new position must fit
  both books' caps (dollars and risk) and regime multipliers. The smaller
  allowed size wins, so moving can only tighten limits (property-tested).
  Example: the three ex-convexity strategies are now closed in CRISIS.
- **Convexity** now holds only `tail_risk_hedging` and `vix_term_structure`
  among strategies that can trade. **Conflict flagged:** the stub
  `factor_crowded_trade_fade` is also in convexity; the brief says both
  "convexity keeps only…" and "don't move anything else". Left in place (it
  never executes) for the owner to decide.
- **Questionable strategies table**: `docs/strategy-book-review.md` (14 rows,
  nothing moved). Top item: `vix_term_structure` *sells* SPX put spreads (short
  vol, i.e. carry), yet sits in convexity, the one book open in CRISIS. It's
  `backtest_ready`, so it can't trade today.

**New constants**: `SPECULATIVE_BOOK_CAP` 0.10, `SPECULATIVE_REGIME_MULTIPLIER`
{RISK_ON 0.5, NEUTRAL 0.5, RISK_OFF 0, CRISIS 0}.

**No new migration.**

## 2026-11-24 — Wealth-manager allocation, Phase 4: risk units

The strategy slice is now budgeted by RISK as well as dollars. Every new rule
is an additional gate — the smaller allowed size wins, nothing can grow.

- **Risk units** (`lib/risk/risk-units.ts`): notional × annualized volatility.
  Volatility is the instrument's realized volatility from daily closes
  (`VOL_LOOKBACK_DAYS` of history) when at least `VOL_MIN_OBSERVATIONS` daily
  returns exist, floored at `VOL_FLOOR_ANNUAL`; otherwise the conservative
  per-asset-class default `DEFAULT_ANNUAL_VOL`. Binary prediction markets use
  the stake as maximum loss (risk units = stake). Options always use the
  default (an option can lose its whole premium). Unknown → treated as risky
  as a binary.
- **Book caps on risk share** (`gateThroughBook`): each book's existing cap
  now also applies to its share of open risk units; the gate takes the
  smaller of the dollar and risk room. Without risk inputs it behaves exactly
  as before (tested); with them it never allows more (property-tested over
  1,000 random books × regimes). `computeBookExposures` returns risk per book.
- **Per-position ceiling** (owner decision: measured against the Explore risk
  budget): Explore risk budget = Explore cap dollars ×
  `EXPLORE_RISK_REFERENCE_VOL`; one position may use at most
  `MAX_POSITION_RISK_SHARE` of it. Applied in the paper runner (after the book
  gate, before the Explore cap and the fill) and in the copy-trade executor
  (before the copy is recorded or sent). When Explore's cap is $0 (Tier 1
  short) the Explore gate still blocks and logs as before.
- **Pro-mode Risk Room** (`/risk`) and the Strategy Health Board's book panel
  show each book's dollar share next to its risk share, the total risk units,
  the Explore risk budget and the per-position ceiling.

**Burn-in impact**: strategy positions get smaller. With a $9,600 Explore cap
the ceiling is 384 risk units — about $960 of a stock at the 40% default vol,
$427 of crypto at 90%, a $384 prediction-market stake.

**New constants**: `VOL_MIN_OBSERVATIONS` 20, `VOL_LOOKBACK_DAYS` 90,
`DEFAULT_ANNUAL_VOL` {stocks 0.40, options 1.00, crypto 0.90, forex 0.15,
multi-asset 0.40}, `VOL_FLOOR_ANNUAL` 0.05, `EXPLORE_RISK_REFERENCE_VOL` 0.20,
`MAX_POSITION_RISK_SHARE` 0.20.

**No new migration.**

**Not verifiable here**: realized volatility needs Yahoo daily history at run
time; in this sandbox (and on any fetch failure) every symbol falls back to the
conservative default, which is the stricter side.

## 2026-11-24 — Wealth-manager allocation, Phase 3: Core is real (paper)

Core and Tier 1 Safety are now actual paper fund positions, distinguishable
everywhere from strategy (Explore) positions.

- **Tagging** (`lib/allocation/sleeves.ts`): Core / Safety rows are ordinary
  `paper_positions` rows with the RESERVED `strategy_key` `'core'` / `'safety'`
  (no new column, so strategy queries can never fail open against a
  database that lacks the migration). Every strategy-level reader — learning,
  scorecards, promotion readiness, lifecycle, equity curve, exits, position
  monitor, kill switch, book exposure, correlation caps, Explore in-use, the
  risk strip's halt impact, cron fan-outs — now excludes them; account-level
  totals include them. Fund rows also carry a no-exit seatbelt
  (`LADDER_NO_EXIT`: 100% stop, unreachable target, ~228,000-year hold).
- **One-tap setup now trades** (`approveLadderSetup`): after the approval is
  recorded it buys SGOV for the Tier 1 shortfall (grossed up for the purchase
  cost so Safety lands full, never below `CORE_MIN_TRADE_USD`), then — only if
  Tier 1 will be full — each Core fund up to target, furthest below target
  first. Any Phase 2 designation is converted into a real SGOV position.
- **No double counting** (`computeLadder`): fund purchases are paid with the
  person's recorded money, so recorded cash (and any designation) counts toward
  Tier 1 only while it is still "unplaced". Core's target now uses the FULL
  Tier 1 target, so a short Tier 1 can't inflate it. The setup can only spend
  free money plus recorded cash beyond the Tier 1 target — never the
  cash-like fund itself.
- **Deposits** (`depositFunds`, web "Add money" on /advisor, phone "Add money"
  on Goals, `POST /api/mobile/deposit`): recorded in `paper_deposits`, then
  Tier 1 first, then Core (largest dollar gap first, leftovers by weight).
  Deposits never touch strategy equity.
- **Core drift** (`coreDrift`): when Core's stock share is more than
  `CORE_DRIFT_THRESHOLD` (5 points) from its glide-path target, a "Rebalance
  your core funds" decision appears (web Command Center + /advisor, phone
  Home + Approve). Core is never traded without that approval; the plan is
  self-funded (sells first, then buys).
- **Pause** ("Stop new trades and sell Explore" / Flatten & Halt) sells
  strategy positions only — Core and Tier 1 are never sold. Web dialog and
  phone Pause screen say so; the phone pause impact counts Explore only.
- **Bad-year dollars from the actual tier mix** (`lib/allocation/bad-year.ts`):
  Safety doesn't drop; Core stocks move like the S&P 500 series; Core bonds
  like BND's own monthly history (stock series if unavailable — overstates,
  never understates); Explore and anything not yet placed count as stocks.
  Series are blended month by month. Used by the web simple dashboard, phone
  Home / Goals, and the approval screen's before/after.
- **Totals**: simple dashboard and phone "total value" / "since you started"
  add deposits and the funds' P&L (the strategy equity curve is now
  strategy-only). Weekly summary adds one sentence for approved fund moves;
  phone Activity labels fund trades Core / Safety with their own reasons.
- **Daily mark-to-market** of fund positions (`markLadderPositions`, a step in
  the `daily` cron and a standalone `ladder-mark` task) — price and
  unrealized P&L only; the strategy exit sweep skips these rows by design.

**Pre-existing bugs found and fixed (both only reduce or make honest):**
1. `paper_positions.exit_reason` CHECK rejected `'manual_flatten'`, so Flatten
   & Halt / phone "sell Explore" never actually closed anything against a real
   database — and `PaperBroker.closeAt` ignored the update error, so it
   reported success. Migration widens the CHECK; `closeAt` now checks the
   error, retries with the always-valid `'manual'`, and reports a failure
   otherwise.
2. Correlation caps (`cio-decision-engine`) read `size_notional_usd` from
   `user_copied_positions` — a column that doesn't exist — so every row was $0
   and the sector/factor/counterparty/asset-class caps never bound; they also
   stamped every row with the NEW trade's asset class. Now
   `loadCorrelationBook` reads open paper strategy + copied positions with
   their real notional and own asset class. The cap denominator (recorded
   assets) is unchanged and already includes the money behind Core/Safety.
3. `paper_trades` only allows service-role inserts, so trade-log rows written
   from a user's own session were silently dropped. Migration adds a narrow
   INSERT policy for the user's own `'core'`/`'safety'` rows only; the weekly
   summary reads position rows so it works either way.

**New constants** (`lib/config/product-defaults.ts`): `CORE_DRIFT_THRESHOLD`
0.05, `CORE_MIN_TRADE_USD` 10.

**New migration**: `20260704m_core_positions.sql` — widened exit_reason CHECK
(`manual_flatten`, `rebalance`); `(user_id, strategy_key, status)` index;
`paper_deposits` (RLS: owner); `core_rebalance` + `deposit` approval kinds;
user INSERT policy on `paper_trades` for ladder keys only.

**Known limitation**: paper SGOV doesn't credit its monthly distribution, so
its marked price dips at each ex-dividend date. A dip below the Tier 1 target
re-raises a small "top up your safety cushion" decision and closes Explore
until approved (strict by design).

## 2026-11-20 — Wealth-manager allocation, Phase 2: the three-tier ladder

A person's money is filled in order — **Tier 1 Safety** (cash-like),
**Tier 2 Core** (the fund mix), **Tier 3 Explore** (strategies + copying).

- **Pure model** `lib/allocation/ladder.ts` (`computeLadder`): Tier 1 target =
  `EMERGENCY_FUND_MONTHS` × essential monthly expenses + the FULL target of
  every goal due within `SHORT_HORIZON_YEARS`. Funding is holdings-level
  (owner decision: strict): recorded cash assets + Tier 1 money designated by
  an approved setup decision must reach the target. Real estate is not
  investable money. Explore's cap is measured on money NOT in Tier 1 and is
  **$0 until Tier 1 is funded**.
- **Glide path** in `lib/allocation/policy.ts` (owner decision:
  profile-anchored, tilt caps the upside): a goal ≥ 10 years away holds the
  profile's own stock share capped at balanced + `PROFILE_TILT_MAX`
  (vault 20%, conservative 40%, balanced 60%, growth 75%, speculative 75%);
  between 10 and 2 years it steps down linearly to `GLIDE_SHORT_FRACTION`
  (25%) of that; under 2 years the goal's money is Tier 1. Several goals →
  dollar-weighted blend. Core holds no cash (cash is Tier 1).
- **Strict gate** in the pre-trade path: `exploreCapVerdict` blocks every
  Explore trade while Tier 1 is short (`tier1_unfunded: …`), logged to
  audit_logs with `blocked_by: 'tier1_gate'`. Applies to the paper runner and
  the copy-trade executor. Only ever reduces: property-tested that the new
  cap is never above the old one.
- **One-tap setup**: "Set up your safety cushion" decision (web /advisor
  ladder panel, web + mobile "Needs your decision" — ladder decisions come
  first; mobile Approve modal). Approving records a `setup_ladder` approval,
  THEN designates the shortfall (bounded by available money) as Tier 1 paper
  money in `ladder_state`. Phase 3 turns it into real paper SGOV.
- **Monthly expenses**: new onboarding step 4 (saved before the profile is
  marked onboarded), plus inputs on the web ladder panel and the mobile Goals
  screen. Stored in the existing `financial_profile.monthly_essential_expenses_usd`.
- **Display**: web /advisor "Your money ladder" panel; mobile Goals "Where the
  money is" is now the three-tier ladder (shown even with no goal). Both
  Explore screens and the weekly/activity sentences explain a Tier 1 hold in
  plain English.
- Mobile endpoints: `POST /api/mobile/goal` accepts `{ monthly_expenses_usd }`;
  `GET/POST /api/mobile/approve` serve and approve the ladder setup ahead of
  rebalances (server supplies the exact summary the user approves).

**New constants** (`lib/config/product-defaults.ts`): `EMERGENCY_FUND_MONTHS` 6,
`SHORT_HORIZON_YEARS` 2, `CASH_LIKE_CATEGORIES` ['cash'],
`LADDER_EXCLUDED_CATEGORIES` ['real_estate'], `GLIDE_FULL_HORIZON_YEARS` 10,
`GLIDE_SHORT_FRACTION` 0.25, `PROFILE_TILT_MAX` 0.15,
`GLIDE_REFERENCE_PROFILE` 'balanced'.

**New migration**: `20260704l_ladder.sql` — `ladder_state` (RLS: owner) and
`setup_ladder` added to the `automation_approvals.kind` check.

**Burn-in impact (owner-approved)**: from deploy, every paper strategy and
copy trade blocks until the user enters monthly expenses and approves the
setup decision. Requires `financial_profile` (migration 20260703c) and
migrations j/k/l applied remotely.

## 2026-11-19 — Wealth-manager allocation, Phase 1: one source of truth for the mix

Owner inputs recorded in `lib/config/product-defaults.ts`: Core funds VTI /
VXUS / BND / SGOV, 70/30 US/international stock split. (Emergency months = 6,
the strict Tier 1 gate with a one-tap setup decision, risk-ceiling vs Explore
risk budget, dual-book counting for moved strategies and speculative RISK_ON
0.5 are decided and land in Phases 2–5.)

- **`lib/config/product-defaults.ts`** — the one config module. Each constant
  is commented as a changeable product default: `CORE_FUNDS`,
  `US_SHARE_OF_STOCKS` (0.70), `PROFILE_MIX` (per-profile stocks/bonds/cash,
  carried over unchanged), `DEFAULT_PROFILE_KEY` ('balanced'),
  `DEFAULT_EXPLORE_CAP_FRACTION` (0.10), `EXPLORE_CAP_HARD_MAX_FRACTION` (0.25).
- **`lib/allocation/policy.ts`** — the single source of target allocations:
  profile mix, Core fund targets (four funds), default rebalance targets,
  the recommended whole-portfolio mix (Core × (1 − Explore) + Explore), and the
  planning Monte Carlo's Explore/Core buckets. Core never holds crypto.
- **Conflicting defaults removed and routed through the policy**:
  1. `coreAllocationFor()` in `lib/explore/cap.ts` (Core sleeve bootstrap now
     also stores the fund weights in sleeve metadata);
  2. `DEFAULT_TARGETS` in `lib/rebalance-engine.ts` (50 stock / 20 crypto /
     15 bond / 10 cash / 5 other) → `defaultRebalanceTargets(profile)` in
     `lib/workers/rebalance-scan.ts` and the rebalance page;
  3. `risk_profiles.alloc_*` seed (balanced = 45% stocks, 15% options, 20%
     crypto, 10% forex, 5% prediction markets, 5% multi) shown as the
     "recommended" allocation on `/portfolio` and the Command Center
     AllocationPanel → policy whole-portfolio mix. (DB columns untouched;
     nothing reads them any more. The Command Center panel shows targets only
     until Core holds real positions in Phase 3.)
  4. Planning Monte Carlo's hardcoded `investable * 0.1` Explore bucket →
     `planningBuckets()`;
  5. Rebalance trade symbols (stock → SPY, bond → "bond", cash → "cash") →
     the configured funds (VTI / BND / SGOV; BTC kept only for user-saved
     crypto targets);
  6. Unused `portfolioAllocation` in `lib/mock-data.ts` deleted.
- **Bug fixed along the way**: `computeRebalanceTrades` measured shares over
  ALL holdings but traded only targeted classes, so targets summing to 100%
  with untargeted holdings (crypto, real estate) produced buys with no
  matching sells. Shares are now measured over the targeted classes.
- **Left as-is, flagged for the owner**: `lib/advisory/sweep-engine.ts`
  `tierCapForInvestable()` caps the strategy sleeve by wealth tier from
  `kb_parameters` (5% under $100k investable, 10% $100k–$5M, 15%, 20%) —
  a second answer to "how much may go to strategies" that disagrees with the
  10% Explore cap below $100k. It drives sweep alerts only, not trades.
- Test-only: the income-vs-allocation Monte Carlo test block got a 30s
  timeout (it already exceeded the 5s default on the previous commit).

No migrations, no execution-path changes in this phase.

## 2026-11-18 — Web polish (Phase 7)

1. **Cyan accent** replaces indigo on the logo (sidebar + mobile drawer),
   landing, login and signup. Text on cyan is dark (`text-bg-0`); white on
   cyan would fail contrast. The shared Button/Badge/Input/Progress
   primitives and ~400 other indigo uses elsewhere are untouched (out of
   the requested scope) — see "follow-up" below.
2. **Tokens**: a codemod replaced every `bg-[#07080c]` (→ `bg-background`),
   `border-white/10` (→ `border-line-strong`), `bg-white/10` and
   `bg-gray-400/10` (→ new `bg-fill` token), and `text-gray-400` /
   `bg|ring|border-gray-400` (→ `text-1`) across 116 files, plus the other
   hardcoded surface hexes (`#0a0b0f`, `#0b0d13`, `#0f1117`, `#161922` →
   `bg-bg-0..3`). New token: `--color-fill` in `app/globals.css`.
3. **Topbar**: the dead search button is removed (no search feature exists);
   the bell links to `/alerts` with a real unread badge (only when > 0) and
   an accessible label; the hardcoded "W" avatar now shows the signed-in
   user's initials and links to Settings (`lib/actions/topbar.ts`).
4. **Text size**: every 9/10/11px class and inline chart tick size raised
   to 12px (risk strip, every panel, chart axes). The 9px labels' grey-600
   colour (≈2.4:1) lifted to the muted token on the same lines.
5. **▲/▼**: shared `TrendArrow` (glyph hidden from screen readers, "up"/
   "down" spoken instead, nothing for zero) on 40 gain/loss figures in 23
   files. Threshold colours that aren't gains or losses (correlation, HHI,
   Brier, hit rate, drift, budget) and sign-coloured chart bars (direction
   is already shown by the bar) are unchanged.

**Follow-up (not done, out of scope)**: the shared `Button` default variant
and ~400 indigo uses inside the app are still indigo. Converting them means
switching white button text to dark text on cyan; worth doing as one pass.

## 2026-11-18 — Mobile Simple mode (apps/mobile, Phases M1–M6)

The phone app is now the four-tab beginner app from the design canvas —
Home, Goals, Activity, Explore — plus Approve and Pause modals. It holds no
trading logic: every screen reads the web's new `/api/mobile/*` endpoints
with the user's Supabase JWT, and the server runs everything as that user
under RLS (no service-role client in the mobile surface — test-enforced).

- **M1** (70a77e6) NativeWind tokens, Inter + JetBrains Mono, four-tab layout,
  shared UI kit (Card, Pill, PracticeBadge, Money, Delta, ProgressBar,
  SplitBar, buttons, FilterPill, ScreenHeader, StateView). Fixed the
  uninstallable `react@18.3.2` / `@types/react-native@0.76` pins.
- **API** (22adb6a) Bearer-auth endpoints over shared cores; ONE pause
  implementation (`lib/simple/pause-core.ts`) now used by web and phone.
- **M2** (0cbb94c) Home + Goals with real data. **M3** (2276c0c) Activity +
  Approve with a recorded approval. **M4** (2ae663a) Explore + Pause.
  **M5** (b932019) accessibility: contrast script (all 31 pairs ≥ 4.5:1),
  dynamic type, 13pt minimum. **M6** legacy six-tab screens deleted,
  login restyled, README with run/build steps.

**Endpoints added**: `GET /api/mobile/home`, `GET|POST /api/mobile/goal`,
`GET /api/mobile/activity`, `GET|POST /api/mobile/approve`,
`GET /api/mobile/explore`, `POST /api/mobile/follow`,
`GET|POST /api/mobile/pause`, `POST /api/mobile/resume`.

**Not sourced from existing data (shown honestly instead of invented)**:
a trader's holding style (cards show the market only); a practice run's
"result so far" in dollars (cards show day N of 30 and progress only — no
per-follow paper P&L is tracked yet); "deposits still arrive" is stated as
policy (there is no deposit-automation table).

**Not verifiable here**: anything on a device or simulator (layout, fonts,
safe areas, VoiceOver/TalkBack, dynamic type at the largest sizes), and all
endpoint calls against the live Supabase project.

## 2026-11-18 — Safe-for-beginners program, web Phases 1–4

Goal: make Wealth OS safe and usable for someone with no investing knowledge
without removing professional features. Four phases, one commit each
(e3d8e38, 7ef90d9, 8bc12a9, 3ddd01c). Suite green after each phase; `npx tsc
--noEmit` added to CI.

**Phase 1 — Fix what is broken** (e3d8e38)
- Proxy exempts bearer-auth routes (`/api/cron`, `/api/internal/*`,
  `/api/execute-copy-trades`) from the session redirect; other
  unauthenticated `/api/*` requests get 401 JSON, not an HTML redirect.
- Every cron task is a direct function call (`lib/cron/tasks.ts` + extracted
  workers in `lib/workers/`): the credential-less HTTP self-fetches that
  always failed auth (sync, copy, simulate, rebalance, harvest-scan,
  sync-crypto, sync-forex, daily's kraken/oanda calls, daily-ops re-fetching
  /api/cron) are gone, and every task reports a real success or failure.
- Flatten & Halt actually closes open paper positions
  (`PaperBroker.flattenAllPositions` via the runner's exit path), writes
  audit_logs, and the dialog says exactly what happens (paper only; live out
  of scope). Halt/resume failures are surfaced; a failed risk-data load
  renders a visible "risk data unavailable" strip that keeps the halt button.
- Added `app/(app)/loading.tsx`, `app/(app)/error.tsx`, `app/not-found.tsx`.
- Fixed all test type errors; README (Next 16, port 3120, full migration
  list + the CLI filename-pattern caveat) and the cron runbook now agree
  with vercel.json.

**Phase 2 — Onboarding and navigation** (7ef90d9)
- Signup handles email confirmation ("check your email") and routes
  immediate sessions to onboarding, never straight to /dashboard.
- Goal-first onboarding: what the money is for → target amount/date →
  monthly contribution → existing risk questions. Goal stored in the
  existing `household_goals` table; /dashboard gated on
  `user_risk_profile.onboarded_at`.
- Landing "View Demo" (which bounced to login) replaced with Sign In.
- Sidebar collapses to a drawer below md; Portfolio split into Portfolio +
  Planning; orphaned /paper-trading and /settings/ai-features linked.

**Phase 3 — Simple mode** (8bc12a9)
- `ui_mode` ('simple' | 'pro') on `user_ui_prefs`; unset = pro (existing
  users unchanged), onboarding writes simple for new users; toggle in the
  risk strip.
- Simple dashboard: total value + today/since-start changes + value chart;
  goal progress with on-track/behind verdict and expected date; up to five
  plain-English "what happened this week" sentences from real events; the
  Command Center's decisions list. Pro mode renders the untouched Command
  Center.
- Risk in dollars ("in a bad year this plan could fall about $X") and the
  goal projection both derive from the same 20y S&P monthly series the
  planning Monte Carlo uses (`lib/planning/market-returns.ts`,
  `lib/planning/goal-projection.ts`) — no new risk model.
- Simple sidebar: Home, Goals, Portfolio, Activity, Explore, Settings.
- `GlossaryTerm` tooltip component for finance terms in simple mode.

**Phase 4 — Core and Explore** (3ddd01c)
- Two sleeves on the existing `portfolio_sleeves` table (metadata.kind
  core/explore); Core allocation chosen from the risk profile.
- Explore cap: default 10% (`DEFAULT_EXPLORE_CAP_FRACTION`), pro-adjustable
  up to `EXPLORE_CAP_HARD_MAX_FRACTION` (25%). Enforced pre-trade in the
  paper runner and the copy-trade executor; breaches blocked + logged
  (audit_logs `blocked_by: explore_cap`, `exploreCapBlocked` skip counter).
  NOTE: this is the one sanctioned execution-path change during the burn-in
  (owner-approved 2026-11-18); it only ever blocks trades.
- Approval before automation (simple mode): follow trader, auto-copy,
  enable strategy, execute rebalance all require an approved plain-language
  summary, recorded in `automation_approvals`.
- Copy guardrails: headline vs copier-adjusted results (real copied-trade
  P&L when ≥5 copies, else labeled estimate: delay haircut
  `COPY_DELAY_HAIRCUT_FRACTION` + venue round-trip costs × turnover);
  Lower/Bigger swings pill; auto-copy locked behind a 30-day practice run
  (`PAPER_COPY_PERIOD_DAYS`, enforced server-side in every mode); simple
  mode ranks by adjusted result, never raw return.

**New migrations** (apply via Supabase SQL editor, in order):
- `20260704j_ui_mode.sql` — `user_ui_prefs.ui_mode`
- `20260704k_automation_approvals.sql` — `automation_approvals` table

**New env vars**: none. (CRON_SECRET / WEALTH_OS_API_KEY unchanged;
NEXT_PUBLIC_SITE_URL is no longer used by the cron path at all.)

**Not verifiable without live Supabase/broker credentials**: the end-to-end
cron runs against the remote DB, Supabase email-confirmation delivery, the
sleeve bootstrap + approval writes against remote RLS, and real copier
P&L backfill (estimates render until ≥5 real copies exist per trader).

## 2026-07-04 — Advisory / R&D layer (P1–P3), burn-in untouched

Three additive advisory/R&D features. HARD CONSTRAINT honored: zero diffs in
lib/risk, lib/broker-adapters, lib/brokers, orchestrator, BasePipelineStrategy,
or any strategy file — verified with `git diff --stat` before each commit. All
three are advisory-only; nothing trades.

**P1 — Strategy-Scientist ideation** (`lib/research/ideation.ts`): LLM proposes
hypotheses, code computes/validates numbers. riskRewardReview /
optimizationProposal inject the real paper scorecard; alphaScan (quarterly)
is hypotheses-only. Guardrails in code, not prompt: performance-number claims
are dropped from risk/reward proposals and void an entire alpha scan.
`research_proposals` table (migration g) with proposed→accepted→backtested→
rejected/promoted workflow; maturity pinned to 'stub' by CHECK. ESLint
no-restricted-imports + a guard test keep the research layer out of the
execution path. Weekly `strategy-scientist` cron (files proposals only; NOT in
daily/daily-ops).

**P2 — Owner Dependency Audit** (`r8-business-systemization.ts`): new coaching
grade. `Recommendation.grade` ('quantified' | 'coaching'); coaching cards never
enter benefit totals or the Monte Carlo and always rank below quantified.
Triggers on a profitable business entity; asks the three context questions,
then produces the audit + Operations Architect follow-up.
`financial_profile.business_context` jsonb (migration h). UI badge
"Coaching — not calculated advice".

**P3 — Income-Growth pillar** (`r9-income-growth.ts` + `lib/advisory/
income-growth.ts` + `lib/actions/income-growth.ts`): the earning lever below
mass-affluent investable. Quantified income-vs-allocation header from the REAL
Monte Carlo (same-seeded, monotonic); coaching idea cards classified by
ease/speed/investment/profit/scalability. Speculative income never enters the
planner unless the user converts it to a real profile income change
(convertIncomeIdeaToProfile). Thresholds seeded in kb_parameters (migration i).

Tests: +54 (ideation 17, r8 coaching 8, r9 income 15, import boundary, plus
verdict-count updates). Suite 1050 green; build + lint clean (0 errors).


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
