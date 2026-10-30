# PREREGISTRATION.md - Stage 4 rules, written BEFORE any signal was backtested

Written 2026-10-30 ~00:10 UTC. Only the coin-flip control had been run at this point. Nothing below may be changed after the
first signal result is seen. Anything added later is a NEW candidate, reported as such, and must be re-tested on data recorded
after the cutoff (never on data already used).

## Data
- BOOM500 and CRASH500 ticks from local data/ticks.db with epoch < 1793318400 (2026-10-30T00:00:00Z), about 4.9 days each.
- Chronological split per index: first 70% = TRAIN, last 30% = TEST. TEST is used once, only for candidates that pass the train gates.
- Cost model: observed spread (BOOM 0.085, CRASH 0.042 pts), fills at next tick, SL/TP filled at tick price (gap slippage),
  max hold 1000 ticks, cooldown 0. Same as the Stage 3 control.
- Spike detector (causal): one-tick move in spike direction > 0.22 pts (BOOM) / 0.10 pts (CRASH) (20x the generator's median tick move).
- Scale constants for SL/TP: median spike size S = 5.48 (BOOM) / 2.78 (CRASH); median tick move m = 0.011 (BOOM) / 0.005 (CRASH).

## Candidates (the complete list; 60 per index)
Direction d = +1 long for BOOM, -1 short for CRASH (the spike direction). SL, TP are in multiples of S unless stated.
A. due-spike (the "a spike is due" idea): enter in direction d when ticks-since-last-spike >= K.
   K in {100, 300, 500, 800}; SL in {0.25S, 0.5S, 1S} x TP in {0.25S, 0.5S, 1S}. 36 candidates.
B. ma-cross (trend): EMA(fast) crosses EMA(slow) on tick data; enter in the cross direction (either side).
   (fast, slow) in {(20, 100), (50, 300)}; same 9 SL/TP combos. 18 candidates.
C. drift-scalp (trade with the slow drift, against the spike direction): enter in direction -d whenever flat and
   ticks-since-spike >= 20. TP in {30m, 60m, 120m}, SL in {0.5S, 1S}. 6 candidates.

## Gates (all must pass; mirrors PLAN.md)
1. Backtest on TRAIN: >= 300 trades, profit factor > 1.3, net expectancy > 0.
4a. Random control on TRAIN: 200 coin-flip seeds with the same SL/TP and segment. The candidate's expectancy (R/trade)
    must exceed the 99th percentile of the control expectancies.
2. Out-of-sample, run ONCE on TEST: net expectancy > 0, profit factor > 1, and expectancy >= 50% of the TRAIN expectancy.
4b. Random control on TEST, same rule as 4a (99th percentile).
3. Paper trading (4 weeks, demo) is Stage 5 and is NOT part of this checkpoint.
A candidate is "alive" only if it passes 1, 4a, 2 and 4b. Because 60 candidates are tried per index, the number of train-gate
passes expected from luck alone is reported (from the control: share of random seeds reaching PF > 1.3).

## Time-of-day (tested, not assumed)
- Chi-square test (df 23) that the spike rate is the same in all 24 UTC hours, on TRAIN and on TEST separately.
- Hold-out check: the 3 hours with the highest TRAIN spike rate must also show an above-average spike rate on TEST (one-sided
  z-test, p < 0.05) for the hour effect to count.

## Decision rule
If no candidate is alive on either index, the conclusion is "no edge found" and we do not proceed to paper trading with
these rules. If a candidate is alive, it still needs Stage 5 paper trading and more data before any real-money talk.
