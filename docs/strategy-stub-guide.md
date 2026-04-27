---
title: "Strategy Signal Logic — Stub Implementation Guide"
aliases: ["Signal logic", "Stub fix", "detectOpportunities recipes"]
tags:
  - type/reference
  - type/architecture
  - asset/multi-asset
  - asset/stocks
  - asset/crypto
  - asset/forex
  - wealth-os
  - status/active
created: 2026-04-24
updated: 2026-04-24
up: "[[Multi-Asset Agent Architecture]]"
related:
  - "[[Claude Code Build Prompts - Wealth OS Update]]"
  - "[[Stocks Master Strategy Playbook]]"
  - "[[Crypto Master Strategy Playbook]]"
  - "[[Forex Master Strategy Playbook]]"
---

# Strategy Signal Logic — Stub Implementation Guide

> **Context:** Claude Code reports most strategies are stubs returning empty arrays from `detectOpportunities()`. This note maps every strategy to its expected fire cadence and explicit signal logic so the stubs can be filled in deterministically.

---

## Critical insight first

**"0 opportunities found" is CORRECT for many strategies.** Different strategies fire at very different cadences:

| Cadence | Realistic fire frequency | Strategies in this bucket |
|---|---|---|
| **Continuous** (sub-second) | many per minute | cex_latency_arb, triangular_arb, memecoin_bondingcurve |
| **Continuous** (minute-bar) | a few per hour | funding_basis_arb, liquidation_hunting, polymarket_*, ict_smc |
| **Hourly** | 0-3 per day | onchain_signal, autopilot_congressional |
| **Daily EOD** | 0-2 per day | vcp_minervini, fx_trendfollowing, session_breakout, gamma_exposure |
| **Weekly** | 0-3 per week | cot_positioning, narrative_rotation, defi_yield, airdrop_farming, spinoff, merger_arb |
| **Monthly** | 0-1 per month | quant_momentum, dca_halving rebalance |
| **Quarterly** | 0-1 per quarter | qvm_multifactor, dividend_aristocrat, sector_rotation rebalance |
| **Event-driven** | 0-1 per week typically | macro_news_event, cb_divergence, pead, options_wheel |
| **Macro / regime-driven** | 0-1 per quarter | tail_risk_hedging |

So when you click "Run Paper Pass" on a Tuesday at 11am ET, expecting `quant_momentum` (monthly) or `cot_positioning` (Friday EOD) to fire is unreasonable. **0 opportunities ≠ broken strategy.** Broken means: condition is met but strategy doesn't fire.

The fix: properly implement the signal logic for each, then the *only* strategies that show 0 opportunities are the ones whose conditions genuinely aren't met right now.

---

## How to read this guide

Each strategy below has:
- **Cadence** — how often the agent should run `detectOpportunities`
- **Trigger** — the specific condition that produces a non-empty result
- **Data sources** — exactly what to fetch
- **Pseudo-code** — implementation skeleton ready to convert
- **Expected fire frequency** — what's normal

When the cadence is "weekly" or "monthly," the agent should still RUN often (e.g., hourly), but `detectOpportunities` should *check the calendar/regime* and short-circuit return `[]` if it's not a rebalance day. That's not a stub — that's correct behavior.

---

# STOCKS (12 strategies)

## 1. vcp_minervini — daily EOD scan

**Cadence:** Run after 4pm ET market close.
**Trigger:** Stage 2 universe → RS rank ≥ 80 → VCP pattern → today is breakout day with volume confirmation.
**Data sources:** Polygon.io daily OHLCV + 50/150/200 DMA + IBD RS rank.
**Expected:** 0–5 candidates per day in trending markets, 0 in choppy/down markets.

```
async detectOpportunities(context):
  if regime != 'trend-up': return []   // skip in chop or downtrend
  if not afterMarketClose(): return []

  candidates = await polygon.screener({
    sma200_above_sma50: false,           // 50 must be ABOVE 150
    sma50_above_sma150: true,
    sma150_above_sma200: true,
    sma200_slope_30d: '> 0',
    market_cap_min: 500_000_000,
    avg_volume_min: 500_000,
    ipo_date_before: now - 2years
  })

  results = []
  for candidate in candidates:
    if rsRank(candidate) < 80: continue
    pattern = detectVCP(candidate.daily_ohlcv_last_60d)
    if pattern.contractions < 2 or pattern.last_contraction_pct > 10: continue
    if candidate.today.volume < 1.4 * candidate.avg_volume_20d: continue
    if candidate.today.close <= pattern.pivot: continue
    if candidate.today.close <= candidate.sma_20: continue

    results.push({
      strategyKey: 'vcp_minervini',
      symbol: candidate.symbol,
      side: 'long',
      entryPrice: candidate.today.close,
      stopPrice: max(candidate.today.close * 0.93, pattern.last_swing_low),
      target1: candidate.today.close * 1.10,
      target2: candidate.today.close * 1.20,
      reasoning: `Stage 2, RS ${rsRank}, ${pattern.contractions} contractions, breakout +${volPct}% vol`,
      edge: 'technical'
    })
  return results
```

---

## 2. quant_momentum — monthly screen, quarterly rebalance

**Cadence:** Compute monthly. Rebalance only on first business day of quarter.
**Trigger:** Top decile of 12-1 month momentum z-score.
**Data sources:** Polygon.io 12-month historical close.
**Expected:** Empty `[]` on non-rebalance days. Up to ~50 candidates on rebalance day.

