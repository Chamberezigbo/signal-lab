import type { EngineConfig, Series, Strategy, Trade } from './types.js';

/**
 * Tick replay with one position at a time.
 *  - A signal produced on tick i is filled on tick i+1 (no lookahead).
 *  - Longs enter at the ask (mid + half spread) and exit at the bid; shorts the reverse, so every round trip pays the full spread.
 *  - SL/TP are checked against the executable exit price on every tick and filled at THAT tick's price, not at the level.
 *    A one-tick spike can therefore fill far past a stop (slippage) or past a target (bonus); both show up in the R multiples.
 *  - No position or pending signal is carried across a hole in the data; it is closed on the first tick after the hole.
 */
export function runBacktest(s: Series, strat: Strategy, cfg: EngineConfig): Trade[] {
  strat.prepare?.(s);
  const n = s.quote.length;
  const half = cfg.spread / 2;
  const trades: Trade[] = [];

  let pending: { side: 1 | -1; sl: number; tp: number } | null = null;
  let pos: { side: 1 | -1; entry: number; slLevel: number; tpLevel: number; slDist: number; idx: number } | null = null;
  let flatUntil = 0;

  const close = (i: number, exit: number, reason: Trade['reason']) => {
    const p = pos!;
    const pnl = (exit - p.entry) * p.side;
    trades.push({ entryIdx: p.idx, exitIdx: i, side: p.side, entry: p.entry, exit, pnl, r: pnl / p.slDist, reason, held: i - p.idx });
    pos = null;
    flatUntil = i + cfg.cooldown;
  };

  for (let i = 0; i < n; i++) {
    const mid = s.quote[i];
    const hole = i > 0 && s.epoch[i] - s.epoch[i - 1] > 1;

    if (pos) {
      const exitPx = pos.side === 1 ? mid - half : mid + half;
      if (hole) close(i, exitPx, 'gap');
      else if (pos.side === 1 ? exitPx <= pos.slLevel : exitPx >= pos.slLevel) close(i, exitPx, 'sl');
      else if (pos.side === 1 ? exitPx >= pos.tpLevel : exitPx <= pos.tpLevel) close(i, exitPx, 'tp');
      else if (i - pos.idx >= cfg.maxHold) close(i, exitPx, 'timeout');
      continue; // never re-enter on the exit tick
    }

    if (pending && !hole) {
      const entry = pending.side === 1 ? mid + half : mid - half;
      pos = {
        side: pending.side,
        entry,
        slLevel: entry - pending.side * pending.sl,
        tpLevel: entry + pending.side * pending.tp,
        slDist: pending.sl,
        idx: i,
      };
      pending = null;
      continue;
    }
    pending = null;

    if (i >= flatUntil && i < n - 1) {
      const sig = strat.onTick(i, s);
      if (sig) pending = sig;
    }
  }

  if (pos) {
    const p = pos as { side: 1 | -1 };
    close(n - 1, p.side === 1 ? s.quote[n - 1] - half : s.quote[n - 1] + half, 'end');
  }
  return trades;
}
