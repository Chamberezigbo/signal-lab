import { existsSync, readFileSync } from 'node:fs';
import { JOURNAL_PATH } from '../guardian/store.js';
import { flipControl, summarize, tradesFromJournal, type JournalEvent } from './meter.js';

// npm run meter -- [--journal path] [--last N]
// Reads the guardian journal (data/guardian-journal.jsonl) and prints the honest record.
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const path = args.get('journal') ?? JOURNAL_PATH;
if (!existsSync(path)) {
  console.error(`no journal at ${path}. Trade through \`npm run guardian\` first (open / close) so every trade is recorded.`);
  process.exit(1);
}
const events = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalEvent);
const ing = tradesFromJournal(events);
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'inf');

console.log(`=== HONESTY METER (${path}) ===`);
console.log(`entries allowed ${ing.entriesAllowed} | entries denied by the guardian ${ing.denied}${ing.denied ? ' (' + Object.entries(ing.deniedByReason).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''}`);
if (ing.unpaired) console.log(`note: ${ing.unpaired} closed trade(s) had no logged entry and are excluded (R unknown)`);
const n = ing.trades.length;
if (n === 0) {
  console.log('no closed trades yet.');
  process.exit(0);
}

const s = summarize(ing.trades);
console.log(`\nclosed trades:    ${s.n}`);
console.log(`win rate:         ${f(s.winRate * 100, 1)}%   (95% interval ${f(s.winRateCI[0] * 100, 0)}% to ${f(s.winRateCI[1] * 100, 0)}%)`);
console.log(`profit factor:    ${f(s.profitFactor)}`);
console.log(`expectancy:       ${f(s.expectancyR, 3)}R per trade   total ${f(s.totalR, 1)}R   t-stat ${f(s.tStat)}`);
console.log(`net P&L:          ${f(s.netPnl)}   max drawdown ${f(s.maxDrawdownPct, 1)}% of peak   longest losing streak ${s.longestLossStreak}`);

const c = flipControl(ing.trades);
console.log(`\ncoin-flip control (same trade sizes, random direction, ${c.sims} runs, before costs):`);
console.log(`  luck band for total R: ${f(c.p2_5, 1)} to ${f(c.p97_5, 1)} (middle ${f(c.p50, 1)})   yours: ${f(s.totalR, 1)}`);
console.log(`  you beat ${f(c.percentile, 1)}% of coin-flip runs (p = ${f(c.pValue, 3)} that a coin flip does at least as well)`);

console.log('\nVerdict:');
if (n < 30) console.log(`  Only ${n} trades: far too few to say anything. Plan gate: 300+ trades.`);
else if (n < 300) console.log(`  ${n} trades: below the 300 the plan asks for, so treat any pattern as provisional.`);
if (s.totalR > c.p97_5 && c.pValue < 0.01) console.log('  Clearly above the coin-flip band. Still needs more trades and an out-of-sample period before trusting it.');
else if (s.totalR >= c.p2_5 && s.totalR <= c.p97_5) console.log('  Inside the luck band: this record cannot be told apart from coin-flipping.');
else if (s.totalR < c.p2_5) console.log('  Below the luck band: worse than a coin flip, which usually means costs or poor timing are eating the result.');
else console.log('  Above the median but not clearly outside the luck band.');
if (s.winRate > 0.6 && s.profitFactor < 1) console.log('  Warning: high win rate but losing money. A few big losses are wiping out many small wins.');
const last = Number(args.get('last') ?? 0);
if (last > 0) {
  console.log(`\nlast ${last} trades:`);
  for (const t of ing.trades.slice(-last)) console.log(`  ${new Date(t.at).toISOString()}  pnl ${f(t.pnl).padStart(8)}  ${f(t.r).padStart(6)}R  balance ${f(t.balanceAfter)}`);
}
