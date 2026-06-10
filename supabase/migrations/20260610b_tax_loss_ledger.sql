-- ─── tax_loss_ledger: tax-loss carryforward ledger ───────────────────────────
--
-- One row per user per tax year.  Tracks realized/harvested capital losses,
-- how much was used against gains and against ordinary income (capped at
-- $3,000/yr per IRC §1211(b)), and the remaining carryforward.
--
-- The netting math (ST offsets ST first, then LT; character preserved in
-- the carryforward) lives in lib/tax/carryforward.ts — this table is the
-- persisted summary.

CREATE TABLE IF NOT EXISTS public.tax_loss_ledger (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tax_year                 integer NOT NULL,
  short_term_losses_usd    numeric NOT NULL DEFAULT 0,
  long_term_losses_usd     numeric NOT NULL DEFAULT 0,
  short_term_gains_usd     numeric NOT NULL DEFAULT 0,
  long_term_gains_usd      numeric NOT NULL DEFAULT 0,
  used_against_gains_usd   numeric NOT NULL DEFAULT 0,
  used_against_income_usd  numeric NOT NULL DEFAULT 0 CHECK (used_against_income_usd <= 3000),
  carryforward_usd         numeric NOT NULL DEFAULT 0,
  updated_at               timestamptz DEFAULT now(),
  created_at               timestamptz DEFAULT now(),
  UNIQUE (user_id, tax_year)
);

ALTER TABLE public.tax_loss_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own tax loss ledger" ON public.tax_loss_ledger;
CREATE POLICY "users own tax loss ledger"
  ON public.tax_loss_ledger
  FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS tax_loss_ledger_user_year_idx
  ON public.tax_loss_ledger(user_id, tax_year DESC);
