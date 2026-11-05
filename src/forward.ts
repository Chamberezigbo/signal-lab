import { RESEARCH_SYMBOLS } from './config.js';
import { loadSeries } from './backtest/data.js';
import { candidates, control, CUTOFF, CUTOFF_1000, quantile, run, SPREAD } from './backtest/candidates.js';

// npm run forward: ADDENDUM A of PREREGISTRATION.md (500 indices). Runs the frozen candidates ONCE on ticks recorded after the cutoff.
// npm run forward -- 1000: ADDENDUM C (BOOM1000/CRASH1000, cutoff 2026-11-05).
// Do not run before the earliest date and do not re-run after changing anything (use --force to override the date guard).
const is1000 = process.argv[2] === '1000';
const SET = is1000
  ? { symbols: ['BOOM1000', 'CRASH1000'], cutoff: CUTOFF_1000, earliest: Date.UTC(2026, 10, 26) / 1000, label: 'ADDENDUM C: no earlier than 2026-11-26' }
  : { symbols: [...RESEARCH_SYMBOLS], cutoff: CUTOFF, earliest: Date.UTC(2026, 10, 16) / 1000, label: 'ADDENDUM A: no earlier than 2026-11-16' };
if (Date.now() / 1000 < SET.earliest && !process.argv.includes('--force')) {
  console.error(`Too early: ${SET.label}. Peeking at partial forward results is not allowed.`);
  process.exit(1);
}
const SEEDS = 1000;
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'inf');

for (const symbol of SET.symbols) {
  const seg = loadSeries(symbol, [0, 1]);
  const first = seg.epoch.findIndex((e) => e >= SET.cutoff);
  if (first < 0) continue;
  const fwd = { ...seg, epoch: seg.epoch.slice(first), quote: seg.quote.slice(first) };
  console.log(`\n=== ${symbol} forward segment: ${fwd.quote.length} ticks (${((fwd.epoch[fwd.epoch.length - 1] - fwd.epoch[0]) / 86400).toFixed(2)} days) ===`);
  const rows = candidates(symbol).map((c) => {
    const m = run(fwd, c.make(), SPREAD[symbol]);
    const ctl = control(fwd, 'fwd', c.sl, c.tp, SEEDS);
    const threshold = quantile(ctl, 0.999);
    const alive = m.trades >= 300 && m.profitFactor > 1.3 && m.expectancyR > 0 && m.expectancyR > threshold;
    return { c, m, threshold, alive };
  });
  console.log(`candidates: ${rows.length} | with >=300 trades: ${rows.filter((r) => r.m.trades >= 300).length} | ALIVE: ${rows.filter((r) => r.alive).length}`);
  console.log('Top 10 by expectancy:');
  for (const r of [...rows].sort((a, b) => b.m.expectancyR - a.m.expectancyR).slice(0, 10))
    console.log(`  ${(r.c.family + ' ' + r.c.label).padEnd(44)} trades ${String(r.m.trades).padStart(5)} PF ${f(r.m.profitFactor)} exp ${f(r.m.expectancyR, 3)}R t ${f(r.m.tStat)} | control p99.9 ${f(r.threshold, 3)}R ${r.alive ? '<== ALIVE' : ''}`);
}
