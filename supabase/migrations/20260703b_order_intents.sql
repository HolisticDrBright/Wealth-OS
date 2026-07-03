-- ─── order_intents: idempotent order submission + OCO reconciliation ─────────
--
-- One row per order LEG (entry / stop / take_profit) per opportunity.
-- client_order_id is DETERMINISTIC: wos-<sha256(opportunityId:leg)[0:20]>, so a
-- retry or a concurrent worker resubmits the SAME id and the broker dedupes.
--
-- The position monitor reconciles from this table:
--   entry filled            → verify both bracket legs exist
--   stop or TP leg filled   → cancel the recorded sibling deterministically
--   entry partially filled  → reduce bracket legs to the filled quantity

CREATE TABLE IF NOT EXISTS public.order_intents (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  opportunity_id           text NOT NULL,
  client_order_id          text NOT NULL,
  leg                      text NOT NULL DEFAULT 'entry'
                           CHECK (leg IN ('entry', 'stop', 'take_profit')),
  broker                   text,
  symbol                   text,
  side                     text,
  notional_usd             numeric,
  quantity                 numeric,
  stop_price               numeric,
  limit_price              numeric,
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'submitted', 'filled',
                                             'partially_filled', 'cancelled', 'failed')),
  broker_order_id          text,
  filled_quantity          numeric,
  attempts                 integer NOT NULL DEFAULT 0,
  error                    text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (user_id, client_order_id)
);

ALTER TABLE public.order_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own order intents" ON public.order_intents;
CREATE POLICY "users own order intents"
  ON public.order_intents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS order_intents_user_opp_idx
  ON public.order_intents(user_id, opportunity_id);

CREATE INDEX IF NOT EXISTS order_intents_open_idx
  ON public.order_intents(status, updated_at DESC)
  WHERE status IN ('pending', 'submitted', 'partially_filled');
