-- Roadmap #2: read-only account linking through Plaid.
--
-- Read-only products only (transactions, liabilities, investments). Nothing
-- here can move money: no Auth, Transfer or Payment products are requested.
--
-- 1. plaid_items — one row per linked login (an "Item"). Users can SEE their
--    own items; every write goes through the server (service role) after the
--    user's session is verified.
CREATE TABLE IF NOT EXISTS public.plaid_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id           text NOT NULL UNIQUE,
  institution_id    text,
  institution_name  text,
  link_kind         text NOT NULL DEFAULT 'bank' CHECK (link_kind IN ('bank','investments')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','login_required','error')),
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plaid_items_user_idx ON public.plaid_items (user_id);
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own plaid items" ON public.plaid_items;
CREATE POLICY "users read own plaid items"
  ON public.plaid_items FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service role manages plaid items" ON public.plaid_items;
CREATE POLICY "service role manages plaid items"
  ON public.plaid_items FOR ALL USING (auth.role() = 'service_role');

-- 2. plaid_item_tokens — the Item's access token, ENCRYPTED by the app
--    (AES-256-GCM, key in PLAID_TOKEN_KEY, never in the database). RLS is on
--    with NO user policy: only the service role can read or write it, so a
--    user session can never fetch a token, even its own.
CREATE TABLE IF NOT EXISTS public.plaid_item_tokens (
  item_id                  text PRIMARY KEY REFERENCES public.plaid_items(item_id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token_ciphertext  text NOT NULL,
  key_version              integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plaid_item_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages plaid tokens" ON public.plaid_item_tokens;
CREATE POLICY "service role manages plaid tokens"
  ON public.plaid_item_tokens FOR ALL USING (auth.role() = 'service_role');

-- 3. Link synced rows back to their Plaid account so a re-sync updates them
--    in place (and a removed link removes them). NULL for manual rows.
ALTER TABLE public.connected_account_profiles ADD COLUMN IF NOT EXISTS plaid_account_id text;
ALTER TABLE public.connected_account_profiles ADD COLUMN IF NOT EXISTS plaid_item_id text;
CREATE UNIQUE INDEX IF NOT EXISTS connected_account_profiles_plaid_account_uidx
  ON public.connected_account_profiles (plaid_account_id);

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS plaid_account_id text;
CREATE UNIQUE INDEX IF NOT EXISTS assets_plaid_account_uidx ON public.assets (plaid_account_id);

ALTER TABLE public.debt_accounts ADD COLUMN IF NOT EXISTS plaid_account_id text;
CREATE UNIQUE INDEX IF NOT EXISTS debt_accounts_plaid_account_uidx ON public.debt_accounts (plaid_account_id);
