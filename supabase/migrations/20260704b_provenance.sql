-- ─── Relational provenance (W6) ───────────────────────────────────────────────
-- decision → order intent → outcome become REAL foreign keys instead of
-- json-metadata breadcrumbs, so the tape/ledger can join relationally.

ALTER TABLE public.order_intents
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.decision_log(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_intents_decision_idx
  ON public.order_intents(decision_id)
  WHERE decision_id IS NOT NULL;

ALTER TABLE public.outcome_log
  ADD COLUMN IF NOT EXISTS order_intent_id uuid REFERENCES public.order_intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS outcome_log_order_intent_idx
  ON public.outcome_log(order_intent_id)
  WHERE order_intent_id IS NOT NULL;
