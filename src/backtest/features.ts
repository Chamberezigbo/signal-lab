import type { Series } from './types.js';

/** Causal spike detector constants (20x the generator's median tick move; see PREREGISTRATION.md). */
export const SPIKE_THRESHOLD: Record<string, number> = { BOOM500: 0.22, CRASH500: 0.1 };
export const SPIKE_DIR: Record<string, 1 | -1> = { BOOM500: 1, CRASH500: -1 };
/** Scale constants for SL/TP: median spike size S and median tick move m. */
export const MEDIAN_SPIKE: Record<string, number> = { BOOM500: 5.48, CRASH500: 2.78 };
export const MEDIAN_MOVE: Record<string, number> = { BOOM500: 0.011, CRASH500: 0.005 };

export function isSpike(s: Series, i: number): boolean {
  return i > 0 && (s.quote[i] - s.quote[i - 1]) * SPIKE_DIR[s.symbol] > SPIKE_THRESHOLD[s.symbol];
}

/** Ticks since the last spike at or before tick i (0 on the spike tick); -1 until the first spike has been seen. */
export function ticksSinceSpike(s: Series): Int32Array {
  const out = new Int32Array(s.quote.length).fill(-1);
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (isSpike(s, i)) last = i;
    out[i] = last < 0 ? -1 : i - last;
  }
  return out;
}

export function ema(x: Float64Array, n: number): Float64Array {
  const a = 2 / (n + 1);
  const out = new Float64Array(x.length);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + a * (x[i] - out[i - 1]);
  return out;
}
