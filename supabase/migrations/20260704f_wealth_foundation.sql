-- ─── Wealth-management foundation (upgrade brief items 1,2,3,5,6) ────────────
-- Additive only. RLS on everything; users touch only their own rows;
-- broker_certifications is a system/reference table (service-role writes).
-- NOTHING here enables live trading.

-- ── 1. Provider-neutral account aggregation ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connected_account_profiles (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_name text NOT NULL,
  account_name     text,
  account_type     text NOT NULL CHECK (account_type IN
    ('checking','savings','credit_card','brokerage','ira','roth_ira','401k','hsa','loan','mortgage')),
  provider         text NOT NULL DEFAULT 'manual' CHECK (provider IN
    ('manual','plaid','teller','finicity','broker_import')),
  balance_usd      numeric,
  -- For credit/loan/mortgage: the amount OWED (positive number).
  apr_pct          numeric,
  last_synced_at   timestamptz,
  stale_after      timestamptz,
  sync_error       text,
  data_quality     text NOT NULL DEFAULT 'manual' CHECK (data_quality IN
    ('manual','synced','stale','error')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connected_account_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own connected accounts" ON public.connected_account_profiles;
CREATE POLICY "own connected accounts" ON public.connected_account_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS connected_accounts_user_idx
  ON public.connected_account_profiles(user_id, account_type);

-- ── 2a. Employer benefits ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employer_benefits (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  match_available       boolean,
  match_formula         text,
  match_percent         numeric,
  match_cap_pct_of_pay  numeric,
  vesting_notes         text,
  on_track_for_full_match boolean,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employer_benefits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own employer benefits" ON public.employer_benefits;
CREATE POLICY "own employer benefits" ON public.employer_benefits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2b. Debt profile ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.debt_accounts (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  debt_type           text NOT NULL DEFAULT 'other' CHECK (debt_type IN
    ('credit_card','student_loan','auto_loan','personal_loan','mortgage','heloc','medical','other')),
  balance_usd         numeric NOT NULL DEFAULT 0,
  apr_pct             numeric,
  minimum_payment_usd numeric,
  payoff_priority     integer,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.debt_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own debts" ON public.debt_accounts;
CREATE POLICY "own debts" ON public.debt_accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS debt_accounts_user_idx ON public.debt_accounts(user_id);

-- ── 3. Suitability / fiduciary files ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recommendation_files (
  id                           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_type          text NOT NULL,
  recommendation_id            text NOT NULL,
  facts_used                   jsonb NOT NULL DEFAULT '{}',
  missing_facts                jsonb NOT NULL DEFAULT '[]',
  alternatives_considered      jsonb NOT NULL DEFAULT '[]',
  rejected_alternatives        jsonb NOT NULL DEFAULT '[]',
  risk_profile_snapshot        jsonb NOT NULL DEFAULT '{}',
  conflicts_disclosed          jsonb NOT NULL DEFAULT '[]',
  explanation                  text NOT NULL,
  professional_review_required boolean NOT NULL DEFAULT true,
  -- Model governance (item 8): what produced this, from which inputs, when.
  rule_version                 text,
  constants_year               integer,
  data_freshness               jsonb NOT NULL DEFAULT '{}',
  created_at                   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recommendation_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own recommendation files" ON public.recommendation_files;
CREATE POLICY "own recommendation files" ON public.recommendation_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS recommendation_files_user_idx
  ON public.recommendation_files(user_id, recommendation_type, created_at DESC);

-- ── 5. Broker sandbox certifications (system/reference table) ─────────────────
-- IMPORTANT: rows here NEVER flip liveReady — that stays a reviewed code
-- change. This table only records the sandbox evidence the runbook requires.
CREATE TABLE IF NOT EXISTS public.broker_certifications (
  id                          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  broker                      text NOT NULL,
  environment                 text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','paper','live')),
  tested_order_placement      boolean NOT NULL DEFAULT false,
  tested_cancel               boolean NOT NULL DEFAULT false,
  tested_status               boolean NOT NULL DEFAULT false,
  tested_partial_fill         boolean NOT NULL DEFAULT false,
  tested_rejection            boolean NOT NULL DEFAULT false,
  tested_bracket_oco          boolean NOT NULL DEFAULT false,
  tested_reconciliation       boolean NOT NULL DEFAULT false,
  tested_quantity_conversion  boolean NOT NULL DEFAULT false,
  evidence_notes              text,
  certified_by                text,
  certified_at                timestamptz,
  expires_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broker, environment)
);
ALTER TABLE public.broker_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read broker certifications" ON public.broker_certifications;
CREATE POLICY "read broker certifications" ON public.broker_certifications FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "service writes broker certifications" ON public.broker_certifications;
CREATE POLICY "service writes broker certifications" ON public.broker_certifications FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 6. Household goals: widen the goal_type enum (additive) ──────────────────
ALTER TABLE public.household_goals DROP CONSTRAINT IF EXISTS household_goals_goal_type_check;
ALTER TABLE public.household_goals ADD CONSTRAINT household_goals_goal_type_check
  CHECK (goal_type IN ('retirement','education','home','estate','trust','charitable',
                       'emergency','other','general','major_purchase','business','insurance_review'));
ALTER TABLE public.household_goals
  ADD COLUMN IF NOT EXISTS monthly_contribution_usd numeric;