```
async detectOpportunities(context):
  today = now()
  if not isFirstBusinessDayOfQuarter(today) and not portfolioDriftExceeds(15%):
    return []

  universe = russell1000.filter(c => c.sector not in ['Financials','Utilities'])
  for c in universe:
    c.return_12_1 = priceReturn(c, t-12mo, t-1mo)
    c.smoothness = abs(c.return_12_1) / volatility(c, 12mo)

  zscored = zscore(universe, 'return_12_1')
  zscored = zscored.filter(c => c.smoothness > percentile(20))  // drop bottom quintile
  topDecile = zscored.topPercentile(10)

  return topDecile.map(c => ({
    strategyKey: 'quant_momentum',
    symbol: c.symbol,
    side: 'long',
    entryPrice: c.last_close,
    stopPrice: null,           // factor portfolio, no individual stops
    sizeHint: 1.0 / topDecile.length,
    reasoning: `Top decile 12-1 momentum, z=${c.z}, smoothness ${c.smoothness}`,
    edge: 'technical'
  }))
```

---

## 3. qvm_multifactor — quarterly rebalance

**Cadence:** First business day of quarter ONLY.
**Trigger:** Top decile of composite Quality + Value + Momentum z-score.
**Expected:** Empty 364 days/year. Up to ~50 candidates on the one rebalance day.

```
async detectOpportunities(context):
  if not isFirstBusinessDayOfQuarter(now()): return []

  for c in universe:
    c.value_z = zscore(composite([c.ep, c.bp, c.fcf_ev, c.ebitda_ev]))
    c.momentum_z = zscore(c.return_12_1)
    c.quality_z = zscore(composite([c.roic, c.margin_stability, -c.debt_equity, c.fcf_trend]))
    c.composite = mean([c.value_z, c.momentum_z, c.quality_z])

  return universe.topPercentile(10, 'composite').map(buildOpportunity)
```

---

## 4. dividend_aristocrat — quarterly review

**Cadence:** First business day of quarter.
**Trigger:** Universe membership change OR new aristocrat addition OR existing holding fails filter.
**Expected:** Empty most days. 0–3 changes per quarter.

```
async detectOpportunities(context):
  if not isFirstBusinessDayOfQuarter(now()): return []

  aristocrats = sp500_aristocrats()  // 25+ years of dividend increases
  filtered = aristocrats.filter(c =>
    c.payout_ratio_earnings < 0.70 &&
    c.payout_ratio_fcf < 0.80 &&
    c.dividend_yield >= 0.015 &&
    c.dividend_yield <= 0.06 &&
    c.dgr_5yr >= 0.07
  )
  newAdds = filtered.notIn(currentHoldings)
  return newAdds.map(buildOpportunity)
```

---

## 5. sector_rotation — monthly + on macro regime triggers

**Cadence:** First business day of month, OR on yield curve flip / PMI cross 50 / HY OAS widens > 100 bps in a month.
**Trigger:** Phase change (early/mid/late/recession) requires new sector allocation.
**Expected:** Empty most days. Fires ~6–12 times/year.

```
async detectOpportunities(context):
  triggers = [
    isFirstBusinessDayOfMonth(now()),
    yieldCurveJustFlipped(),
    pmiCrossed50(),
    hyOasWidened100bps(),
    pmiCrossed55()
  ]
  if not any(triggers): return []

  phase = detectPhase(macro)  // 'early' | 'mid' | 'late' | 'recession'
  targetWeights = SECTOR_PHASE_MATRIX[phase]
  drifts = computeDrift(currentHoldings, targetWeights)
  if max(abs(drifts)) < 0.05: return []   // 5pp threshold

  return drifts.filter(d => abs(d.diff) >= 0.05).map(d => ({
    strategyKey: 'sector_rotation',
    symbol: d.etf,
    side: d.diff > 0 ? 'long' : 'short',
    sizeHint: abs(d.diff),
    reasoning: `Phase ${phase}: target ${d.target}%, current ${d.current}%, diff ${d.diff}%`,
    edge: 'macro'
  }))
```

---

## 6. pead — daily during earnings season

**Cadence:** Run nightly during earnings season. Within 1 trading day of an earnings event.
**Trigger:** EPS beat ≥ 5% AND revenue beat ≥ 5% AND raised guidance AND gap up ≥ 4% on volume ≥ 2× avg.
**Expected:** 0–8 candidates per day during earnings season. 0 outside it.

```
async detectOpportunities(context):
  todaysEarnings = earningsCalendar.recentReports(within: 1day)
  if todaysEarnings.empty: return []

  results = []
  for r in todaysEarnings:
    if r.market_cap < 2_000_000_000 or r.market_cap > 50_000_000_000: continue
    if r.eps_beat_pct < 0.05 or r.rev_beat_pct < 0.05: continue
    if not r.guidance_raised: continue
    if r.gap_pct < 0.04: continue
    if r.day_volume < 2 * r.avg_volume_20d: continue

    results.push({
      strategyKey: 'pead',
      symbol: r.symbol,
      side: 'long',
      entryPrice: r.day_close,
      stopPrice: r.day_low,
      target1: null,
      reasoning: `EPS beat ${r.eps_beat_pct*100}%, rev beat ${r.rev_beat_pct*100}%, gap +${r.gap_pct*100}%, raised guidance`,
      holdMaxDays: 60,
      edge: 'event'
    })
  return results
```

---

## 7. options_wheel — weekly position review

