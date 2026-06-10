-- ─── tax-aware rebalancing columns ───────────────────────────────────────────
--
-- Adds tax metadata to rebalance suggestions:
--   tax_drag_usd    — estimated tax cost of executing the suggested sell
--   tax_warning     — e.g. 'short_term_gains' when the sell realizes ST gains
--   blocked_reason  — set when a suggested BUY is blocked by the wash-sale
--                     blocklist (suggestion is informational only; the
--                     execution path skips blocked suggestions)

ALTER TABLE public.rebalance_suggestions
  ADD COLUMN IF NOT EXISTS tax_drag_usd numeric,
  ADD COLUMN IF NOT EXISTS tax_warning text,
  ADD COLUMN IF NOT EXISTS blocked_reason text;
