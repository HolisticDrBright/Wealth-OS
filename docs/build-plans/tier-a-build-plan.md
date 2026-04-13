# Tier A Build Plan — Wealth OS

> **Architecture note**: Wealth OS is a single Next.js 16 App Router monolith (not a monorepo).
> There are no Python microservices, BullMQ workers, or agent packages.
> All features live in `lib/` engines + `app/api/` routes + `app/(app)/` pages backed by Supabase.

---

## A1 — Household-Level Tax-Loss Harvesting

### Goal
Run wash-sale detection and lot selection across *all* members of a household, not just the current user.

### What Already Exists
| File | Role |
|------|------|
| `lib/wash-sale-checker.ts` | 30-day wash-sale window logic per user |
| `lib/tax-lots.ts` | HIFO/LIFO/FIFO/Specific-ID lot selector |
| `lib/actions/harvest.ts` | Server action — marks a lot harvested + stores `lot_method` |
| `app/(app)/tax/harvest/` | Harvest UI with lot-method radio picker |
| `supabase/schema.sql` | `households`, `household_members` tables already exist |

### What Needs to Be Built

**1. `lib/learning/tlh-household.ts`**
```ts
export async function getHouseholdLots(householdId: string, supabase: SupabaseClient)
// Joins household_members → portfolios → tax_lots for all members
// Returns lots with member_id attached so wash-sale can cross-check across accounts
```

**2. `lib/wash-sale-checker.ts` — extend**
- Add `checkWashSaleAcrossMembers(lots: LotWithMember[], symbol: string)` that groups by symbol, sorts by date, and flags any lot within 30 days of *any* member's sale of the same symbol.

**3. `app/api/tax/household-harvest/route.ts`** (new)
```
POST  /api/tax/household-harvest
Body: { householdId, symbol, method: LotMethod }
Returns: { eligible: Lot[], blocked: Lot[], projectedSavings: number }
```

**4. `supabase/schema.sql` — append**
```sql
CREATE TABLE tlh_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES households(id),
  symbol      text NOT NULL,
  proposed_at timestamptz DEFAULT now(),
  lots        jsonb NOT NULL,          -- array of lot ids + member ids
  status      text DEFAULT 'pending',  -- pending | executed | dismissed
  savings_est numeric,
  created_by  uuid REFERENCES auth.users(id)
);
ALTER TABLE tlh_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household members" ON tlh_proposals
  USING (household_id IN (
    SELECT household_id FROM household_members WHERE user_id = auth.uid()
  ));
```

**5. `app/(app)/household/tlh/page.tsx`** (new)
- Server component: load `tlh_proposals` for the user's household
- Client component: show proposals grouped by symbol, mark executed/dismissed

### Acceptance Criteria
- [ ] Wash-sale check spans all accounts in household
- [ ] Proposal saved to `tlh_proposals` before any lot is touched
- [ ] Each member's lots show correct cross-account wash-sale flags

---

## A2 — Roth Conversion Ladder Planner

### Goal
Project multi-year Roth conversions using current income, brackets, and account balances. Show the optimal annual conversion amount that minimizes lifetime tax.

### What Already Exists
| File | Role |
|------|------|
| `lib/retirement-calculator.ts` | Monte Carlo + SWR + savings projections |
| `app/(app)/retirement/` | Retirement planner page + client |

### What Needs to Be Built

**1. `lib/roth-ladder.ts`** (new)
```ts
interface RothPlan {
  year: number
  currentBalance: number      // trad IRA
  conversionAmount: number    // recommended conversion this year
  taxCost: number             // marginal rate × amount
  rothBalanceAfter: number
  projectedRMD: number        // at age 73
}

export function buildRothLadder(params: {
  traditionalBalance: number
  rothBalance: number
  currentAge: number
  retirementAge: number
  filingStatus: 'single' | 'mfj'
  ordinaryIncome: number      // non-IRA income (SS, pension, wages)
  growthRate?: number         // default 7%
  inflationRate?: number      // default 3%
}): RothPlan[]
```

