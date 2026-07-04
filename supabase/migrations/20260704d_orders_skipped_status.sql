-- ─── orders.status: add 'skipped' (paper-phase honesty) ──────────────────────
-- A broker result of 'skipped' means NO order was placed (master switch off,
-- capability block, no legal broker). It used to be stored as 'submitted',
-- which fabricated fills that never existed. Additive change only.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','submitted','open','partially_filled','filled',
                    'cancelled','rejected','expired','skipped'));

-- Historical honesty: orders whose error_message shows the paper-phase skip
-- reason but were stored as 'submitted' are corrected to 'skipped'.
UPDATE public.orders
  SET status = 'skipped'
  WHERE status = 'submitted'
    AND broker_order_id IS NULL
    AND error_message LIKE 'live trading disabled%';
