-- ─── W7: VHNW / UHNW speculative sleeve caps (KB §1 tier ladder) ─────────────
-- mass market (<$100k) 5% → mass affluent ($100k–$1M) 10% → HNW ($1M–$5M) 10%
-- → VHNW ($5M–$25M) 15% → UHNW (>$25M) 20%.

INSERT INTO public.kb_parameters (key, value, description, source) VALUES
  ('sleeve_cap_vhnw', 0.15, 'Speculative sleeve cap, $5M-$25M investable', 'KB §1'),
  ('sleeve_cap_uhnw', 0.20, 'Speculative sleeve cap, >$25M investable', 'KB §1')
ON CONFLICT (key) DO NOTHING;
