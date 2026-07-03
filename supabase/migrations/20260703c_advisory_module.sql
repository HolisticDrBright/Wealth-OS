-- ─── Advisory module: tax_constants, kb_parameters, financial_profile, advisory_log ──
--
-- Design rule #1: NO limit, rate, or threshold is ever hardcoded in rule code.
-- Everything year-keyed here, with source URLs and verification timestamps.
-- A staleness job flags constants unverified for >90 days.

-- ── tax_constants ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_constants (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year         integer NOT NULL,
  key          text NOT NULL,
  value        numeric NOT NULL,
  description  text,
  source_url   text,
  verified_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (year, key)
);

ALTER TABLE public.tax_constants ENABLE ROW LEVEL SECURITY;
-- Reference data: readable by all authenticated users; service role writes.
DROP POLICY IF EXISTS "authenticated read tax constants" ON public.tax_constants;
CREATE POLICY "authenticated read tax constants"
  ON public.tax_constants FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Seed: 2026 values, verified 2026-07-03 against IRS Notice 25-67 / Pub 15.
INSERT INTO public.tax_constants (year, key, value, description, source_url) VALUES
  (2026, 'se_tax_rate',                          0.153,   'Combined SE tax rate (12.4% SS + 2.9% Medicare)', 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes'),
  (2026, 'se_ss_rate',                           0.124,   'Social Security portion of SE tax', 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes'),
  (2026, 'se_medicare_rate',                     0.029,   'Medicare portion of SE tax', 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes'),
  (2026, 'se_earnings_factor',                   0.9235,  'SE tax applies to 92.35% of net profit', 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes'),
  (2026, 'ss_wage_base',                         184500,  'Social Security wage base', 'https://www.irs.gov/publications/p15'),
  (2026, 'ira_limit',                            7500,    'IRA contribution limit', 'https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500'),
  (2026, 'ira_catchup_50',                       1100,    'IRA catch-up age 50+', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, 'roth_phaseout_single_start',           153000,  'Roth IRA phase-out start, single', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, 'roth_phaseout_single_end',             168000,  'Roth IRA phase-out end, single', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, 'roth_phaseout_mfj_start',              242000,  'Roth IRA phase-out start, MFJ', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, 'roth_phaseout_mfj_end',                252000,  'Roth IRA phase-out end, MFJ', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, 'hsa_limit_single',                     4400,    'HSA limit, self-only HDHP', 'https://www.alpa.org/articles/2026/01/2026-irs-contribution-and-benefit-limits'),
  (2026, 'hsa_limit_family',                     8750,    'HSA limit, family HDHP', 'https://www.alpa.org/articles/2026/01/2026-irs-contribution-and-benefit-limits'),
  (2026, 'hsa_catchup_55',                       1000,    'HSA catch-up age 55+', 'https://www.alpa.org/articles/2026/01/2026-irs-contribution-and-benefit-limits'),
  (2026, 'solo401k_employee',                    24500,   'Solo 401(k) employee deferral', 'https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500'),
  (2026, 'solo401k_total',                       72000,   'Solo 401(k) combined limit', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, '401k_catchup_50',                      8000,    '401(k) catch-up age 50+', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf'),
  (2026, '401k_catchup_60_63',                   11250,   '401(k) enhanced catch-up ages 60-63', 'https://www.merceradvisors.com/retirement/2026-retirement-plan-contribution-limits-and-catch-up-rules/'),
  (2026, 'roth_catchup_mandate_wage_threshold',  150000,  'Prior-year wages above this → catch-ups must be Roth', 'https://www.merceradvisors.com/retirement/2026-retirement-plan-contribution-limits-and-catch-up-rules/'),
  (2026, 'mileage_rate_business',                0.725,   'Business mileage rate $/mile', 'https://blackinctax.com/self-employment-tax-2026/'),
  (2026, 'home_office_safe_harbor_per_sqft',     5,       'Home-office safe harbor $/sqft', 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction'),
  (2026, 'home_office_safe_harbor_max_sqft',     300,     'Home-office safe harbor sqft cap', 'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction'),
  (2026, 'scorp_employer_match_factor',          0.25,    'Employer profit-share = 25% of W-2 salary', 'https://www.irs.gov/retirement-plans/one-participant-401k-plans'),
  (2026, 'ltcg_top_rate_with_niit',              0.238,   'Top LTCG rate incl. 3.8% NIIT', 'https://www.irs.gov/taxtopics/tc409'),
  (2026, 'stcg_top_rate_with_niit',              0.408,   'Top STCG rate incl. 3.8% NIIT', 'https://www.irs.gov/taxtopics/tc409'),
  (2026, 'estate_exemption_per_person',          15000000,'Estate exemption per person (OBBBA)', 'https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions'),
  (2026, 'ca_scorp_franchise_rate',              0.015,   'California S-corp franchise tax rate on net income', 'https://www.ftb.ca.gov/file/business/types/corporations/s-corporations.html'),
  (2026, 'ca_franchise_min',                     800,     'California minimum franchise tax', 'https://www.ftb.ca.gov/file/business/types/corporations/s-corporations.html'),
  (2026, 'qbi_deduction_rate',                   0.20,    'Qualified Business Income deduction rate (§199A)', 'https://www.irs.gov/newsroom/qualified-business-income-deduction')
ON CONFLICT (year, key) DO NOTHING;

-- ── kb_parameters (Knowledge Base §9 — advisory math defaults) ───────────────
CREATE TABLE IF NOT EXISTS public.kb_parameters (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key          text NOT NULL UNIQUE,
  value        numeric NOT NULL,
  description  text,
  source       text,
  verified_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.kb_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read kb parameters" ON public.kb_parameters;
CREATE POLICY "authenticated read kb parameters"
  ON public.kb_parameters FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

INSERT INTO public.kb_parameters (key, value, description, source) VALUES
  ('gamma_default',                3,     'Risk aversion (range 2-4)', 'Merton calibration'),
  ('equity_risk_premium',          0.045, 'Long-run ERP', 'Consensus'),
  ('sigma_equity',                 0.17,  'Long-run equity vol', 'Consensus'),
  ('kelly_fraction_default',       0.25,  'Quarter-Kelly institutional standard', 'Thorp / MacLean-Thorp-Ziemba'),
  ('kelly_fraction_max',           0.376, 'Max Kelly at 5% chance of 50% DD', 'Thorp drawdown formula'),
  ('tipp_floor_k',                 0.85,  'TIPP ratcheting floor fraction', 'Estep-Kritzman 1988'),
  ('tipp_multiplier_equity',       3,     'CPPI multiplier, equities/forex', 'Estep-Kritzman'),
  ('tipp_multiplier_crypto',       2,     'CPPI multiplier, crypto/prediction markets (gap risk 1/m)', 'Estep-Kritzman + gap risk'),
  ('vol_brake_threshold',          1.5,   'Realized/target vol ratio that triggers de-risk', 'Moreira-Muir 2017 (brake only)'),
  ('rebalance_band_relative',      0.20,  'Relative drift band', 'Daryanani 2007'),
  ('rebalance_check_days',         10,    'Band check cadence, trading days', 'Daryanani 2007'),
  ('bankroll_ratchet_multiple',    2,     'Sweep profits above this multiple of initial bankroll', 'Practitioner (TIPP-justified)'),
  ('bankroll_ratchet_sweep_pct',   0.5,   'Fraction of above-multiple profits swept', 'Practitioner'),
  ('sleeve_cap_mass_market',       0.05,  'Speculative sleeve cap, <$100k investable', 'KB §1'),
  ('sleeve_cap_mass_affluent',     0.10,  'Speculative sleeve cap, $100k-$1M', 'KB §1'),
  ('sleeve_cap_hnw',               0.10,  'Speculative sleeve cap, $1M-$5M', 'KB §1'),
  ('emergency_months_w2',          3,     'Emergency fund months, stable W-2', 'Planner consensus'),
  ('emergency_months_family',      6,     'Emergency fund months, family/single income', 'Planner consensus'),
  ('emergency_months_self_employed', 9,   'Emergency fund months, self-employed', 'Planner consensus'),
  ('debt_payoff_hurdle_apr',       0.06,  'Debt APR above which payoff beats investing', 'Expected-equity-return crossover'),
  ('tipp_cushion_alert_pct',       0.25,  'Sweep trigger: cushion below this fraction of peak cushion', 'KB §6.1'),
  ('scorp_min_profit',             80000, 'S-corp rule trigger: minimum net SE profit', 'Advisory brief R1'),
  ('scorp_min_savings',            3000,  'S-corp rule trigger: minimum estimated net savings', 'Advisory brief R1'),
  ('scorp_payroll_cost_low',       500,   'Payroll service cost estimate, low', 'Advisory brief R1'),
  ('scorp_payroll_cost_high',      1200,  'Payroll service cost estimate, high', 'Advisory brief R1'),
  ('scorp_contraindicated_profit', 50000, 'Below this profit, overhead eats S-corp savings', 'Advisory brief R1'),
  ('scorp_min_reasonable_salary',  40000, 'Floor for the modeled reasonable salary', 'Advisory brief R1'),
  ('scorp_reasonable_salary_factor', 0.4, 'Modeled reasonable salary as fraction of profit', 'Advisory brief R1 ($60k at $150k)'),
  ('scorp_min_distribution',       20000, 'Minimum profit left after salary for election to make sense', 'Advisory brief R1'),
  ('assumed_marginal_rate',        0.22,  'Assumed federal marginal rate for benefit estimates (overridable)', 'Mid-bracket default'),
  ('roth_annual_drag_saved_rate',  0.005, 'Estimated annual taxable-drag saved per Roth dollar', 'Tax-drag estimate'),
  ('hdhp_consideration_confidence', 0.5,  'Confidence multiplier for the consider-an-HDHP card', 'Advisory brief R4'),
  ('contribution_escalator_step_pct', 1,  'Save More Tomorrow: +1%/yr contribution escalation', 'Thaler-Benartzi'),
  ('contribution_escalator_cap_pct', 15,  'Escalator cap (% of pay)', 'Planner consensus'),
  ('behavior_gap_rate',            0.012, 'Behavior gap cost estimate (fraction/yr)', 'Morningstar Mind the Gap 2025'),
  ('guardrail_max_multiplier',     3,     'Cap on personalized friction scaling (R8)', 'Remaining brief R8'),
  ('guardrail_loss_at_max_usd',    5000,  'Measured override losses at which friction caps (R8)', 'Remaining brief R8')
ON CONFLICT (key) DO NOTHING;

-- ── financial_profile ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_profile (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  filing_status             text CHECK (filing_status IN ('single','mfj','mfs','hoh')),
  age_self                  integer,
  age_spouse                integer,
  state                     text,
  business_entity           text CHECK (business_entity IN ('none','sole_prop','llc','llc_scorp','scorp','ccorp','partnership')),
  net_business_profit_usd   numeric,
  w2_wages_usd              numeric,
  prior_year_wages_usd      numeric,
  magi_estimate_usd         numeric,
  health_plan_type          text CHECK (health_plan_type IN ('hdhp','ppo','hmo','none','other')),
  monthly_essential_expenses_usd numeric,
  liquid_cash_usd           numeric,
  income_stability          text CHECK (income_stability IN ('stable_w2','variable','self_employed')),
  has_employees             boolean,
  spouse_only_employee      boolean,
  traditional_ira_balance_usd numeric,
  ytd_401k_employee_usd     numeric,
  ytd_ira_contribution_usd  numeric,
  ytd_hsa_contribution_usd  numeric,
  has_separate_business_bank boolean,
  home_office_sqft          numeric,
  business_miles_annual     numeric,
  updated_at                timestamptz DEFAULT now(),
  created_at                timestamptz DEFAULT now()
);

ALTER TABLE public.financial_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own financial profile" ON public.financial_profile;
CREATE POLICY "users own financial profile"
  ON public.financial_profile FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── advisory_log (every recommendation shown is logged) ──────────────────────
CREATE TABLE IF NOT EXISTS public.advisory_log (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rule_id                  text NOT NULL,
  rule_version             integer NOT NULL,
  status                   text NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','reviewing','in_progress','done','dismissed','not_applicable','contraindicated')),
  estimated_annual_benefit_usd numeric,
  recommendation           jsonb NOT NULL,
  profile_snapshot         jsonb NOT NULL,
  dismissed_reason         text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

ALTER TABLE public.advisory_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own advisory log" ON public.advisory_log;
CREATE POLICY "users own advisory log"
  ON public.advisory_log FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS advisory_log_user_rule_idx
  ON public.advisory_log(user_id, rule_id, created_at DESC);
