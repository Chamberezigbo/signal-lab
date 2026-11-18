# Pre-registration: crypto (BTCUSDT, ETHUSDT) — ADDENDUM D

Status: **FROZEN. Written 2026-11-18 before any crypto data was downloaded or looked at; approved by the owner and binding from commit 59d7c2d (the rules in that commit are unchanged; only this status label was updated afterwards).** After that, no candidate, threshold, cost, split date or gate below may change. Any new idea is a new addendum with its own sealed hold-out; hold-out data used once cannot be reused.

Purpose: find out whether any simple rule has a net edge on a real, liquid market, after realistic fees. This is research only. No order placement code, no keys, no auto-execution.

## 1. Data
- Source: Binance public data archive (data.binance.vision), spot klines, **1-minute**, symbols **BTCUSDT** and **ETHUSDT**. No API key.
- Series = bar **close** price, keyed by bar open time (UTC seconds). Stored in a separate local file `data/crypto.db` (never mixed with the Deriv ticks).
- Range: 2022-01-01T00:00Z to the last complete month available when the download runs.
- Splits by UTC date (fixed now):
  - **TRAIN**: 2022-01-01 to 2023-12-31
  - **TEST**: 2024-01-01 to 2024-12-31
  - **HOLD-OUT**: 2025-01-01 to the end of the data. **Sealed**: the code must refuse to load it unless `--holdout` is passed, and it is passed only after gates 1 and 2 (below) have produced a shortlist, and only once.
- Honest limit: the hold-out is historical, not live. The author knows crypto's broad history, so it is weaker evidence than a true forward test (gate 4).

## 2. Execution and cost model
- One position at a time. A signal on bar i (close known) is filled at the **close of bar i+1** (one bar late, conservative).
- Longs and shorts both allowed. (Shorting is treated as a perpetual-futures short; funding payments are ignored and noted as a limitation.)
- Cost: **0.10% of price per side** (Binance spot taker fee without discounts), applied on entry and on exit, so **0.20% per round trip**. Entry long = close × 1.001, exit long = close × 0.999; shorts the reverse. No additional slippage model.
- SL and TP are **percentages of the entry price**, checked on bar closes only (intra-bar highs/lows are ignored — a stated limitation).
- Max hold: **1440 bars (24 h)**, then close at market. Cooldown: 0.
- A missing minute (data hole > 120 s) closes any open position on the first bar after it; no signal carries across a hole.
- R = net P&L as a fraction of price ÷ the SL fraction. Metrics as in Stage 4: trades, win rate, profit factor, expectancy (R), t-stat, max drawdown (R).
- Informational only (not a gate): the same results re-run at 0.04% per side (futures-like fee). A candidate that only works at the lower fee is noted as such, never counted as alive.

## 3. Frozen candidate list (72 per symbol, 144 total)
SL and TP each ∈ {0.5%, 1%, 2%}, all nine combinations, for each variant:

| Family | Variants | Rule |
|---|---|---|
| ma-cross | EMA(fast)/EMA(slow) = 20/100, 60/300, 240/1200 bars | Enter in the direction of the cross, on the cross bar only. |
| breakout | N = 60, 240, 1440 bars | Long when close > highest close of the previous N bars; short when close < lowest. |
| mean-reversion | N = 60, 240 bars | z = (close − SMA_N) / stdev_N. Short when z crosses above +2, long when it crosses below −2 (crossing bars only). |

3 + 3 + 2 = 8 variants × 9 SL/TP pairs = 72 per symbol. All features are causal (value at bar i uses bars ≤ i).

## 4. Control
Coin-flip strategy: random direction whenever flat, same SL/TP, same costs, seeded. **200 seeds** per SL/TP pair for gates 1–2, **1000 seeds** for the hold-out gate. "Above control p99" means expectancy greater than the 99th percentile of the seeds' expectancies on the same segment.

## 5. Gates (a candidate must pass all, in order)
1. **TRAIN**: ≥ 300 trades, profit factor > 1.1, net expectancy > 0, expectancy > control p99.
2. **TEST**: ≥ 150 trades, expectancy > 0, profit factor > 1.0, expectancy ≥ 50% of its TRAIN expectancy.
3. **HOLD-OUT** (survivors of 1 and 2 only, run once): ≥ 300 trades, profit factor > 1.1, expectancy > 0, expectancy > control **99.9th** percentile (1000 seeds).
4. **True forward**: the same frozen rule, on data recorded after the commit date of this document (earliest evaluation: 8 weeks after freeze), must again pass the gate-3 conditions. Only a candidate that passes gate 4 counts as an edge, and even then the next step is the 4-week demo paper-trading gate with the guardian and honesty meter, never real money directly.

"Alive on both symbols" is reported as stronger than alive on one, but BTC and ETH are highly correlated, so they are not two independent confirmations.

## 6. Multiple-testing note
144 candidates tested against a p99 line means about 1–2 false "alive" results are expected by chance at gate 1 alone. Gates 2–4 exist for that reason. A single survivor at gate 1 with nothing after is the expected result of luck.

## 7. Prediction, written in advance
My expectation is **no candidate survives gate 2**. Fees of 0.2% per round trip are large relative to 0.5–2% stops, and liquid crypto is heavily arbitraged at the 1-minute horizon. If something does survive, it is a lead, not a result.

## 8. What would change this document
Nothing, once committed. Results go to `PROGRESS.md`. If I later want to add rules, I write ADDENDUM E, and it can only be judged on data recorded after that addendum's commit.
