-- Phase 3.1: per-user Simple/Pro mode on the existing user_ui_prefs table.
-- Unset = 'pro' (existing users keep everything they have today); the
-- onboarding wizard writes 'simple' for new users when it completes.
ALTER TABLE public.user_ui_prefs
  ADD COLUMN IF NOT EXISTS ui_mode text CHECK (ui_mode IN ('simple','pro'));
