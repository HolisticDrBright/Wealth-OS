-- Migration: register odte_strangle_hedged in user_enabled_strategies defaults
-- Strategy is default-disabled; growth/speculative profiles may enable it manually.

INSERT INTO user_enabled_strategies (strategy_key, enabled_by_default)
VALUES ('odte_strangle_hedged', false)
ON CONFLICT (strategy_key) DO NOTHING;