**Cadence:** Sunday EOD or pre-market Monday.
**Trigger:** Open CSP/CC needs roll OR new wheel candidate selected.
**Expected:** 0–5 actions per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'sunday' and dayOfWeek() != 'monday-pre-open': return []

  results = []
  for position in user.openWheelPositions:
    if position.maxProfitPct >= 0.50: results.push(closeAction(position))
    if position.dte <= 7: results.push(rollAction(position))

  for ticker in user.approvedWheelUniverse:
    if not user.hasOpenPositionOn(ticker):
      // sell new CSP
      strike = find30DeltaStrike(ticker, dte: 30-45)
      premium = optionPremium(ticker, strike, 'put')
      if premium / strike >= 0.005:  // at least 0.5% premium
        results.push({
          strategyKey: 'options_wheel',
          symbol: `${ticker}_PUT_${strike}_${expiry}`,
          side: 'short',
          entryPrice: premium,
          reasoning: `Cash-secured put, 30-delta, ${dte} DTE, ${premium/strike*100}% premium`,
          edge: 'fundamental'
        })
  return results
```

---

## 8. gamma_exposure — pre-market + intraday

**Cadence:** Pre-market 8:30am ET + 30min intraday checks.
**Trigger:** Significant change in gamma flip OR breach of gamma wall.
**Expected:** 0–3 setups per day.

```
async detectOpportunities(context):
  gex = await spotGammaApi.fetchSpxGex()
  if abs(gex.totalGex - lastSnapshot.totalGex) < 0.5e9: return []  // not enough movement

  spxNow = await marketData.spx()
  results = []

  if gex.totalGex > 0 and spxNow > gex.flipStrike:
    // mean-revert regime — sell strangles near walls
    results.push(strangleSellAt(gex.callWall, gex.putWall))

  if gex.totalGex < 0 and spxNow < gex.flipStrike:
    // amplify regime — buy debit spread in trend direction
    direction = spxNow > sma20 ? 'long' : 'short'
    results.push(debitSpread(spxNow, direction))

  return results
```

---

## 9. merger_arb — weekly screen + daily monitoring

**Cadence:** Weekly EDGAR screen + daily news monitoring on existing positions.
**Trigger:** Newly announced friendly deal with annualized spread > 8% after estimated regulatory haircut.
**Expected:** 0–3 new candidates per week, 0 most days.

```
async detectOpportunities(context):
  newDeals = sec.recentDefinitiveAgreements(within: 7days)
  results = []
  for deal in newDeals:
    if deal.target_market_cap < 500_000_000: continue
    if deal.target_share_price < 5: continue
    if deal.is_hostile: continue
    spread_pct = (deal.deal_price - deal.target_current_price) / deal.target_current_price
    days_to_close = deal.expected_close - now()
    annualized_spread = spread_pct * (365 / days_to_close)
    regulatory_haircut = estimateRegulatoryRisk(deal)  // 0–5% typically
    if annualized_spread - regulatory_haircut < 0.08: continue

    results.push({
      strategyKey: 'merger_arb',
      symbol: deal.target,
      side: 'long',
      entryPrice: deal.target_current_price,
      stopPrice: deal.target_current_price * 0.85,
      target1: deal.deal_price,
      reasoning: `Annualized spread ${(annualized_spread*100).toFixed(1)}%, ${days_to_close} days to close`,
      edge: 'event'
    })
  return results
```

---

## 10. spinoff — weekly EDGAR scan

**Cadence:** Weekly EDGAR scan (Form 10 / 10-12B).
**Trigger:** Upcoming spin-off ≥ 10% of parent market cap, or recently distributed spin-off.
**Expected:** 0–2 candidates per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'monday': return []   // weekly only
  filings = sec.form10Filings(within: 7days)
  results = []
  for filing in filings:
    if filing.spinoff_size_pct_parent < 0.10: continue
    if not balanceSheetReasonable(filing): continue
    if not businessCoherent(filing): continue
    results.push(buildSpinoffOpportunity(filing))
  return results
```

---

## 11. tail_risk_hedging — weekly review + on vol spike

**Cadence:** Sunday EOD weekly. Plus on VIX > 30 spike.
**Trigger:** Existing puts decayed < 20% of cost (roll), OR puts up 5× (take profit), OR no current hedge.
**Expected:** 0–1 actions per week typically. 0 most days.

```
async detectOpportunities(context):
  weekly = dayOfWeek() == 'sunday'
  spike = await vix() > 30
  if not weekly and not spike: return []

  results = []
  if user.hedgeSleeveSize() < 0.02:  // less than 2% of book
    results.push(addHedge('SPX', dte: 90-180, otm: 0.20))

  for put in user.openPuts:
    if put.currentValue / put.cost < 0.20: results.push(roll(put))
    if put.currentValue / put.cost > 5.0: results.push(takeHalf(put))

  return results
```

---

## 12. autopilot_congressional — daily PTR scrape

**Cadence:** Daily at 4pm ET.
**Trigger:** New PTR filing where filer has positive 12-month alpha vs SPY AND trade size in top decile of filer's history AND ticker market cap > $1B AND filing lag ≤ 20 days.
**Expected:** 0–3 candidates per day on most days, more on disclosure-heavy days.

```
async detectOpportunities(context):
  newPtrs = await scrapeSecPtrs(within: 1day)
  results = []
  for ptr in newPtrs:
    if ptr.filing_lag_days > 20: continue
    if ptr.ticker_market_cap < 1_000_000_000: continue
    if ptr.filer_alpha_12m_vs_spy < 0: continue
    filerHistory = await scrapeFilerHistory(ptr.filer)
    if ptr.trade_size_usd < percentile(filerHistory, 90): continue

    results.push({
      strategyKey: 'autopilot_congressional',
      symbol: ptr.ticker,
      side: ptr.action == 'buy' ? 'long' : 'short',
      entryPrice: marketPrice(ptr.ticker),
      reasoning: `${ptr.filer} top-decile ${ptr.action}, lag ${ptr.filing_lag_days}d, alpha+${ptr.filer_alpha_12m_vs_spy*100}%`,
      holdMaxDays: 90,
      edge: 'flow'
    })
  return results
```

