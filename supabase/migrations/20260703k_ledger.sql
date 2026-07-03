-- ─── ledger_entries: hash-chained, tamper-evident decision ledger (R5) ───────
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL,            -- 'decision' | 'order_intent' | 'outcome'
  source_id    text NOT NULL,            -- row id in the source table
  payload_hash text NOT NULL,
  prev_hash    text NOT NULL,
  chain_hash   text NOT NULL,
  UNIQUE (kind, source_id)
);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
-- Append-only: SELECT for all, INSERT for service role, NO update/delete policies…
DROP POLICY IF EXISTS "read ledger" ON public.ledger_entries;
CREATE POLICY "read ledger" ON public.ledger_entries FOR SELECT USING (true);
DROP POLICY IF EXISTS "service appends ledger" ON public.ledger_entries;
CREATE POLICY "service appends ledger" ON public.ledger_entries FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- …and a belt-and-suspenders trigger blocking UPDATE/DELETE even for owners.
CREATE OR REPLACE FUNCTION public.ledger_entries_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_mutation ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_immutable();
