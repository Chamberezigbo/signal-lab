# Pre-registration: forex majors (EURUSD, GBPUSD, USDJPY) — ADDENDUM E

Status: **FROZEN. Written 2026-11-18 before any forex data was downloaded or looked at; approved by the owner and binding from the commit that adds this file.** After that, no candidate, threshold, cost, split date or gate below may change. Any new idea is a new addendum with its own sealed hold-out; hold-out data used once cannot be reused.

Purpose: find out whether any simple rule has a net edge on the most liquid real market, where costs are small enough not to hide a real signal. Research only. No order placement code, no keys, no auto-execution. Same methodology as ADDENDUM D (crypto), which found nothing.

## 1. Data
- Source: Dukascopy free historical data, through the open-source `dukascopy-node` library (MIT/ISC licence, Node.js). 1-minute candles, **bid price**, UTC timestamps. No account or key.
- Pairs: **EURUSD, GBPUSD, USDJPY.**
- Series = bar **close** (bid), keyed by bar open time (UTC seconds). Stored in the local file `data/forex.db` (never mixed with Deriv ticks or crypto).
- The download must request candles **including flat (zero-volume) minutes** (`ignoreFlats: false`), so quiet minutes do not look like data holes. If the tool cannot, the hole tolerance in section 2 still applies unchanged.
- Range: 2022-01-01T00:00Z to the last complete month when the download runs.
- Splits by UTC date (fixed now): **TRAIN** 2022-01-01 to 2023-12-31; **TEST** 2024-01-01 to 2024-12-31; **HOLD-OUT** 2025-01-01 to the end of the data, **sealed**: the code refuses to load it unless `--holdout` is passed, which happens only after gates 1 and 2 leave a shortlist, and only once. The hold-out is not even downloaded until then.
- Honest limit: the hold-out is historical, not live (gate 4 is the live test).

## 2. Execution and cost model
- One position at a time. A signal on bar i (close known) fills at the **close of bar i+1** (one bar late). Longs and shorts both allowed.
- Cost: **0.5 basis points (0.005% of price) per side**, i.e. **1.0 bp per round trip**, on entry and exit. This is deliberately above the roughly 0.5–0.7 bp typical retail EURUSD all-in cost (spreads plus commission in calm conditions), to allow for wider spreads at rollover and in news. Dukascopy prices are bid-only, so this fixed cost stands in for the spread.
- Limitations stated now: spread widening at rollover/news is not modelled beyond the fixed cost; overnight swap/financing is ignored (max hold is 24 h of trading); stops are checked on bar closes only.
- SL and TP are percentages of the entry price. Max hold **1440 bars**; cooldown 0.
- Data holes: a gap of more than **300 seconds** between consecutive bars closes any open position on the first bar after it and drops any pending signal. This closes positions across the weekend market closure.
- R = net P&L as a fraction of price ÷ the SL fraction. Metrics as in Stage 4 and ADDENDUM D.
- Informational only (not a gate): the same results at 0.25 bp per side. A candidate that only works at the lower cost is noted, never counted as alive.

## 3. Frozen candidate list (72 per pair, 216 total)
SL and TP each ∈ {**0.1%, 0.2%, 0.4%**}, all nine combinations, for each variant (same families and parameters as ADDENDUM D):

| Family | Variants | Rule |
|---|---|---|
| ma-cross | EMA(fast)/EMA(slow) = 20/100, 60/300, 240/1200 bars | Enter in the direction of the cross, on the cross bar only. |
| breakout | N = 60, 240, 1440 bars | Long when close > highest close of the previous N bars; short when close < lowest. |
| mean-reversion | N = 60, 240 bars | z = (close − SMA_N) / stdev_N. Short when z crosses above +2, long when it crosses below −2 (crossing bars only). |

3 + 3 + 2 = 8 variants × 9 SL/TP pairs = 72 per pair. The stops are smaller than in ADDENDUM D because a 1-minute forex bar moves about 0.01–0.02% and daily ranges are about 0.5%. All features are causal.

## 4. Control
Coin-flip strategy: random direction whenever flat, same SL/TP and costs, seeded. **200 seeds** per SL/TP pair for gates 1–2, **1000 seeds** for the hold-out gate. "Above control p99" means expectancy greater than the 99th percentile of the seeds' expectancies on the same segment.

## 5. Gates (a candidate must pass all, in order)
1. **TRAIN**: ≥ 300 trades, profit factor > 1.1, net expectancy > 0, expectancy > control p99.
2. **TEST** (survivors of gate 1 only): ≥ 150 trades, expectancy > 0, profit factor > 1.0, expectancy ≥ 50% of its TRAIN expectancy.
3. **HOLD-OUT** (survivors of 1 and 2 only, run once): ≥ 300 trades, profit factor > 1.1, expectancy > 0, expectancy > control **99.9th** percentile (1000 seeds).
4. **True forward**: the same frozen rule on data after the commit date of this document (earliest evaluation 8 weeks after freeze) must again pass the gate-3 conditions. Only a gate-4 survivor counts as an edge, and even then the next step is the 4-week demo paper-trading gate with the guardian and honesty meter, never real money directly.

A rule alive on 2 or 3 pairs is reported as stronger than on one, but EURUSD and GBPUSD (and USD pairs generally) are highly correlated, so these are not independent confirmations.

## 6. Multiple-testing note
216 candidates against a p99 line means about 2 false "alive" results are expected by chance at gate 1. Gates 2–4 exist for that reason. A lone gate-1 survivor with nothing after is the expected result of luck.

## 7. Prediction, written in advance
My expectation is **no candidate survives gate 2.** Costs are low here (about 1 bp round trip), so a null would say the rules have no edge, not that fees ate it. That is the useful part of this test.

## 8. What would change this document
Nothing, once committed. Results go to `PROGRESS.md`. New rules need a new addendum judged on data recorded after that addendum's commit.
