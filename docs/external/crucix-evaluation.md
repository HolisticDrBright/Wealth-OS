# External Dependency Evaluation: Crucix On-Chain Whale Aggregator

**Evaluation date:** 2026-04-27
**Evaluator:** Automated evaluation (Wealth OS integration process)
**Website:** https://crucix.io
**Integration file:** `lib/integrations/crucix/CrucixClient.ts`
**Competing source:** Custom Polygonscan scraper in polymarket_wallet_copy

---

## Purpose

Crucix tracks large wallet movements (whales) on Polygon and EVM chains. It
is evaluated as an alternative/supplementary data source for two existing
signals:

1. **polymarket_wallet_copy** — currently scrapes Polymarket CLOB wallet flows
   via Camofox. Crucix could provide pre-labeled wallet categories.
2. **onchain_signal** — currently uses Etherscan/Polygonscan directly. Crucix
   provides aggregated net-flow signals with higher label coverage.

---

## Coverage comparison

| Metric | Crucix | Current (Polygonscan direct) |
|---|---|---|
| Chain support | Polygon, Ethereum, Arbitrum, Base | Polygon, Ethereum |
| Whale threshold | Configurable (default $50k) | Hardcoded $100k |
| Wallet labeling | ~85% known actors labeled | ~40% (CEX hot wallets only) |
| Data freshness | ~2-5 min lag | ~1 min (direct RPC) |
| Rate limit | 1,000 req/day (free) | Unlimited (own RPC node) |
| Cost | Free tier available | Infrastructure cost only |

## Latency comparison

Crucix API latency: 80-200ms (REST)
Polygonscan direct: 40-100ms (own RPC)

Verdict: Crucix is slower but provides better wallet labeling.

---

## Recommendation

**Use as supplementary source, not replacement.**

Wire Crucix as a second signal for `onchain_signal` whale sub-signal:
- If Crucix `dominantDirection` confirms the primary signal: +15% size boost
- If Crucix contradicts: -25% size reduction (same haircut as MiroFish neutral)
- If Crucix unavailable: no change (fail-open)

For `polymarket_wallet_copy`, Crucix label coverage helps distinguish:
- Known Polymarket LPs (usually providing liquidity, not taking views)
- Known MEV bots (discard)
- Unknown wallets (treat as signal)

---

## Security assessment

- [x] Read-only API (GET requests only in whale queries)
- [x] API key sent via header (X-API-Key), not URL param
- [x] No webhook or push mechanism that could be spoofed
- [x] Response is pure JSON data, no executable content
- [x] Free tier requires no billing info

**Risk rating: LOW**

---

## Re-evaluation triggers

Re-evaluate if:
- Crucix label coverage drops below 70%
- Latency exceeds 500ms consistently (>10% of calls)
- Free tier rate limits drop below 500 req/day
- API schema changes break response parsing
