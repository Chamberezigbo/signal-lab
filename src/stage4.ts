import { RESEARCH_SYMBOLS } from './config.js';
import { loadSeries, sliceSeries } from './backtest/data.js';
import { runBacktest } from './backtest/engine.js';
import { isSpike, MEDIAN_MOVE, MEDIAN_SPIKE } from './backtest/features.js';
import { computeMetrics, type Metrics } from './backtest/metrics.js';
import { coinFlip, driftScalp, dueSpike, maCross } from './backtest/strategies.js';
import type { Series, Strategy } from './backtest/types.js';

// npm run signals: runs the candidates and gates exactly as fixed in PREREGISTRATION.md.
const CUTOFF = 1793318400; // 2026-10-30T00:00:00Z
const SPREAD: Record<string, number> = { BOOM500: 0.085, CRASH500: 0.042 };
const SEEDS = 200;
const MULTS = [0.25, 0.5, 1];

interface Candidate {
  family: string;
  label: string;
  sl: number;
  tp: number;
  make: () => Strategy;
}

function candidates(symbol: string): Candidate[] {
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

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'inf');
const run = (s: Series, st: Strategy, spread: number) => computeMetrics(runBacktest(s, st, { spread, maxHold: 1000, cooldown: 0 }));

const controlCache = new Map<string, { exp: number[]; luckPF: number }>();
function control(seg: Series, name: string, sl: number, tp: number) {
  const key = `${seg.symbol}|${name}|${sl}|${tp}`;
  let c = controlCache.get(key);
  if (!c) {
    const ms: Metrics[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) ms.push(run(seg, coinFlip(seed, sl, tp), SPREAD[seg.symbol]));
    c = { exp: ms.map((x) => x.expectancyR).sort((a, b) => a - b), luckPF: ms.filter((x) => x.profitFactor > 1.3 && x.trades >= 300).length / SEEDS };
    controlCache.set(key, c);
  }
  return c;
}
const p99 = (c: { exp: number[] }) => c.exp[Math.ceil(0.99 * c.exp.length) - 1];
const pctile = (c: { exp: number[] }, x: number) => (c.exp.filter((e) => e < x).length / c.exp.length) * 100;

