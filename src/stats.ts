import { SYMBOLS } from './config.js';
import { openDb } from './db.js';

// Prints tick counts, data gaps and spike statistics per index.
// Spike = a one-tick move in the spike direction (up for BOOM, down for CRASH) larger than
// K x the median absolute tick-to-tick move. Normal drift is tiny next to spikes (see sensitivity table).
const K = Number(process.argv[2] ?? 20);
const { db } = openDb();
const iso = (e: number) => new Date(e * 1000).toISOString().replace('.000Z', 'Z');
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function spikeGaps(rows: { epoch: number; quote: number }[], dir: 1 | -1, thr: number) {
  const gaps: number[] = [];
  let lastIdx = -1;
  let spikes = 0;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i].quote - rows[i - 1].quote) * dir > thr) {
      spikes++;
      if (lastIdx >= 0) gaps.push(i - lastIdx);
      lastIdx = i;
    }
  }
  return { spikes, gaps };
}

for (const symbol of SYMBOLS) {
  const rows = db.prepare('SELECT epoch, quote FROM ticks WHERE symbol = ? ORDER BY epoch').all(symbol) as { epoch: number; quote: number }[];
  if (rows.length < 2) {
    console.log(`${symbol}: no data`);
    continue;
  }
  const dir = symbol.startsWith('BOOM') ? 1 : -1;
  const expected = Number(symbol.match(/\d+/)![0]);
  const absDeltas = rows.slice(1).map((r, i) => Math.abs(r.quote - rows[i].quote));
  const med = median(absDeltas);
  const seconds = rows[rows.length - 1].epoch - rows[0].epoch;
  const missing = seconds + 1 - rows.length;
  const holes = rows.slice(1).filter((r, i) => r.epoch - rows[i].epoch > 1).length;

  console.log(`\n=== ${symbol} ===`);
  console.log(`ticks:        ${rows.length}`);
  console.log(`range:        ${iso(rows[0].epoch)} -> ${iso(rows[rows.length - 1].epoch)} (${(seconds / 86400).toFixed(2)} days)`);
  console.log(`missing secs: ${missing} in ${holes} gap(s)`);
  console.log(`median |move|: ${med.toFixed(4)}   spike threshold (${K}x): ${(K * med).toFixed(4)}`);

  const { spikes, gaps } = spikeGaps(rows, dir, K * med);
  if (gaps.length) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    console.log(`spikes:       ${spikes}   (theory: 1 per ${expected} ticks => ~${(rows.length / expected).toFixed(0)})`);
    console.log(`ticks between spikes: avg ${mean.toFixed(1)} | median ${median(gaps)} | min ${Math.min(...gaps)} | max ${Math.max(...gaps)}  (theory avg ${expected})`);
  } else {
    console.log(`spikes:       ${spikes} (need at least 2 to compute gaps)`);
  }
  const sens = [5, 10, 20, 40, 80].map((k) => `${k}x:${spikeGaps(rows, dir, k * med).spikes}`).join('  ');
  console.log(`sensitivity (spike count by threshold): ${sens}`);
  const opposite = spikeGaps(rows, dir === 1 ? -1 : 1, K * med).spikes;
  console.log(`large moves in the opposite direction: ${opposite}`);
}
