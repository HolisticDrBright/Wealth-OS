-- Patch: add 'neutral' to direction CHECK constraints.
-- Run this if you already applied 20260428_paper_trading.sql.

ALTER TABLE public.paper_positions
  DROP CONSTRAINT IF EXISTS paper_positions_direction_check;
ALTER TABLE public.paper_positions
  ADD CONSTRAINT paper_positions_direction_check
  CHECK (direction IN ('long', 'short', 'neutral'));

ALTER TABLE public.paper_trades
  DROP CONSTRAINT IF EXISTS paper_trades_direction_check;
ALTER TABLE public.paper_trades
  ADD CONSTRAINT paper_trades_direction_check
  CHECK (direction IN ('long', 'short', 'neutral'));