---

# CRYPTO (8 strategies — fix the 6 stubs)

## 1. dca_halving — weekly DCA + cycle overlay

**Cadence:** Weekly DCA pulse + daily cycle check.
**Trigger:** Always fires DCA tranche on schedule. Cycle overlay fires only on Pi Cycle / MVRV / Trends confluence.
**Expected:** 1 small DCA action per week + occasional larger distribute/accumulate.

```
async detectOpportunities(context):
  results = []
  if isWeeklyDCADay():
    results.push({ symbol: 'BTC-USD', side: 'long', sizeHint: user.weeklyDcaPct })
    results.push({ symbol: 'ETH-USD', side: 'long', sizeHint: user.weeklyDcaPct })

  pi = await glassnode.piCycleStatus()
  mvrv = await glassnode.mvrvRatio('BTC')
  retail = await googleTrends.bitcoin()

  // distribute on top
  if pi.triggered and mvrv > 3.5 and retail.spike():
    results.push({ symbol: 'BTC-USD', side: 'sell', sizeHint: 0.20, reasoning: 'cycle peak distribute' })

  // accumulate on capitulation
  fearGreed = await fearGreedIndex()
  if mvrv < 0.8 and minerCapitulating(await cryptoQuant.minerReserves()) and fearGreed < 15:
    results.push({ symbol: 'BTC-USD', side: 'long', sizeHint: 0.15, reasoning: 'capitulation accumulate' })

  return results
```

---

## 2. onchain_signal — hourly check, 5-of-5 confluence

**Cadence:** Hourly.
**Trigger:** All 5 signals align (buy or sell side).
**Expected:** Fires rarely — confluence is the point. Maybe 0–4 times per month.

```
async detectOpportunities(context):
  mvrv = await glassnode.mvrvRatio('BTC')
  nupl = await glassnode.nupl('BTC')
  netflow30d = await cryptoQuant.exchangeNetflow('BTC', 30)
  funding = await coinglass.funding('BTC', avgAcross: 5)
  hashRibbons = await glassnode.hashRibbons()
  pi = await glassnode.piCycleStatus()
  inflowsSpiked = await cryptoQuant.exchangeInflowsSpike('BTC')

  buySignal = mvrv < 1.2 and nupl < 0.4 and netflow30d < 0 and funding <= 0 and hashRibbons.bullishCross
  sellSignal = mvrv > 3.5 and nupl > 0.75 and funding > 0.0005 and inflowsSpiked and pi.triggered

  if buySignal:
    return [{ strategyKey: 'onchain_signal', symbol: 'BTC-USD', side: 'long', sizeHint: 0.05, reasoning: '5-of-5 buy confluence', edge: 'on-chain' }]
  if sellSignal:
    return [{ strategyKey: 'onchain_signal', symbol: 'BTC-USD', side: 'sell', sizeHint: 0.50, reasoning: '5-of-5 sell confluence', edge: 'on-chain' }]
  return []
```

---

## 3. defi_yield — weekly rebalance scan

**Cadence:** Weekly.
**Trigger:** Better tier opportunity available than current allocation, OR de-peg / contagion alert.
**Expected:** 0–3 actions per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'sunday': return []
  current = user.currentDefiAllocations
  available = await defiLlama.yields()
  results = []

  for tier in ['tier1', 'tier2', 'tier3', 'tier4']:
    bestNew = available.filter(p => p.tier == tier).sortBy('apy').filter(passesAuditFilter).first()
    bestCurrent = current.filter(p => p.tier == tier).sortBy('apy').first()
    if bestNew and (not bestCurrent or bestNew.apy > bestCurrent.apy * 1.2):
      results.push({
        strategyKey: 'defi_yield',
        symbol: bestNew.protocolToken,
        side: 'long',
        sizeHint: tierAllocation(tier),
        reasoning: `Switch ${tier}: ${bestCurrent?.protocol || 'none'} ${bestCurrent?.apy*100||0}% -> ${bestNew.protocol} ${bestNew.apy*100}%`,
        edge: 'fundamental'
      })

  // depeg alert
  for stable in ['USDC','USDT','DAI']:
    if abs(await stablecoinPrice(stable) - 1.00) > 0.01:
      results.push({ symbol: stable, side: 'sell', sizeHint: 1.0, reasoning: 'depeg risk', edge: 'fundamental' })
  return results
```

---

## 4. narrative_rotation — weekly narrative scan

**Cadence:** Weekly.
**Trigger:** New narrative emerging (CT mindshare growing, Token Terminal fees rising, Artemis flows shifting).
**Expected:** 0–2 entries per week typically. More during heavy narrative cycles.

```
async detectOpportunities(context):
  if dayOfWeek() != 'monday': return []
  narratives = await tokenTerminal.fastestGrowingSectors(7days)
  trends = await googleTrends.cryptoNarratives()
  flows = await artemis.crossChainFlows(7days)

  rising = narratives.filter(n =>
    n.fee_growth_7d > 0.50 and
    trends[n].slope > 0 and
    flows[n].net > 0
  )

  results = []
  for narrative in rising.top(3):
    winners = narrative.tokens
      .filter(t => t.dau > 10000 and t.audited and t.market_cap > 100_000_000)
      .sortBy('fees_30d')
      .top(2)
    for token in winners:
      // exit triggers checked elsewhere
      results.push({
        strategyKey: 'narrative_rotation',
        symbol: token.symbol,
        side: 'long',
        sizeHint: 0.02,            // 2% per name, accept long tail of losers
        reasoning: `Narrative ${narrative.name}, fee growth ${narrative.fee_growth_7d*100}%, token rank ${token.rank}`,
        edge: 'sentiment'
      })
  return results
