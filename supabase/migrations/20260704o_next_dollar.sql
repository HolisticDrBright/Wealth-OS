-- Roadmap #1: "best next dollar" on Home + the raise prompt (#6).
--
-- next_dollar_state — the few answers that have no other home:
--   no_high_interest_debt_confirmed_at  "I have no debt above 6%" (an empty
--                                       debt_accounts list alone can't say that)
--   skipped                             facts the person answered "not sure" to,
--                                       { fact_key: iso_time }, so the card moves on
--   income_baseline_usd / _at           the income we last acknowledged; a reported
--                                       income above it prompts a higher deposit
-- Everything else is stored where it already lives (financial_profile,
-- employer_benefits, debt_accounts, household_goals).
CREATE TABLE IF NOT EXISTS public.next_dollar_state (
  user_id                             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  no_high_interest_debt_confirmed_at  timestamptz,
  skipped                             jsonb NOT NULL DEFAULT '{}'::jsonb,
  income_baseline_usd                 numeric CHECK (income_baseline_usd IS NULL OR income_baseline_usd >= 0),
  income_baseline_at                  timestamptz,
  updated_at                          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.next_dollar_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own next dollar state" ON public.next_dollar_state;
CREATE POLICY "users manage own next dollar state"
  ON public.next_dollar_state FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
