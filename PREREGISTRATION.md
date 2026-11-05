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

---
## ADDENDUM A - forward test (written 2026-10-30, before any forward data was examined)
Decision by the user on 2026-10-30: accept "no edge found" for the Stage 4 rules (no paper trading with them), keep recording,
and re-test the SAME frozen 60 candidates per index on data recorded after the cutoff.
- Forward data: BOOM500 and CRASH500 ticks with epoch >= 1793318400 only. Data before the cutoff is never used.
- Earliest run date: 2026-11-16 (about 2.5 weeks of forward data). Run it ONCE; do not peek at partial forward results earlier,
  and do not re-run after tweaking anything. The candidate list, spreads, max hold, cooldown and spike constants are unchanged.
- Alive on the forward segment requires ALL of: >= 300 trades, profit factor > 1.3, net expectancy > 0, and expectancy above the
  99.9th percentile of 1000 coin-flip seeds with the same SL/TP on the same segment (about Bonferroni for 60 candidates).
- If no candidate is alive: the Stage 4 conclusion stands (no edge in these rule families on BOOM/CRASH 500).
- If one or more is alive: it is a lead only. It then needs the 4-week demo paper-trading gate (PLAN.md Stage 5) before any further step.
- BOOM1000 / CRASH1000 are recorded but are not part of this test. Any rules for them are new candidates needing their own
  pre-registration and forward data.

---
## ADDENDUM B - Stage 4 rules on BOOM1000 / CRASH1000 (written 2026-11-05, before any rule was run on these indices)
Purpose: test whether the same rule families find an edge on the 1000 indices. This does NOT replace or consume the Addendum A
forward test on the 500 indices (that data is not touched here).
- Data: BOOM1000 and CRASH1000 ticks with epoch < 1793836800 (2026-11-05T00:00:00Z), about 7.0 days each. 70/30 chronological
  train/test split per index. Test is run once, only for survivors of the train gates.
- Cost model as before: fill on next tick, SL/TP filled at tick price, max hold 1000 ticks, cooldown 0. Measured live spreads
  (2026-11-05, constant over 60 s): BOOM1000 0.153, CRASH1000 0.061 points.
- Constants measured on the 1000 data (scale constants, not tuned on strategy results): spike threshold = 20x median tick move:
  BOOM1000 0.28 (median move 0.014), CRASH1000 0.12 (0.006). Median spike size S: BOOM1000 13.85, CRASH1000 5.59.
  The spike count is stable for thresholds 5x-40x (BOOM1000 616..607, CRASH1000 608..592).
- Candidates: identical to the 60 per index above (families A, B, C; same SL/TP multiples of S; same MA windows; drift-scalp TP in
  multiples of m), with ONE change: the due-spike K values are doubled because the spike rate is half (1 in 1000):
  K in {200, 600, 1000, 1600}.
- Gates: identical to Stage 4 (1, 4a, 2, 4b, 200 coin-flip seeds, 99th percentile). Time-of-day tests as in Stage 4.
- Decision rule: no alive candidate on either index => "no edge found on the 1000 indices with these rule families".
  An alive candidate is only a lead and would need its own forward data (recorded after 2026-11-05) before paper trading.
- 120 candidates are tried across the two indices; a few train-gate passes by luck are possible and are reported with the
  luck baseline, as in Stage 4.

---
## ADDENDUM C - forward test on BOOM1000 / CRASH1000 (written 2026-11-05, before any 1000-index forward data was examined)
Decision by the user on 2026-11-05. Addendum B found no alive candidate on the 1000 indices, but BOOM1000 train results were
slightly positive on average, so the same frozen candidates get one clean forward test.
- Forward data: BOOM1000 and CRASH1000 ticks with epoch >= 1793836800 (2026-11-05T00:00:00Z) only. Nothing before it is used.
- Candidates: the exact 60 per index of Addendum B (K doubled), same spreads (0.153 / 0.061), constants, max hold and cooldown.
  No changes after this point.
- Earliest run date: 2026-11-26 (3 weeks of forward data). Run ONCE with `npm run forward -- 1000`. No peeking at partial
  results earlier and no re-runs after changing anything (`--force` is not to be used to peek).
- Alive requires ALL of: >= 300 trades, profit factor > 1.3, net expectancy > 0, and expectancy above the 99.9th percentile of
  1000 coin-flip seeds with the same SL/TP on the same segment (roughly Bonferroni for 60 candidates per index).
- Decision rule: none alive => no edge found on the 1000 indices with these rule families (the BOOM1000 train effect was
  noise). Alive => a lead only; it then needs the 4-week demo paper-trading gate before anything else.
- The 500-index forward test (Addendum A, earliest 2026-11-16) is separate and unchanged.