```

---

## 5. liquidation_hunting — continuous

**Cadence:** Continuous (1-minute bar).
**Trigger:** Cluster sweep + reversal wick after high OI + high funding.
**Expected:** 0–5 setups per day depending on volatility.

```
async detectOpportunities(context):
  oi = await coinglass.openInterest('BTC')
  funding = await coinglass.funding('BTC', avgAcross: 5)
  if funding < 0.0003: return []   // not crowded enough
  if oi.percentile90d < 0.8: return []   // OI must be elevated

  liqMap = await coinglass.liquidationHeatmap('BTC')
  cluster = liqMap.nearestClusterAbove(spotNow) || liqMap.nearestClusterBelow(spotNow)
  if not cluster: return []
  if not priceJustWickedThrough(cluster, lookback: 5min): return []

  // wait for the reversal wick to confirm
  if not reversalWickConfirmed(spotNow, cluster, lookback: 2min): return []

  return [{
    strategyKey: 'liquidation_hunting',
    symbol: 'BTC-USD',
    side: cluster.side == 'long-liquidations' ? 'short' : 'long',
    entryPrice: spotNow,
    stopPrice: cluster.extreme,
    target1: liqMap.oppositeCluster.price,
    sizeHint: 0.005,    // small - high skill, low size
    reasoning: `${cluster.side} cluster swept at ${cluster.price}, reversal wick confirmed`,
    edge: 'flow'
  }]
```

---

## 6. airdrop_farming — weekly check

**Cadence:** Weekly.
**Trigger:** New points program OR Pendle YT yield exceeds threshold OR existing farm approaching TGE.
**Expected:** 0–2 actions per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'monday': return []

  results = []
  newProgs = await earnify.newPointsPrograms(within: 7days)
  for prog in newProgs.filter(passesAuditFilter):
    results.push(depositTier1Action(prog))

  pendleYt = await pendle.ytYields()
  for token in pendleYt.filter(y => y.impliedYield > 0.20):
    results.push(buyYtAction(token))

  approachingTge = user.farmedProtocols.filter(p => p.expectedTge < 14days)
  for p in approachingTge:
    results.push(prepareForTgeExitAction(p))

  return results
```

---

## 7. memecoin_bondingcurve — copy-trade pattern, continuous

**Cadence:** Continuous (WebSocket on tracked wallets).
**Trigger:** Tracked wallet executes a buy AND filters pass.
**Expected:** 0–20 mirrored trades per day depending on tracked wallet activity.

```
async detectOpportunities(context):
  // event-driven; this is called from a webhook, not polled
  trade = context.incomingWalletTrade
  if not trade.maker_address in user.followedSolanaWallets: return []
  if trade.market_cap < 50_000: return []   // skip pure dust
  if trade.tax_pct > 0.05: return []         // skip honeypots
  if trade.deployer_history_rugs > 0: return []

  return [{
    strategyKey: 'memecoin_bondingcurve',
    symbol: trade.token,
    side: 'long',
    entryPrice: trade.executed_price * 1.02,   // accept 2% slippage
    stopPrice: trade.executed_price * 0.85,
    target1: trade.executed_price * 2.0,
    sizeHint: 0.002,       // 0.2% per trade, expect long tail of zeros
    reasoning: `Copy-trade ${trade.maker_address.short()}, ${trade.token} at ${trade.executed_price}`,
    edge: 'flow'
  }]
```

---

# FOREX (9 strategies — all stubs)

## 1. ict_smc — kill-zone discretionary

**Cadence:** Continuous during 3 kill zones (3-4 NY, 10-11 NY, 14-15 NY).
**Trigger:** Liquidity sweep + displacement + retracement into FVG.
**Expected:** 0–3 setups per kill zone, so 0–9 per day.

```
async detectOpportunities(context):
  if not inAnyKillZone(now()): return []
  pair = currentMonitoredPair  // EURUSD, GBPUSD, etc.
  htfBias = await getHigherTimeframeBias(pair, 'D1')

  swing = await getRecentSwing(pair, '5m', lookback: 60min)
  if not swing.justSwept(now(), within: 5min): return []   // need fresh sweep

  displacement = await getDisplacement(pair, '5m', after: swing.sweep_time)
  if displacement.atrMultiple < 1.5: return []   // weak displacement
  if displacement.direction != opposite(swing.sweep_direction): return []

  fvg = await getMostRecentFvg(pair, '5m', after: displacement.time, direction: displacement.direction)
  if not fvg.priceCurrentlyRetraced: return []

  return [{
    strategyKey: 'ict_smc',
    symbol: pair,
    side: displacement.direction,
    entryPrice: fvg.midpoint,
    stopPrice: swing.sweep_extreme,
    target1: getOppositeLiquidity(pair).price,
    reasoning: `${killZoneName()} sweep + displacement ${displacement.atrMultiple}x ATR + FVG retrace`,
    edge: 'technical'
  }]
```

---

