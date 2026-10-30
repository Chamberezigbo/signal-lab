# PROGRESS.md - working log for signal-lab

Read this first when resuming. Source of truth for the plan is `PLAN.md`; this file tracks what is actually done.
Update it at the end of every work session.

## Standing rules (from the user)
- Personal-use Boom/Crash signal lab for Deriv synthetic indices. Build in stages; STOP at each checkpoint and wait for the user's confirmation.
- NO trading / order-placement code. The app never auto-executes (PLAN.md).
- Demo, read-only token only, from `.env`. Never print, log or commit the token. `.env` is gitignored.
- Check Deriv's current API docs before writing connection code (they move).
- Do not start the backtester (Stage 3) until the user confirms.

## Status
| Stage | State |
|---|---|
| 1 Setup (project, connection) | Done. `check-auth` (demo balance) deliberately SKIPPED by user; needs a Deriv-App-ID the user chose not to register |
| 2 Tick recorder (history + live + stats) | Built and verified. Railway recorder live; collecting the 1-week dataset. Checkpoint (>=1 week, 2 indices) reached ~2026-11-02 if recording is unbroken. AWAITING USER CONFIRMATION |
| 4 Signal engine + gates | DONE 2026-10-30: 60 pre-registered candidates per index, NONE alive. User chose: stop + forward-test on 2026-11-16 or later |
| 5 Paper trading | NOT STARTED (no surviving rules) |
| 3 Backtester | Built and verified (engine + coin-flip control + self-test). AWAITING USER CONFIRMATION - do not start Stage 4 (signal engine) until the user says so |

## Deriv API facts (verified 2026-10-26)
- Docs moved to https://developers.deriv.com. Legacy `ws.binaryws.com/websockets/v3` appears in some examples; we use the new API.
- Public, no-auth WebSocket: `wss://api.derivws.com/trading/v1/options/ws/public` (ticks, ticks_history, active_symbols).
- Symbols: `BOOM500`, `CRASH500` work. `active_symbols` rejects `product_type` on the new API.
- `ticks_history` is capped at 1000 ticks per request (asking for more returns 1000). Page backwards with `end = oldest_epoch - 1`.
- **Server history is only ~24h (~86,400 ticks per index).** A week of data must come from the live recorder running continuously.
- Authenticated (demo) flow: REST `GET https://api.derivws.com/trading/v1/options/accounts` with `Authorization: Bearer <PAT>` + `Deriv-App-ID` header -> `POST .../accounts/{id}/otp` -> `data.url` (one-time, 120s) -> connect, send `{"balance":1}`. Response shapes for accounts/balance were not in the docs; `src/check-auth.ts` is a best guess and may need adjusting on first real run.

## Railway move (code done 2026-10-26; NOT deployed - user deploys)
- Recorder uses Postgres when `DATABASE_URL` is set, else local SQLite (`src/store.ts`, `src/store-pg.ts`). Backtesting reads local `data/ticks.db` only.
- `/health` on `$PORT` (200 while ticks flow, 503 if stale); watchdog exits(1) after 60s without ticks or 5 failed DB writes; `railway.json` restart policy ALWAYS, start `npm start`.
- `npm run seed-remote` (one-time push of local ticks) and `npm run sync` (pull only new ticks into local SQLite) need `DATABASE_PUBLIC_URL` in local `.env` (enable Public Access on the Railway Postgres service).
- Server env: only `DATABASE_URL` (reference the Postgres service). NO Deriv token / app id on the server.
- Verified locally: typecheck, health endpoint, SQLite path, Postgres SQL (in-memory pglite). NOT verified against real Railway Postgres or Railway's health check on a worker.
- Local recorder currently running with PORT=8099; stop it after the first successful `sync`.

