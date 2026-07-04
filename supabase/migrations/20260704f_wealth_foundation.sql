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
-- Remote databases created before schema.sql grew the household tables may
-- not have them at all — create them (from schema.sql, unchanged shapes)
-- before altering. All IF NOT EXISTS; nothing is dropped.

CREATE TABLE IF NOT EXISTS public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  household_type text DEFAULT 'family' CHECK (household_type IN ('family','couple','individual','trust','foundation','advisory')),
  total_net_worth_usd numeric(15,2) DEFAULT 0,
  advisor_user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  estate_plan_notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Household owner manages" ON public.households;
CREATE POLICY "Household owner manages" ON public.households FOR ALL USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS "Household advisor can view" ON public.households;
CREATE POLICY "Household advisor can view" ON public.households FOR SELECT USING (advisor_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('owner','spouse','dependent','trustee','beneficiary','advisor')),
  email text,
  birth_year int,
  net_worth_usd numeric(15,2) DEFAULT 0,
  income_usd numeric(15,2) DEFAULT 0,
  is_invited boolean DEFAULT false,
  invited_at timestamptz,
  joined_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Household owner manages members" ON public.household_members;
CREATE POLICY "Household owner manages members" ON public.household_members FOR ALL USING (
  household_id IN (SELECT id FROM public.households WHERE owner_user_id = auth.uid())
);

-- assigned_sleeve_id stays a plain uuid here (no FK) so this migration works
-- even on databases where portfolio_sleeves has not been created yet.
CREATE TABLE IF NOT EXISTS public.household_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  goal_type text DEFAULT 'general',
  target_amount_usd numeric(15,2) NOT NULL,
  current_amount_usd numeric(15,2) DEFAULT 0,
  target_date date,
  assigned_sleeve_id uuid,
  status text DEFAULT 'active' CHECK (status IN ('active','achieved','paused','cancelled')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.household_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Household owner manages goals" ON public.household_goals;
CREATE POLICY "Household owner manages goals" ON public.household_goals FOR ALL USING (
  household_id IN (SELECT id FROM public.households WHERE owner_user_id = auth.uid())
);

ALTER TABLE public.household_goals DROP CONSTRAINT IF EXISTS household_goals_goal_type_check;
ALTER TABLE public.household_goals ADD CONSTRAINT household_goals_goal_type_check
  CHECK (goal_type IN ('retirement','education','home','estate','trust','charitable',
                       'emergency','other','general','major_purchase','business','insurance_review'));
ALTER TABLE public.household_goals
  ADD COLUMN IF NOT EXISTS monthly_contribution_usd numeric;
