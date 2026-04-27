# External Dependency Audit: CEX Latency Arbitrage Strategy

**Audit date:** 2026-04-27
**Auditor:** Automated review (Wealth OS integration process)
**Strategy file:** `lib/strategies/impl/crypto/cex-latency-arb.ts`
**Data sources:** Coinbase Advanced Trade API (public), Kraken REST API (public),
  Binance.US API (public)

---

## Architecture

The strategy fetches top-of-book from 3 venues simultaneously using public
REST endpoints (no API keys required for quote data). It detects when one venue
lags another by > 8 basis points net of estimated fees (20 bps round-trip), then
flags the opportunity for execution.

**IMPORTANT:** This strategy is delta-neutral by intent. The long leg (buy cheap)
and short leg (sell expensive) must be placed within 50ms of each other to avoid
leg risk. The 50ms window is aspirational for REST-based execution; in practice,
execution windows of 200-500ms are more realistic. Broader persistent lags (>5s)
are more reliably captured.

---

## Risk checklist

### Execution risk
- [x] Delta-neutral design: long and short legs placed simultaneously
- [x] Hard exit at 5 minutes: no overnight carry risk
- [x] Convergence monitoring: target exit at 2 bps spread
- [x] Per-leg cap: 0.25% of portfolio per leg (0.5% combined per symbol)
- [x] Hard cap: 1% of portfolio combined across all symbols
- [x] Default-disabled: requires explicit `user_enabled_strategies` opt-in
- [ ] **LEG RISK**: If one leg fills and the other fails, the position is NOT delta-neutral. Mitigation: add fill confirmation before placing second leg (TODO before live capital).
- [ ] **STALE SIGNAL**: REST polling introduces 100-200ms latency. True sub-10ms latency arb requires WebSocket and co-location. This implementation captures only persistent lags.

### Market risk
- [x] Spread validated as >= 8 bps net of fees before signaling
- [x] Estimated fees: 20 bps round-trip (conservative: Coinbase taker ~10 bps, Kraken ~10 bps)
- [ ] **FEE ACCURACY**: Actual fees depend on user's 30-day volume tier. High-volume users may face lower fees; rare adverse fills may exceed estimated fees.
- [x] Max drawdown gate: 30-day paper trade must show < 5% max drawdown before live capital

### API reliability
- [x] All 3 venues use public endpoints (no API key required for top-of-book)
- [x] AbortSignal.timeout(2000ms) on all fetches
- [x] Individual venue failure is graceful: strategy skips symbol if < 2 books returned
- [x] Binance.US unavailability is non-fatal: Coinbase vs Kraken still works

### Regulatory
- [x] Strategy is purely technical (no insider information)
- [x] Delta-neutral design avoids directional market manipulation concerns
- [ ] **JURISDICTION**: Verify Binance.US availability in user's state before enabling

---

## Promotion gate

DO NOT enable live capital until:
1. 30-day paper trade shows Sharpe > 1.5
2. 30-day paper trade shows max drawdown < 5%
3. Leg risk mitigation (fill confirmation before second leg) is implemented
4. Fee tier is confirmed against user's actual exchange fee schedule

---

## Required mitigations before live

1. Implement fill confirmation: wait for first leg ACK before placing second leg
2. Add fee tier lookup from exchange API (not hardcoded estimate)
3. Add cross-venue correlation alert: if BTC spread > 50 bps, alert (possible quote stuffing)
4. WebSocket upgrade for sub-100ms detection (REST polling only catches lags > 200ms)
