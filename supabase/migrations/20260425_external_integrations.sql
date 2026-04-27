-- ============================================================
-- Wealth OS — External Integrations Migration
-- Adds Vibe-Trading, Camofox, and news_sentiment support.
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── 1. ai_feature_definitions — new integration entries ────────────────────

INSERT INTO public.ai_feature_definitions
  (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd)
VALUES
  (
    'vibe_trading',
    'Vibe-Trading Research Tools',
    'HKUDS multi-agent finance workspace. 17 MCP tools for backtest, factor analysis, options analysis, and pattern recognition. 16 of 17 tools work with zero API keys.',
    'premium_data',
    0.000000,
    'call',
    0.00
  ),
  (
    'camofox_scraping',
    'Camofox Anti-Detection Scraping',
    'Headless browser with C++ anti-detection for scraping rate-limited or Cloudflare-protected data sources (capitoltrades.com, Polymarket Dune, Google Trends, Reddit sentiment). Free-tier alternative to paid Quiver/Unusual Whales APIs.',
    'premium_data',
    0.005000,
    'call',
    5.00
  )
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── 2. news_sentiment table ─────────────────────────────────────────────────
--
-- Populated by sync-news-sentiment worker (Reddit + X.com scrape via Camofox).
--
CREATE TABLE IF NOT EXISTS public.news_sentiment (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  symbol       text NOT NULL,
  source       text NOT NULL CHECK (source IN ('reddit', 'x', 'hn', 'news', 'manual')),
  title        text,
  body         text,
  url          text,
  sentiment    text CHECK (sentiment IN ('bullish', 'bearish', 'neutral')),
  score        numeric CHECK (score BETWEEN -1 AND 1),
  mention_count integer DEFAULT 1,
  upvotes      integer,
  scraped_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.news_sentiment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated users read sentiment" ON public.news_sentiment;
CREATE POLICY "authenticated users read sentiment"
  ON public.news_sentiment FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "service role manages sentiment" ON public.news_sentiment;
CREATE POLICY "service role manages sentiment"
  ON public.news_sentiment FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS news_sentiment_symbol_idx
  ON public.news_sentiment(symbol, scraped_at DESC);
CREATE INDEX IF NOT EXISTS news_sentiment_source_idx
  ON public.news_sentiment(source, scraped_at DESC);

-- ─── 3. integration_health_log ───────────────────────────────────────────────
--
-- Records health check results for each external integration.
--
CREATE TABLE IF NOT EXISTS public.integration_health_log (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at     timestamptz DEFAULT now(),
  integration    text NOT NULL,
  status         text NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
  latency_ms     integer,
  error_message  text,
  metadata       jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS integration_health_log_idx
  ON public.integration_health_log(integration, checked_at DESC);

-- ─── 4. user_telemetry_events ────────────────────────────────────────────────
--
-- Lightweight click/interaction telemetry for dashboard cards.
--
CREATE TABLE IF NOT EXISTS public.user_telemetry_events (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event        text NOT NULL,
  properties   jsonb DEFAULT '{}'
);

ALTER TABLE public.user_telemetry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users insert own telemetry" ON public.user_telemetry_events;
CREATE POLICY "users insert own telemetry"
  ON public.user_telemetry_events FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "service role reads telemetry" ON public.user_telemetry_events;
CREATE POLICY "service role reads telemetry"
  ON public.user_telemetry_events FOR SELECT USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS telemetry_event_idx
  ON public.user_telemetry_events(event, created_at DESC);

-- ─── 5. agent_performance_logs ───────────────────────────────────────────────
--
-- A/B comparison log for AutoHedge-distilled vs native CIO prompts.
--
CREATE TABLE IF NOT EXISTS public.agent_performance_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name      text NOT NULL,
  prompt_variant  text NOT NULL DEFAULT 'native',
  scenario        jsonb NOT NULL,
  decision        text,
  reasoning       text,
  score           numeric,
  latency_ms      integer,
  metadata        jsonb DEFAULT '{}'
);

ALTER TABLE public.agent_performance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own performance logs" ON public.agent_performance_logs;
CREATE POLICY "users read own performance logs"
  ON public.agent_performance_logs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service role manages performance logs" ON public.agent_performance_logs;
CREATE POLICY "service role manages performance logs"
  ON public.agent_performance_logs FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS agent_perf_variant_idx
  ON public.agent_performance_logs(agent_name, prompt_variant, created_at DESC);