## 2. carry_trade — weekly review

**Cadence:** Weekly Friday EOD.
**Trigger:** G10 ranking changed enough to require rebalance, OR risk-off filter flipped.
**Expected:** 0–1 rebalance per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'friday' or hour() < 16: return []

  vix = await vix()
  if vix > 25:
    return [{ action: 'flatten', reason: 'risk-off', edge: 'macro' }]   // unwind carry

  g10 = ['USD','EUR','JPY','GBP','CHF','CAD','AUD','NZD','SEK','NOK']
  ranked = sortBy(g10, c => realRate(c) = (await shortRate(c)) - (await inflation(c)))

  longs = ranked.slice(-3)         // top 3 real rates
  shorts = ranked.slice(0, 3)      // bottom 3
  if same_as_current_carry_book(longs, shorts): return []   // no rebalance needed

  results = []
  for long_ccy in longs:
    for short_ccy in shorts:
      pair = `${long_ccy}${short_ccy}`
      vol = await pairVolatility30d(pair)
      results.push({
        strategyKey: 'carry_trade',
        symbol: pair,
        side: 'long',
        sizeHint: 1 / (vol * longs.length * shorts.length),  // inverse-vol
        reasoning: `Carry: long ${long_ccy} (real rate ${realRate(long_ccy)}%) vs ${short_ccy}`,
        edge: 'macro'
      })
  return results
```

---

## 3. cot_positioning — weekly Friday EOD

**Cadence:** Weekly Friday EOD (after CFTC release).
**Trigger:** COT Index > 90 (fade) or < 10 (buy) + weekly candle reversal + structure break.
**Expected:** 0–3 per week.

```
async detectOpportunities(context):
  if dayOfWeek() != 'friday' or hour() < 17: return []  // CFTC publishes mid-afternoon

  results = []
  for pair in MAJOR_FX_PAIRS:
    cot = await cftc.cotReport(pair)
    cotIndex = cot.computeIndex(lookback: 156weeks)  // 3-year percentile
    weeklyClose = await pairWeeklyClose(pair)

    if cotIndex > 90 and weeklyClose.bearishReversal and structureBroke('bearish', pair):
      results.push({ strategyKey: 'cot_positioning', symbol: pair, side: 'short', reasoning: `COT Index ${cotIndex} fade + reversal`, edge: 'flow' })
    if cotIndex < 10 and weeklyClose.bullishReversal and structureBroke('bullish', pair):
      results.push({ strategyKey: 'cot_positioning', symbol: pair, side: 'long', reasoning: `COT Index ${cotIndex} buy + reversal`, edge: 'flow' })
  return results
```

---

## 4. cb_divergence — pre/post CB meetings

**Cadence:** Daily check; only fires within 7 days of a major CB meeting.
**Trigger:** Two CBs in opposite policy stances (one hiking + hawkish, the other cutting + dovish).
**Expected:** 0–3 entries per month (around meetings).

```
async detectOpportunities(context):
  upcomingCbs = await forexFactory.cbMeetings(within: 7days)
  if upcomingCbs.empty: return []

  cbStates = await getCbStates()  // {fed: 'hiking_hawkish', ecb: 'cutting_dovish', ...}
  divergent = findDivergentPairs(cbStates)
  results = []
  for pair_pair in divergent:
    pair = `${pair_pair.hawkish_ccy}${pair_pair.dovish_ccy}`
    results.push({
      strategyKey: 'cb_divergence',
      symbol: pair,
      side: 'long',
      sizeHint: 0.02,
      reasoning: `${pair_pair.hawkish_ccy} ${cbStates[pair_pair.hawkish_ccy.toLowerCase()]} vs ${pair_pair.dovish_ccy} ${cbStates[pair_pair.dovish_ccy.toLowerCase()]}`,
      edge: 'macro'
    })
  return results
```

---

## 5. session_breakout — daily at London open

**Cadence:** Once daily at 03:00 NY (London open).
**Trigger:** Asia range 30-80 pips + 5-min candle close outside range + not on NFP/CPI/FOMC day + aligned with daily 20DMA.
**Expected:** 0–1 per day.

```
async detectOpportunities(context):
  if not isLondonOpen(now(), tolerance: 5min): return []
  if isHighImpactNewsDay(today()): return []

  results = []
  for pair of ['EURUSD', 'GBPUSD']:
    asia = await getAsiaRange(pair)
    rangePips = asia.high - asia.low
    if rangePips < 30 or rangePips > 80: continue

    daily20dma = await sma(pair, 'D1', 20)
    bias = currentPrice(pair) > daily20dma ? 'long' : 'short'
    breakoutDirection = lastFiveMinClose > asia.high ? 'long' : (lastFiveMinClose < asia.low ? 'short' : null)
    if not breakoutDirection or breakoutDirection != bias: continue

    results.push({
      strategyKey: 'session_breakout',
      symbol: pair,
      side: breakoutDirection,
      entryPrice: lastFiveMinClose,
      stopPrice: breakoutDirection == 'long' ? asia.low : asia.high,
      target1: breakoutDirection == 'long' ? lastFiveMinClose + rangePips : lastFiveMinClose - rangePips,
      reasoning: `Asia range ${rangePips}p, ${breakoutDirection} breakout aligned with daily ${bias}`,
      edge: 'technical'
    })
  return results