// --- time-of-day analysis -------------------------------------------------------------------------------------
const Phi = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};
function hourStats(s: Series) {
  const spikes = new Array(24).fill(0);
  const ticks = new Array(24).fill(0);
  for (let i = 1; i < s.quote.length; i++) {
    const h = Math.floor(s.epoch[i] / 3600) % 24;
    ticks[h]++;
    if (isSpike(s, i)) spikes[h]++;
  }
  const S = spikes.reduce((a, b) => a + b, 0);
  const T = ticks.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let h = 0; h < 24; h++) {
    const e = (S * ticks[h]) / T;
    if (e > 0) chi += (spikes[h] - e) ** 2 / e;
  }
  const k = 23;
  const z = (Math.cbrt(chi / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return { spikes, ticks, S, T, chi, p: 1 - Phi(z) };
}

// --- main ---------------------------------------------------------------------------------------------------
for (const symbol of RESEARCH_SYMBOLS) {
  const all = loadSeries(symbol, [0, 1], CUTOFF);
  const cut = Math.floor(all.quote.length * 0.7);
  const train = sliceSeries(all, 0, cut);
  const test = sliceSeries(all, cut, all.quote.length);
  const days = (s: Series) => ((s.epoch[s.epoch.length - 1] - s.epoch[0]) / 86400).toFixed(2);
  console.log(`\n${'='.repeat(100)}\n${symbol}: train ${train.quote.length} ticks (${days(train)}d) | test ${test.quote.length} ticks (${days(test)}d) | spread ${SPREAD[symbol]}\n${'='.repeat(100)}`);

  const cands = candidates(symbol);
  const rows = cands.map((c) => {
    const tr = run(train, c.make(), SPREAD[symbol]);
    const ctl = control(train, 'ctl', c.sl, c.tp);
    const g1 = tr.trades >= 300 && tr.profitFactor > 1.3 && tr.expectancyR > 0;
    const g4a = tr.expectancyR > p99(ctl);
    return { c, tr, ctl, g1, g4a, te: null as Metrics | null, g2: false, g4b: false };
  });

  const luck = [...new Map(rows.map((r) => [`${r.c.sl}|${r.c.tp}`, r.ctl.luckPF])).values()];
  console.log(`candidates tried: ${rows.length} | <300 train trades: ${rows.filter((r) => r.tr.trades < 300).length} | pass gate 1: ${rows.filter((r) => r.g1).length} | gate 1 + 4a: ${rows.filter((r) => r.g1 && r.g4a).length}`);
  console.log(`luck baseline: random coin-flip seeds reaching PF>1.3 with >=300 trades on train: ${f((luck.reduce((a, b) => a + b, 0) / luck.length) * 100, 1)}% (so ~${f((luck.reduce((a, b) => a + b, 0) / luck.length) * rows.length, 1)} of ${rows.length} candidates expected by luck alone)`);

  console.log('\nPer family (train, net of spread):');
  for (const fam of ['due-spike', 'ma-cross', 'drift-scalp']) {
    const rs = rows.filter((r) => r.c.family === fam);
    const e = rs.map((r) => r.tr.expectancyR);
    console.log(`  ${fam.padEnd(12)} n=${rs.length} | expectancy mean ${f(e.reduce((a, b) => a + b, 0) / e.length, 3)}R, best ${f(Math.max(...e), 3)}R, worst ${f(Math.min(...e), 3)}R | best PF ${f(Math.max(...rs.map((r) => r.tr.profitFactor)))}`);
  }

  // test is touched ONLY for survivors of gates 1 and 4a
  for (const r of rows.filter((x) => x.g1 && x.g4a)) {
    r.te = run(test, r.c.make(), SPREAD[symbol]);
    const ctlT = control(test, 'ctl', r.c.sl, r.c.tp);
    r.g2 = r.te.expectancyR > 0 && r.te.profitFactor > 1 && r.te.expectancyR >= 0.5 * r.tr.expectancyR;
    r.g4b = r.te.expectancyR > p99(ctlT);
  }
  const alive = rows.filter((r) => r.g1 && r.g4a && r.g2 && r.g4b);
  console.log(`survivors tested on TEST: ${rows.filter((r) => r.te).length} | ALIVE (gates 1,4a,2,4b): ${alive.length}`);

  console.log('\nTop 12 by train expectancy (net):');
  console.log('  candidate'.padEnd(46) + 'trades  win%   PF    exp(R)   t     ctl-pct  G1  G4a');
  for (const r of [...rows].sort((a, b) => b.tr.expectancyR - a.tr.expectancyR).slice(0, 12)) {
    const t = r.tr;
    console.log(`  ${(r.c.family + ' ' + r.c.label).padEnd(44)}${String(t.trades).padStart(6)} ${f(t.winRate * 100, 1).padStart(5)} ${f(t.profitFactor).padStart(5)} ${f(t.expectancyR, 3).padStart(8)} ${f(t.tStat).padStart(5)} ${f(pctile(r.ctl, t.expectancyR), 0).padStart(6)}%   ${r.g1 ? 'Y' : '-'}   ${r.g4a ? 'Y' : '-'}`);
  }
  for (const r of rows.filter((x) => x.te)) {
    const t = r.te!;
    console.log(`  TEST ${r.c.family} ${r.c.label}: trades ${t.trades}, PF ${f(t.profitFactor)}, exp ${f(t.expectancyR, 3)}R (train ${f(r.tr.expectancyR, 3)}R) -> G2 ${r.g2 ? 'Y' : 'N'}, G4b ${r.g4b ? 'Y' : 'N'}`);
  }

  // time of day
  const ht = hourStats(train);
  const he = hourStats(test);
  const top3 = [...Array(24).keys()].sort((a, b) => ht.spikes[b] / Math.max(1, ht.ticks[b]) - ht.spikes[a] / Math.max(1, ht.ticks[a])).slice(0, 3);
  const s3 = top3.reduce((a, h) => a + he.spikes[h], 0);
  const t3 = top3.reduce((a, h) => a + he.ticks[h], 0);
  const p0 = he.S / he.T;
  const z = (s3 - t3 * p0) / Math.sqrt(t3 * p0 * (1 - p0));
  console.log(`\nTime of day (UTC hour), spike rate uniform?  train: chi2=${f(ht.chi, 1)} p=${f(ht.p, 3)} | test: chi2=${f(he.chi, 1)} p=${f(he.p, 3)}   (df 23; p < 0.05 would suggest an hour effect)`);
  console.log(`  top-3 train hours ${top3.join(',')}: test spike rate ${f((s3 / t3) * 500, 2)} per 500 ticks vs overall ${f(p0 * 500, 2)} (one-sided p=${f(1 - Phi(z), 3)})`);
}