Algorithm:
1. Project IRMAA thresholds + standard deduction forward with inflation
2. Each year: fill remaining "headroom" in current bracket before the next bracket
3. Stop conversions when RMD projected < top-of-bracket headroom

**2. `app/api/roth-ladder/route.ts`** (new)
```
POST /api/roth-ladder
Body: { traditionalBalance, rothBalance, currentAge, retirementAge, filingStatus, ordinaryIncome }
Returns: { plan: RothPlan[], lifetimeTaxSaved: number, optimalAnnualConversion: number }
```

**3. `app/(app)/retirement/roth/page.tsx`** (new)
- Input form: balances, ages, filing status, income
- Bar chart (Recharts): year-by-year conversion amount coloured by bracket
- Summary card: lifetime tax saved vs. no conversion

### Acceptance Criteria
- [ ] Output uses actual 2025 tax brackets (with inflation projection)
- [ ] "Zero conversion" baseline shown for comparison
- [ ] Works for both single and MFJ filers

---

## A3 — Backtest Hygiene Engine

### Goal
Surface look-ahead bias, overfitting risk, and regime sensitivity in backtests. Attach CI bands and regime tags to every backtest run.

### What Already Exists
| File | Role |
|------|------|
| `lib/backtester.ts` | Basic OHLC-based strategy backtester |
| `lib/backtester-advanced.ts` | Extended version with drawdown, Sharpe |
| `app/api/backtest/route.ts` | Runs backtests + returns metrics |
| `app/(app)/backtests/` | Backtests UI |

### What Needs to Be Built

**1. `lib/backtest-hygiene.ts`** (new)
```ts
export interface HygieneReport {
  look_ahead_flags: string[]    // detected pattern names, e.g. "future_bar_reference"
  overfit_score: number         // 0-1; ratio of in-sample vs out-of-sample Sharpe
  regime_tags: string[]         // e.g. ["bull_2020","covid_crash","rate_hike_cycle"]
  ci_bands: { p5: number; p50: number; p95: number }  // bootstrap of annual returns
  warnings: string[]
}

export function analyzeBacktest(
  bars: Bar[],
  trades: Trade[],
  metrics: BacktestMetrics
): HygieneReport
```

Checks:
- **Look-ahead**: any trade entry price == future bar's close/high/low
- **Overfit score**: walk-forward split (70/30), compare in-sample vs OOS Sharpe ratio
- **Regime tags**: classify date ranges using rolling 200-day return (>20% = bull, <-20% = bear, else sideways)
- **CI bands**: 1000-sample bootstrap of annual return distribution

**2. `app/api/backtest/route.ts` — extend response**
```ts
// Append to existing response:
hygiene: HygieneReport
```

**3. `app/(app)/backtests/backtest-client.tsx` — extend UI**
- Add "Hygiene" tab alongside existing results
- Show look-ahead flags as red badges
- CI band fan chart (Recharts AreaChart with p5/p95 area + p50 line)
- Regime breakdown bar showing bull/bear/sideways periods

**4. `supabase/schema.sql` — append**
```sql
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS hygiene_report jsonb;
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS regime_tags text[];
```

### Acceptance Criteria
- [ ] Every backtest run returns a `hygiene` object
- [ ] Look-ahead detection covers price-reference and volume-reference patterns
- [ ] CI bands derived from ≥500 bootstrap samples

---

## A4 — Unified Copy Trading Feed

### Goal
Normalize signals from all trader sources (Alpaca, internal strategies, manual entries) into a single typed `Signal` and surface them in a unified feed.

### What Already Exists
| File | Role |
|------|------|
| `app/(app)/traders/` | Top traders page |
| `app/(app)/feed/` | Live feed page |
| `app/(app)/strategies/` | Strategy management |
| `lib/broker-router.ts` | Routes orders to Alpaca/Kraken/OANDA |

### What Needs to Be Built

