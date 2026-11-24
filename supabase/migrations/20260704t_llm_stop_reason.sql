-- Model switch (Haiku 5.5 / Sonnet 5.5 / Opus 5.5): record why each call
-- stopped, so safety declines (stop_reason 'refusal') show up in the AI
-- committee report as cost without a vote.
ALTER TABLE public.llm_usage_log ADD COLUMN IF NOT EXISTS stop_reason text;
