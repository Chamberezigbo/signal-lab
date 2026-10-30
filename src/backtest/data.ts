import { openDb } from '../db.js';
import type { Series } from './types.js';

/** Loads a symbol's ticks from local SQLite. `range` is [from, to) as fractions of the series, for train/test splits. */
export function loadSeries(symbol: string, range: [number, number] = [0, 1], untilEpoch = Infinity): Series {
  const { db } = openDb();
  const rows = db.prepare('SELECT epoch, quote FROM ticks WHERE symbol = ? AND epoch < ? ORDER BY epoch').all(symbol, untilEpoch) as { epoch: number; quote: number }[];
  const a = Math.floor(rows.length * range[0]);
  const b = Math.floor(rows.length * range[1]);
  const part = rows.slice(a, b);
  return {
    symbol,
    epoch: Float64Array.from(part, (r) => r.epoch),
    quote: Float64Array.from(part, (r) => r.quote),
  };
}

export function sliceSeries(s: Series, from: number, to: number): Series {
  return { symbol: s.symbol, epoch: s.epoch.slice(from, to), quote: s.quote.slice(from, to) };
}
