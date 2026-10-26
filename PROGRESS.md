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
| 3 Backtester | NOT STARTED - blocked on user confirmation |

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

## Layout
- `src/config.ts` endpoints, symbols, DB path
- `src/store.ts`/`store-pg.ts`/`health.ts`/`sync.ts`/`seed-remote.ts` see Railway section
- `src/db.ts` SQLite (`data/ticks.db`, table `ticks(symbol, epoch, quote)`, PK on symbol+epoch, inserts ignore duplicates)
- `src/deriv.ts` WebSocket client (req_id matching, keepalive ping)
- `src/backfill.ts` `npm run backfill -- [days]` page historical ticks into SQLite
- `src/recorder.ts` `npm run record` live append, auto-reconnect, gap-fills after reconnects
- `src/stats.ts` `npm run stats -- [K]` counts, missing seconds, spike stats
- `src/check-auth.ts` `npm run check-auth` demo balance

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
