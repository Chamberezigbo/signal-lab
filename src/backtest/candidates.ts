import { MEDIAN_MOVE, MEDIAN_SPIKE } from './features.js';
import { computeMetrics, type Metrics } from './metrics.js';
import { runBacktest } from './engine.js';
import { coinFlip, driftScalp, dueSpike, maCross } from './strategies.js';
import type { Series, Strategy } from './types.js';

// The frozen Stage 4 candidate list and control machinery (see PREREGISTRATION.md). Do not edit the candidates.
export const CUTOFF = 1793318400; // 2026-10-30T00:00:00Z
export const SPREAD: Record<string, number> = { BOOM500: 0.085, CRASH500: 0.042 };
const MULTS = [0.25, 0.5, 1];

export interface Candidate {
  family: string;
  label: string;
  sl: number;
  tp: number;
  make: () => Strategy;
}

export function candidates(symbol: string): Candidate[] {
  const S = MEDIAN_SPIKE[symbol];
  const m = MEDIAN_MOVE[symbol];
  const out: Candidate[] = [];
  const r = (x: number) => +x.toFixed(4);
  for (const K of [100, 300, 500, 800])
    for (const a of MULTS)
      for (const b of MULTS) {
        const sl = r(a * S), tp = r(b * S);
        out.push({ family: 'due-spike', label: `K=${K} sl=${a}S tp=${b}S`, sl, tp, make: () => dueSpike(K, sl, tp) });
      }
  for (const [fast, slow] of [[20, 100], [50, 300]])
    for (const a of MULTS)
      for (const b of MULTS) {
        const sl = r(a * S), tp = r(b * S);
        out.push({ family: 'ma-cross', label: `${fast}/${slow} sl=${a}S tp=${b}S`, sl, tp, make: () => maCross(fast, slow, sl, tp) });
      }
  for (const tpm of [30, 60, 120])
    for (const a of [0.5, 1]) {
      const sl = r(a * S), tp = r(tpm * m);
      out.push({ family: 'drift-scalp', label: `tp=${tpm}m sl=${a}S`, sl, tp, make: () => driftScalp(20, sl, tp) });
    }
  return out;
}

export const run = (s: Series, st: Strategy, spread: number) => computeMetrics(runBacktest(s, st, { spread, maxHold: 1000, cooldown: 0 }));

const controlCache = new Map<string, { exp: number[]; luckPF: number }>();
export function control(seg: Series, name: string, sl: number, tp: number, seeds = 200) {
  const key = `${seg.symbol}|${name}|${sl}|${tp}|${seeds}`;
  let c = controlCache.get(key);
  if (!c) {
    const ms: Metrics[] = [];
    for (let seed = 1; seed <= seeds; seed++) ms.push(run(seg, coinFlip(seed, sl, tp), SPREAD[seg.symbol]));
    c = { exp: ms.map((x) => x.expectancyR).sort((a, b) => a - b), luckPF: ms.filter((x) => x.profitFactor > 1.3 && x.trades >= 300).length / seeds };
    controlCache.set(key, c);
  }
  return c;
}
/** Control expectancy at quantile q (e.g. 0.99). */
export const quantile = (c: { exp: number[] }, q: number) => c.exp[Math.ceil(q * c.exp.length) - 1];
export const p99 = (c: { exp: number[] }) => quantile(c, 0.99);
export const pctile = (c: { exp: number[] }, x: number) => (c.exp.filter((e) => e < x).length / c.exp.length) * 100;
