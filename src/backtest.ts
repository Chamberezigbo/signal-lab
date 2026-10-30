import { RESEARCH_SYMBOLS } from './config.js';
import { loadSeries } from './backtest/data.js';
import { runBacktest } from './backtest/engine.js';
import { computeMetrics, type Metrics } from './backtest/metrics.js';
import { coinFlip } from './backtest/strategies.js';
import type { Series } from './backtest/types.js';

// npm run backtest -- [--symbol BOOM500] [--strategy coinflip] [--sl pts] [--tp pts] [--spread pts]
//                     [--max-hold 1000] [--cooldown 0] [--seed 1] [--seeds 100] [--range 0:1] [--risk 1]
// Defaults: SL = TP = half the median spike size. Spread defaults to the value measured on live bid/ask (npm run spread).
const OBSERVED_SPREAD: Record<string, number> = { BOOM500: 0.085, CRASH500: 0.042 };

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const num = (k: string, d: number) => (args.has(k) ? Number(args.get(k)) : d);

const symbols = args.has('symbol') ? [args.get('symbol')!] : [...RESEARCH_SYMBOLS];
const strategyName = args.get('strategy') ?? 'coinflip';
const range = (args.get('range') ?? '0:1').split(':').map(Number) as [number, number];
const seeds = num('seeds', 1);
const riskPct = num('risk', 1);

function medianSpike(s: Series, dir: 1 | -1) {
  const d: number[] = [];
  for (let i = 1; i < s.quote.length; i++) d.push((s.quote[i] - s.quote[i - 1]) * dir);
  const med = [...d.map(Math.abs)].sort((a, b) => a - b)[d.length >> 1];
  const sp = d.filter((x) => x > 20 * med).sort((a, b) => a - b);
  return sp[sp.length >> 1];
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'inf');

function printMetrics(m: Metrics) {
  console.log(`  trades:          ${m.trades}${m.trades < 300 ? '   (below the 300 needed for gate 1)' : ''}`);
  console.log(`  win rate:        ${(m.winRate * 100).toFixed(1)}%   (avg win ${f(m.avgWinR)}R, avg loss ${f(m.avgLossR)}R)`);
  console.log(`  profit factor:   ${f(m.profitFactor)}`);
  console.log(`  expectancy:      ${f(m.expectancyR, 3)}R per trade   total ${f(m.totalR, 1)}R   t-stat ${f(m.tStat)}  (|t| < 2 = not distinguishable from zero)`);
  console.log(`  max drawdown:    ${f(m.maxDrawdownR, 1)}R  (~${f(m.maxDrawdownR * riskPct, 1)}% of balance at ${riskPct}% risk per trade)`);
  console.log(`  best / worst:    ${f(m.bestR)}R / ${f(m.worstR)}R   stops filled >10% past the stop: ${m.slipStops}`);
  console.log(`  exits:           ${Object.entries(m.exits).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

function dist(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

if (strategyName !== 'coinflip') {
  console.error(`unknown strategy "${strategyName}" (only the coinflip control exists at this stage)`);
  process.exit(1);
}

for (const symbol of symbols) {
  const series = loadSeries(symbol, range);
  if (series.quote.length < 2) {
    console.log(`${symbol}: no data`);
    continue;
  }
  const dir = symbol.startsWith('BOOM') ? 1 : -1;
  const spike = medianSpike(series, dir);
  const sl = num('sl', +(spike / 2).toFixed(2));
  const tp = num('tp', +(spike / 2).toFixed(2));
  const spread = num('spread', OBSERVED_SPREAD[symbol] ?? 0);
  const cfg = { spread, maxHold: num('max-hold', 1000), cooldown: num('cooldown', 0) };

  console.log(`\n=== ${symbol} | coin-flip control | ${series.quote.length} ticks (${((series.epoch[series.epoch.length - 1] - series.epoch[0]) / 86400).toFixed(2)} days, range ${range.join(':')}) ===`);
  console.log(`SL ${sl} pts, TP ${tp} pts (median spike ${spike.toFixed(2)}), spread ${spread}, max hold ${cfg.maxHold} ticks, cooldown ${cfg.cooldown}`);

  if (seeds === 1) {
    const seed = num('seed', 1);
    console.log(`\nNet of spread (seed ${seed}):`);
    printMetrics(computeMetrics(runBacktest(series, coinFlip(seed, sl, tp), cfg)));
    console.log(`\nZero-spread (seed ${seed}) - pure price behaviour, should be ~0:`);
    printMetrics(computeMetrics(runBacktest(series, coinFlip(seed, sl, tp), { ...cfg, spread: 0 })));
    continue;
  }

  const net: Metrics[] = [];
  const gross: Metrics[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    net.push(computeMetrics(runBacktest(series, coinFlip(seed, sl, tp), cfg)));
    gross.push(computeMetrics(runBacktest(series, coinFlip(seed, sl, tp), { ...cfg, spread: 0 })));
  }
  const row = (label: string, ms: Metrics[]) => {
    const e = dist(ms.map((m) => m.expectancyR));
    const pf = dist(ms.map((m) => m.profitFactor));
    const t = dist(ms.map((m) => m.tStat));
    const pos = ms.filter((m) => m.expectancyR > 0).length;
    const pass = ms.filter((m) => m.profitFactor > 1.3 && m.trades >= 300).length;
    console.log(
      `${label.padEnd(12)} trades ${f(dist(ms.map((m) => m.trades)).mean, 0).padStart(5)} | expectancy ${f(e.mean, 3)}R (sd ${f(e.sd, 3)}, ${f(e.min, 3)}..${f(e.max, 3)}) | PF ${f(pf.mean)} (${f(pf.min)}..${f(pf.max)}) | win ${(dist(ms.map((m) => m.winRate)).mean * 100).toFixed(1)}% | mean t ${f(t.mean)} | positive ${pos}/${ms.length} | PF>1.3 ${pass}/${ms.length} | maxDD ${f(dist(ms.map((m) => m.maxDrawdownR)).mean, 1)}R`,
    );
  };
  console.log(`\n${seeds} random seeds over the same price path:`);
  row('zero-spread', gross);
  row('net', net);
}
