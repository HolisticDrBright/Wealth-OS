# Strategy book review (Phase 5)

Phase 5 made exactly the six moves the brief asked for and nothing else. This
table lists the strategies whose book label still looks wrong against what the
code actually does. **None of these were moved** — each is an owner decision.
"Maturity" is from `STRATEGY_REGISTRY_CONFIG`; only `paper_trading` strategies
can trade today.

| # | Strategy | Book now | Maturity | What the code does | Why the label is questionable | Suggested book |
|---|----------|----------|----------|--------------------|-------------------------------|----------------|
| 1 | `vix_term_structure` | convexity | backtest_ready | **Sells** weekly SPX 30-delta put spreads when short-dated VIX is calm (VIX < 22) | This is short volatility, i.e. carry, not crash insurance. Convexity is the one book left fully open in CRISIS, so if this is ever promoted it would be selling puts in a crash. The brief keeps it in convexity, so it stays. | carry |
| 2 | `factor_crowded_trade_fade` | convexity | stub | Never executes | The brief says convexity keeps only `tail_risk_hedging` and `vix_term_structure`, and also says move nothing else. They conflict on this stub, so it was left in place. No trading impact. | event (a crowding fade) |
| 3 | `onchain_signal` | trend | paper_trading | Goes long BTC/ETH when price is well **below** its 30-day SMA | Counter-trend mean reversion, the opposite of trend. In a sustained sell-off it adds to the same risk trend is meant to diversify. | event or speculative |
| 4 | `dca_halving` | trend | paper_trading | Buys BTC/ETH dips 15%+ below the 90-day high in chosen halving-cycle phases | Long crypto beta bought on dips. That isn't momentum, and it behaves like the riskiest part of the book. | speculative |
| 5 | `narrative_rotation` | trend | paper_trading | Buys the top coin in crypto categories up more than 3% in 24h | Short-horizon alt-coin momentum. Its risk profile is close to the memecoin strategy that moved to speculative. | speculative |
| 6 | `london_4pm_fix_endmonth` | arb | backtest_ready | Directional FX trade into and after the month-end London fix | A calendar-flow directional bet with stop risk, not an arbitrage. Arb's narrow cap assumes market-neutral spreads. | event |
| 7 | `month_end_fix` | arb | backtest_ready | Fades USD on the fix bar when the S&P vs ex-US monthly spread is more than 2% | Same as #6: directional flow, not arbitrage. Together with #6 it doubles one exposure. | event |
| 8 | `correlation_divergence` | arb | paper_trading | Pairs and correlation-convergence trades | Statistical convergence with real tail risk (pairs can keep diverging). It isn't locked-in structural arbitrage. | event (or a stat-arb sub-cap) |
| 9 | `cex_latency_arb` | arb | paper_trading | Two-venue spread capture, about 60 s to converge | The label fits, but the edge is latency. A polled-price paper simulation can't show whether it is real, so its paper record will look better than any live result. | arb (flag for track-record review) |
| 10 | `polymarket_wallet_copy` | info | paper_trading | Copies trades of high-win-rate Polymarket wallets | It follows someone else's flow and has no information edge of its own. It is closer to copy-trading, which the product already caps separately. | event, or count it as copy activity |
| 11 | `defi_yield` | carry | paper_trading | Rotates into stablecoin pools paying more than 12% APY | Carry, but the tail is total loss of principal (hacks, depegs), not a correlated drawdown. A 12%+ stablecoin yield is a warning sign. | speculative |
| 12 | `dividend_aristocrat` | carry | paper_trading | Long dividend-growth stocks | Plain long equity beta. It duplicates what Core already holds (VTI) inside the capped Explore slice. | trend, or retire it in favor of Core |
| 13 | `qvm_multifactor` | trend | paper_trading | Quality/value/momentum blend on a mega-cap watchlist | Mostly value and quality on large caps. Only part of it is momentum. | event or its own factor book |
| 14 | `liquidation_hunting` | event (also convexity) | paper_trading | Trades crypto long/short-ratio extremes ahead of liquidation cascades | Moved to event per the brief. Its outcomes are fast and leveraged, and arguably belong in speculative. It now also counts against convexity. | speculative |

Notes:
- The six Phase 5 moves (`memecoin_bondingcurve`, `airdrop_farming` and
  `polymarket_crypto_binary_5min` to speculative; `liquidation_hunting`,
  `gamma_exposure` and `jpy_intervention_fade` to event) also count against
  their old book (owner decision), so each move can only tighten limits.
- Any change to this table is a one-line edit in
  `lib/strategies/strategy-books.ts` plus a matching `ALSO_COUNTS_AGAINST`
  entry, if the owner wants the same dual counting.