**1. `lib/signals/types.ts`** (new)
```ts
export interface Signal {
  id: string
  source: 'alpaca_trader' | 'kronos' | 'mirofish' | 'combined' | 'manual'
  trader_id?: string          // for copy-trading sources
  symbol: string
  direction: 'long' | 'short' | 'flat'
  confidence: number          // 0-1
  entry_price?: number
  target_price?: number
  stop_price?: number
  horizon_days: number
  emitted_at: string          // ISO
  rationale?: string
  tags: string[]
}
```

**2. `lib/signals/adapters/`** (new directory)
- `alpaca-adapter.ts`: poll `/v2/watchlist` + position changes → `Signal[]`
- `kronos-adapter.ts`: wrap existing `getCombinedSignal()` output → `Signal`
- `manual-adapter.ts`: accept user POST body → `Signal`

**3. `app/api/signals/route.ts`** (new)
```
GET  /api/signals?source=all&limit=50   → Signal[]  (merged, sorted by emitted_at desc)
POST /api/signals                        → create manual Signal
```

**4. `supabase/schema.sql` — append**
```sql
CREATE TABLE signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  source      text NOT NULL,
  trader_id   text,
  symbol      text NOT NULL,
  direction   text NOT NULL,
  confidence  numeric,
  entry_price numeric,
  target_price numeric,
  stop_price  numeric,
  horizon_days int,
  emitted_at  timestamptz DEFAULT now(),
  rationale   text,
  tags        text[] DEFAULT '{}'
);
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own signals" ON signals USING (user_id = auth.uid());
CREATE INDEX signals_user_emitted ON signals(user_id, emitted_at DESC);
```

**5. `app/(app)/feed/feed-client.tsx` — extend**
- Replace mock signal cards with real `Signal[]` from `/api/signals`
- Filter bar: source, symbol, direction, min confidence
- "Copy" button → pre-fills order form with signal's entry/stop/target

### Acceptance Criteria
- [ ] All signal sources produce identically shaped `Signal` objects
- [ ] Feed polls every 30s (or on manual refresh)
- [ ] Copy button opens order form pre-filled from signal

---

## A5 — Household Mode (Promote Existing Features)

### Goal
Elevate TLH, planning, and budgeting so they operate at the household level, not just per-user. The households/household_members tables already exist; this phase wires the UI to use them.

### What Already Exists
| File | Role |
|------|------|
| `app/(app)/household/` | Household management page |
| `supabase/schema.sql` | `households`, `household_members` tables |
| `lib/actions/harvest.ts` | Per-user harvest action |
| `app/(app)/planning/` | Wealth planning page |
| `app/(app)/budget/` | Budget page |

### What Needs to Be Built

**1. `lib/household-context.ts`** (new)
```ts
export async function getActiveHousehold(userId: string, supabase: SupabaseClient)
// Returns the household the user belongs to (or null if solo)
// Caches in-process for 60s per userId
```

**2. Promote TLH** — already covered in A1 (household harvest proposal)