## Stage 3 backtester (built 2026-10-30)
- Commands: `npm run backtest -- [--symbol S] [--seeds N] [--sl pts] [--tp pts] [--spread pts] [--max-hold 1000] [--cooldown 0] [--range 0:0.7] [--risk 1]`, `npm run backtest:test` (self-test), `npm run spread` (samples live bid/ask).
- Files: `src/backtest.ts` (CLI), `src/backtest/{engine,metrics,strategies,data,types,selftest}.ts`.
- Model: one position at a time; signal on tick i fills on tick i+1 (no lookahead); long enters at ask/exits at bid (full spread per round trip); SL/TP checked on every tick and filled at that tick's price (spike gaps slip past stops/targets); position closed on the first tick after a data hole; max-hold timeout.
- Measured spread (live bid/ask, 2026-10-30, fixed and stable): BOOM500 0.085, CRASH500 0.042 points. History stores only mid, so spread is a parameter.
- Metrics: trades, win rate, profit factor, expectancy in R, t-stat, max drawdown in R (and % at --risk), best/worst R, exits, stops with >10% slippage.
- Defaults: SL = TP = half the median spike (BOOM 2.74, CRASH 1.39 pts).
- NOT modelled: commissions/swaps, spread widening, order latency, the exact Deriv product (multiplier/CFD/MT5) cost structure. `--range` supports the 70/30 split for gate 2.

## Stage 3 checkpoint result (4.93 days, 426k ticks per index, 100 random seeds, SL=TP)
| | zero-spread expectancy | net expectancy | spread cost per trade (theory) |
|---|---|---|---|
| BOOM500 | -0.002R (sd 0.041) | -0.031R | 0.085/2.74 = 0.031R |
| CRASH500 | -0.001R (sd 0.042) | -0.031R | 0.042/1.39 = 0.030R |
- ~2000 trades per run; zero-spread win rate 50%, PF 1.00; net PF 0.96; 0/100 seeds reach PF>1.3. The control shows ~zero edge before costs and loses exactly the spread, so the tester is behaving honestly.
- Caveat: the 100 seeds share one price path, so their spread understates path-to-path variation. Single-run |t| up to ~2 occurs by luck (seed 1 BOOM zero-spread t=-2.11).
- Observation: ~25% of stop-outs fill >10% past the stop because of spike gaps; avg loss is ~1.45R, not 1R.

## Stage 4 (2026-10-30): signal engine + four-gate check
- Rules fixed BEFORE testing in `PREREGISTRATION.md` (local, untracked). Do not edit it after the fact; new ideas = new candidates tested on data recorded after 2026-10-30T00:00Z.
- Code: `npm run signals` (`src/stage4.ts`), `src/backtest/features.ts`, strategies `dueSpike`, `maCross`, `driftScalp` in `src/backtest/strategies.ts`.
- Data used: ticks with epoch < 1793318400, 70/30 split (BOOM train 3.45d/test 1.48d; CRASH same).
- Result: 0 of 60 candidates pass gate 1 on either index (train PF>1.3, >=300 trades). Nothing reached the test set, so gates 2/4b were never evaluated. Best train expectancy: BOOM ma-cross 20/100 sl=tp=0.25S +0.082R (PF 1.10, t=0.87); CRASH ma-cross 50/300 +0.108R (PF 1.08, t=0.71). Neither is distinguishable from zero.
- Family means (train, net): due-spike -0.035R (BOOM) / -0.064R (CRASH); ma-cross -0.035R / -0.032R; drift-scalp -0.028R / -0.016R.
- drift-scalp shows the PLAN.md warning: win rate 88-96% yet PF 0.81-0.97 (CRASH tp=30m: t=-2.98, significantly negative).
- "Spike is due" (ticks since last spike): no edge at K = 100/300/500/800.
- Time of day: spike rate not different across UTC hours (train chi2 p=0.37/0.33, test p=0.55/0.53); top-3 train hours do not hold up on test (p=0.19/0.28).
- Power caveat: per-candidate expectancy standard error is ~0.09R with 300-700 trades, so 3.5 days of data cannot detect a real edge smaller than roughly 0.15-0.2R per trade. "No edge found" means no LARGE edge.
- Decision rule from the prereg applies: no alive candidate => do not go to paper trading with these rules.