```

---

## 6. fx_trendfollowing — daily EOD

**Cadence:** Daily NY close.
**Trigger:** SMA 50/200 cross OR Donchian 20/55 breakout.
**Expected:** 0–2 entries per day across the universe.

```
async detectOpportunities(context):
  if not isNyDailyClose(): return []

  results = []
  for pair of FX_UNIVERSE:
    sma50 = await sma(pair, 'D1', 50)
    sma200 = await sma(pair, 'D1', 200)
    sma50Prev = await sma(pair, 'D1', 50, offset: 1)
    sma200Prev = await sma(pair, 'D1', 200, offset: 1)
    donchian55 = await donchian(pair, 'D1', 55)
    close = await dailyClose(pair)
    closePrev = await dailyClose(pair, offset: 1)

    bullishCross = sma50 > sma200 and sma50Prev <= sma200Prev
    bearishCross = sma50 < sma200 and sma50Prev >= sma200Prev
    upBreak = close > donchian55.high and closePrev <= donchian55.high
    downBreak = close < donchian55.low and closePrev >= donchian55.low

    side = (bullishCross or upBreak) ? 'long' : (bearishCross or downBreak ? 'short' : null)
    if not side: continue

    atr = await atr(pair, 'D1', 14)
    results.push({
      strategyKey: 'fx_trendfollowing',
      symbol: pair,
      side: side,
      entryPrice: close,
      stopPrice: side == 'long' ? close - 2.5 * atr : close + 2.5 * atr,
      sizeHint: 1 / atr,    // inverse-vol
      reasoning: `${bullishCross || bearishCross ? 'SMA cross' : 'Donchian break'} ${side}`,
      edge: 'technical'
    })
  return results
```

---

## 7. macro_news_event — within minutes of releases

**Cadence:** Continuous; only fires within 5–60 minutes of major release.
**Trigger:** Confirmed price reaction in event direction + 2nd confirming candle.
**Expected:** 0–2 entries per week.

```
async detectOpportunities(context):
  recentReleases = await economicCalendar.recentReleases(within: 60min, impact: 'high')
  if recentReleases.empty: return []

  results = []
  for r in recentReleases:
    if r.minutesAgo < 5: continue   // wait for chaos to settle
    pair = r.affectedPair         // e.g. NFP -> EURUSD via USD
    pre = await pairPriceAt(pair, r.releaseTime - 1min)
    initialDirection = await pairPriceAt(pair, r.releaseTime + 5min) > pre ? 'long' : 'short'
    secondCandleConfirms = await pairPriceAt(pair, r.releaseTime + 10min) > await pairPriceAt(pair, r.releaseTime + 5min)
      ? initialDirection == 'long'
      : initialDirection == 'short'
    if not secondCandleConfirms: continue

    atr = await atr(pair, 'M5', 14)
    results.push({
      strategyKey: 'macro_news_event',
      symbol: pair,
      side: initialDirection,
      entryPrice: currentPrice(pair),
      stopPrice: pre,
      target1: initialDirection == 'long' ? currentPrice(pair) + 1.5 * atr : currentPrice(pair) - 1.5 * atr,
      reasoning: `${r.event} reaction confirmed by second candle, ${initialDirection}`,
      edge: 'event'
    })
  return results
```

---

## 8. triangular_arb — continuous (HFT-tier infra required)

**Cadence:** Continuous (sub-second).
**Trigger:** Implied cross differs from quoted by > 5x round-trip spread + commissions.
**Expected:** 0–10 per day at retail latency, more with FIX co-location.

```
async detectOpportunities(context):
  // Triangle: A/B, B/C, A/C
  abAsk = await ecn.ask('EURUSD')
  abBid = await ecn.bid('EURUSD')
  bcAsk = await ecn.ask('GBPUSD')
  bcBid = await ecn.bid('GBPUSD')
  acAsk = await ecn.ask('EURGBP')
  acBid = await ecn.bid('EURGBP')

  impliedAcAsk = abAsk / bcBid
  impliedAcBid = abBid / bcAsk
  spreadAvg = (abAsk - abBid + bcAsk - bcBid + acAsk - acBid) / 6
  threshold = 5 * spreadAvg + commissionEstimate

  if acAsk > impliedAcAsk + threshold:
    return [{ symbol: 'EURGBP', side: 'short', otherLegs: [...], reasoning: 'tri-arb opportunity', edge: 'structural' }]
  if acBid < impliedAcBid - threshold:
    return [{ symbol: 'EURGBP', side: 'long', otherLegs: [...], reasoning: 'tri-arb opportunity', edge: 'structural' }]
  return []
```

NOTE: triangular_arb is realistically uneconomic at retail latency. Recommend leaving as scaffolded but not enabling in user_enabled_strategies.

---

## 9. correlation_divergence — daily

**Cadence:** Daily NY close.
**Trigger:** Pair-ratio z-score > 1.5σ over 60-day mean, plus correlation > 0.7 over 3 months, no CB meeting within 7 days.
**Expected:** 0–2 per week.

```
async detectOpportunities(context):
  if not isNyDailyClose(): return []
  PAIRS = [['EURUSD','GBPUSD'], ['AUDUSD','NZDUSD'], ['USDCAD','USDNOK']]

  results = []
  for [a, b] in PAIRS:
    rolling3moCorr = await rollingCorrelation(a, b, 90)
    if rolling3moCorr < 0.70: continue   // correlation broken
    if hasCbMeetingSoon(a) or hasCbMeetingSoon(b): continue
    if isHighImpactNewsWeek(a) or isHighImpactNewsWeek(b): continue

    ratio = pairPrice(a) / pairPrice(b)
    ratioMean = await rollingMean(ratio, 60)
    ratioStdev = await rollingStdev(ratio, 60)
    z = (ratio - ratioMean) / ratioStdev
    if abs(z) < 1.5: continue
    if abs(z) > 3.0: continue   // correlation likely breaking

    if z > 1.5:
      results.push({ strategyKey: 'correlation_divergence', symbol: a, side: 'short', reasoning: `${a}/${b} z=${z.toFixed(2)}`, edge: 'structural' })
      results.push({ strategyKey: 'correlation_divergence', symbol: b, side: 'long', reasoning: `${a}/${b} z=${z.toFixed(2)}`, edge: 'structural' })
    if z < -1.5:
      results.push({ strategyKey: 'correlation_divergence', symbol: a, side: 'long', reasoning: `${a}/${b} z=${z.toFixed(2)}`, edge: 'structural' })
      results.push({ strategyKey: 'correlation_divergence', symbol: b, side: 'short', reasoning: `${a}/${b} z=${z.toFixed(2)}`, edge: 'structural' })

  return results