**3. Promote Planning** — `app/(app)/planning/page.tsx`
- If user has a household: show aggregate net worth (sum of all members' portfolios)
- Show per-member allocation breakdown in a stacked bar

**4. Promote Budget** — `app/(app)/budget/page.tsx`
- If household: show household totals + per-member spending columns side by side

**5. `app/(app)/household/page.tsx` — extend**
- Add "Household Dashboard" card: combined net worth, members, shared TLH proposals count
- Link to `/household/tlh` (A1)

**6. `supabase/schema.sql` — append**
```sql
-- Shared budgets at household level
CREATE TABLE household_budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES households(id),
  category     text NOT NULL,
  monthly_limit numeric NOT NULL,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE household_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household members" ON household_budgets
  USING (household_id IN (
    SELECT household_id FROM household_members WHERE user_id = auth.uid()
  ));
```

### Acceptance Criteria
- [ ] Solo users see no change (household = null path unchanged)
- [ ] Household users see aggregate figures everywhere they exist
- [ ] Household budget categories are shared (one change reflects for all members)

---

## A6 — Calibration Dashboard (Learning Loop Extension)

### Goal
Break down the Learning Loop's per-strategy stats by time window (30d / 90d / 365d / all-time) and show per-confidence-bucket calibration charts.

### What Already Exists
| File | Role |
|------|------|
| `lib/learning/scorer.ts` | `scoreStrategies()` over all outcomes |
| `lib/learning/weights.ts` | Weight store + softmax/clamp |
| `app/(app)/learning/` | Learning Loop page |
| `app/api/learning/route.ts` | GET/POST for weights + scores |
| `supabase/schema.sql` | `decision_log`, `outcome_log`, `strategy_weights` |

### What Needs to Be Built

**1. `lib/learning/calibration.ts`** (new)
```ts
export interface CalibrationBucket {
  bin_low: number   // e.g. 0.5
  bin_high: number  // e.g. 0.6
  predicted_freq: number   // centre of bin
  actual_freq: number      // fraction correct in this bucket
  count: number
}

export interface WindowStats {
  window: '30d' | '90d' | '365d' | 'all'
  strategies: StrategyStats[]
  calibration: Record<string, CalibrationBucket[]>  // keyed by strategy
}

export function buildWindowStats(outcomes: OutcomeRow[], windowDays: number | null): WindowStats
```

Algorithm for calibration chart:
1. Bin decisions into 10% confidence buckets (0.5–0.6, 0.6–0.7, … 0.9–1.0)
2. For each bucket: `actual_freq = correct_calls / total_calls`
3. Perfect calibration = diagonal line; overconfidence = curve below diagonal

**2. `app/api/learning/route.ts` — extend GET response**
```ts
// Add to existing GET response:
windows: WindowStats[]   // 30d, 90d, 365d, all
```

**3. `app/(app)/learning/learning-client.tsx` — extend UI**
- Add tabbed view: "Overview" (existing) | "30d" | "90d" | "365d"
- Each tab: strategy stats table for that window
- Calibration chart (Recharts LineChart):
  - X axis: predicted confidence (0.5 → 1.0)
  - Y axis: actual accuracy
  - One line per strategy + dashed "perfect calibration" reference
- Overconfidence warning badge if any bucket's actual_freq < predicted_freq − 0.10

### Acceptance Criteria
- [ ] 30d window correctly excludes outcomes older than 30 days
- [ ] Calibration chart shows diagonal reference line
- [ ] Strategies with < 5 outcomes in a window show "Insufficient data"

---

## Implementation Order

| Phase | Feature | Est. Complexity |
|-------|---------|----------------|
| 1 | A6 — Calibration Dashboard | Low — extends existing learning loop files |
| 2 | A2 — Roth Conversion Ladder | Low-Medium — pure math, new lib + route + page |
| 3 | A3 — Backtest Hygiene | Medium — extends backtester, adds bootstrap |
| 4 | A4 — Unified Signal Feed | Medium — new table + adapters + feed extension |
| 5 | A5 — Household Mode promote | Medium — wires existing household tables to planning/budget |
| 6 | A1 — Household TLH | High — cross-account wash-sale, new proposal table + UI |

---

## Schema Summary (all new SQL)

Run these migrations in order in the Supabase SQL editor:

```sql
-- A1
CREATE TABLE tlh_proposals ( ... );   -- see A1 section above

-- A4
CREATE TABLE signals ( ... );          -- see A4 section above

-- A5
CREATE TABLE household_budgets ( ... ); -- see A5 section above

-- A3
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS hygiene_report jsonb;
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS regime_tags text[];
```

No changes to `decision_log`, `outcome_log`, or `strategy_weights` are needed for A6.

---

## File Creation Checklist

```
lib/
  roth-ladder.ts              (A2)
  backtest-hygiene.ts         (A3)
  signals/
    types.ts                  (A4)
    adapters/
      alpaca-adapter.ts       (A4)
      kronos-adapter.ts       (A4)
      manual-adapter.ts       (A4)
  household-context.ts        (A5)
  learning/
    calibration.ts            (A6)
    tlh-household.ts          (A1)

app/api/
  roth-ladder/route.ts        (A2)
  signals/route.ts            (A4)
  tax/household-harvest/route.ts (A1)

app/(app)/
  retirement/roth/page.tsx    (A2)
  household/tlh/page.tsx      (A1)
```