## Decision 2026-10-30 (user): options 1 + 2
- Accept "no edge found" for the Stage 4 rule families: NO paper trading with them (Stage 5 not started).
- Keep recording; run the frozen 60 candidates per index ONCE on post-cutoff data: `npm run forward` (`src/forward.ts`), rules in PREREGISTRATION.md ADDENDUM A (earliest 2026-11-16; alive needs >=300 trades, PF>1.3, exp>0 and above the 99.9th percentile of 1000 coin-flip seeds). The script refuses to run earlier unless --force (do not use --force to peek).
- Candidates/control code is shared in `src/backtest/candidates.ts` (refactor verified: stage4 numbers identical).
- Recording now also covers BOOM1000 and CRASH1000 (config `SYMBOLS`; `RESEARCH_SYMBOLS` = the two 500s used by stage4/backtest/forward). The 1000 indices are NOT part of the pre-registered tests; any rules for them need their own pre-registration + forward data. First 24h backfilled locally (hole from the redeploy filled via backfill); first stats: BOOM1000 avg 1058 ticks between spikes, CRASH1000 1105 (theory 1000), ~87k ticks each.
- Railway Postgres hole for the 1000 indices (~11 min around the 2026-10-30 redeploy) is filled by a second `seed-remote` run (background job started 2026-10-30; verify with `npm run sync` that remote == local).

## Layout
- `src/config.ts` endpoints, symbols, DB path
- `src/store.ts`/`store-pg.ts`/`health.ts`/`sync.ts`/`seed-remote.ts` see Railway section
- `src/db.ts` SQLite (`data/ticks.db`, table `ticks(symbol, epoch, quote)`, PK on symbol+epoch, inserts ignore duplicates)
- `src/deriv.ts` WebSocket client (req_id matching, keepalive ping)
- `src/backfill.ts` `npm run backfill -- [days]` page historical ticks into SQLite
- `src/recorder.ts` `npm run record` live append, auto-reconnect, gap-fills after reconnects
- `src/stats.ts` `npm run stats -- [K]` counts, missing seconds, spike stats
- `src/check-auth.ts` `npm run check-auth` demo balance (skipped by user)
- `src/measure-spread.ts` `npm run spread`; `src/backtest*` see Stage 3 section

## Spike definition (used by stats; reuse in backtester)
Spike = one-tick move in spike direction (up BOOM, down CRASH) larger than K x median |tick move|, K=20 default. Normal moves are tiny (BOOM median 0.011, spikes ~0.5-18), count is stable for K from 5 to 40.

## Results so far (2026-10-26, 1 day of data per index)
- BOOM500: 86,354 ticks, 181 spikes, avg 478.7 ticks between spikes (theory 500), median 317 (theory ~347).
- CRASH500: 86,356 ticks, 183 spikes, avg 470.6, median 302.
- No missing seconds. Consistent with a memoryless 1/500 spike process.

## Next steps
1. User confirms Stage 2 results; user adds `.env` (DERIV_TOKEN, DERIV_APP_ID) and runs `npm run check-auth`.
2. Leave `npm run record` running (needs a machine that stays awake) until >= 1 week of ticks exist (Stage 2 checkpoint).
3. Only after user says go: Stage 3 backtester (spread, SL/TP, coin-flip control).

## Log
- 2026-10-26: Stages 1-2 built; 24h backfilled; recorder and stats verified.
- 2026-10-26: Added Railway/Postgres support, health check, watchdog, sync, seed-remote, railway.json.
- 2026-10-26 ~03:50 WAT: Railway recorder live (-> postgres). seed-remote pushed local history; sync verified (+0 new, counts match within live lag). Both indices ~90.8k ticks, no gaps. Local recorder still running as backup (Railway billing showed "past due"). Server must NOT hold DERIV_TOKEN.
- 2026-10-26 ~03:55 WAT: local recorder STOPPED at user's request; Railway is the only recorder. Use npm run sync to pull ticks locally.
- 2026-10-30: Railway recorder ran 4.9 days unattended (one 7s hole at 2026-10-28 12:47:53Z, Railway restart). Synced 426k ticks/index. Built Stage 3 backtester + control; checkpoint results above. Not committed/pushed yet.
- 2026-10-30: Stage 4 done (pre-registration, signal rules, gates). 0 candidates alive. Not committed/pushed.
- 2026-10-30: Added BOOM1000/CRASH1000 recording; forward-test script + prereg addendum A; committed Stage 3/4 as c968831. Forward script + candidates refactor not yet committed.