```

---

# Claude Code prompt to fill all stubs

```
You are Claude Code in the oracle-wealth monorepo. Prompts 1-9 have run. Most strategies have stub `detectOpportunities()` methods returning empty arrays. This prompt fills them in using the deterministic signal logic in vault note `Strategy Signal Logic - Stub Implementation Guide.md` (07 - OpenClaw Wealth OS Architecture folder).

GOAL
Convert every stub `detectOpportunities()` into a fully-implemented signal function per the pseudo-code in that vault note.

CRITICAL CONSTRAINTS
- Follow the pseudo-code exactly. Where data sources require paid feature flags (Polygon L2, dexter_research, etc.), gate via FeatureFlagService.canSpend.
- For weekly/monthly/quarterly cadence strategies, the function must short-circuit return [] when not on the rebalance day. That is correct behavior, not a stub.
- For event-driven strategies, return [] when no recent event matches. That is correct behavior.
- All numeric thresholds must match the vault recipe exactly.
- Every return is an Opportunity object with strategyKey, symbol, side, entryPrice, stopPrice, target1, target2, sizeHint, reasoning, edge.

TASK 1 - Stocks (12 strategies)
Implement detectOpportunities for: vcp_minervini, quant_momentum, qvm_multifactor, dividend_aristocrat, sector_rotation, pead, options_wheel, gamma_exposure, merger_arb, spinoff, tail_risk_hedging, autopilot_congressional. Use Polygon.io as default data source. Gate gamma_exposure paid SpotGamma data behind a new feature flag spotgamma if not already present.

TASK 2 - Crypto (6 stub strategies, leave funding_basis_arb and dca_halving alone if already implemented)
Implement: onchain_signal, defi_yield, narrative_rotation, liquidation_hunting, airdrop_farming, memecoin_bondingcurve. Use Glassnode free + CryptoQuant free + Coinglass free + DefiLlama as defaults. Memecoin uses Solana RPC via Chainstack.

TASK 3 - Forex (9 strategies)
Implement all 9: ict_smc, carry_trade, cot_positioning, cb_divergence, session_breakout, fx_trendfollowing, macro_news_event, triangular_arb, correlation_divergence. Use OANDA v20 API as default data source. Pull CFTC COT from cftc.gov directly.

TASK 4 - Add cadence guards
Each strategy must check the current time/regime against its expected cadence and short-circuit return [] when not in its window. This is the difference between "no opportunity right now" (correct) and "stub" (broken).

TASK 5 - Tests
Add an integration test per strategy that:
  (a) Constructs a synthetic context where the trigger condition IS met. Asserts non-empty results.
  (b) Constructs a context where the trigger is NOT met. Asserts empty array.
  (c) Confirms the Opportunity shape matches the schema.

TASK 6 - Add a "recent fires" panel to the dashboard
apps/web/app/dashboard/strategy-fires/page.tsx showing per strategy: last fire timestamp, last fire result, expected next fire window, current cadence-gate status (in-window / out-of-window). This makes "0 opportunities" interpretable for the user.

DELIVERABLE
Show me 3 implemented strategies covering different cadences (one daily, one weekly, one event-driven), then summarize the rest. Stop when all 27 stubs are filled and tests pass.
```

---

## Key takeaway

When you click "Run Paper Pass" right now and see `0 opportunities`:

| Reason it's 0 | What to do |
|---|---|
| Strategy stub returns `[]` regardless of conditions | **Real bug.** Run the prompt above. |
| Correct cadence but trigger not met right now | **Correct behavior.** Add a "next expected fire window" indicator to the dashboard. |
| Cadence outside its window (e.g., quant_momentum on a Tuesday) | **Correct behavior.** Add an in-window/out-of-window flag to the dashboard. |
| Feature flag for required data is OFF | **Correct behavior.** Gate is working as designed. Toggle on if user wants the strategy. |

The fix for the user's confusion is **not** "force every strategy to find something" — it's making it visible WHY each one didn't fire (cadence, trigger conditions, feature flags). The dashboard panel in TASK 6 of the prompt above does that.

---

## Sources

- [[Stocks Master Strategy Playbook]] · [[Crypto Master Strategy Playbook]] · [[Forex Master Strategy Playbook]]
- All 12 stock strategy notes in `01 - Stocks/`
- All 8 crypto strategy notes in `02 - Crypto/`
- All 9 forex strategy notes in `03 - Forex/`
- [[Claude Code Build Prompts - Wealth OS Update]] (Prompt 8 was supposed to do this — this note is the cleanup)

---

**See also:** [[Multi-Asset Agent Architecture]] · [[Calibration Learning Loop]]
