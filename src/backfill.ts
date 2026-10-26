import { SYMBOLS, PAGE_SIZE } from './config.js';
import { openDb } from './db.js';
import { DerivSocket } from './deriv.js';

// Usage: npm run backfill -- [days=7]
// Pages backwards from the newest tick until `days` of history are stored or the server runs out.
const days = Number(process.argv[2] ?? 7);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const store = openDb();
const sock = new DerivSocket();
await sock.connect();

for (const symbol of SYMBOLS) {
  const latest = await sock.ticksHistory(symbol, 'latest', PAGE_SIZE);
  if (!latest.length) throw new Error(`no ticks returned for ${symbol}`);
  const target = latest[latest.length - 1].epoch - days * 86400;
  store.insertTicks(latest);
  let oldest = latest[0].epoch;
  let pages = 1;
  console.log(`${symbol}: backfilling to ${new Date(target * 1000).toISOString()}`);

  while (oldest > target) {
    let batch;
    try {
      batch = await sock.ticksHistory(symbol, oldest - 1, PAGE_SIZE);
    } catch (e) {
      console.warn(`  ${(e as Error).message}; retrying in 5s`);
      await sleep(5000);
      continue;
    }
    if (!batch.length || batch[0].epoch >= oldest) {
      console.log('  server has no older ticks');
      break;
    }
    store.insertTicks(batch);
    oldest = batch[0].epoch;
    if (++pages % 50 === 0) {
      const pct = (1 - (oldest - target) / (days * 86400)) * 100;
      console.log(`  ${pages} pages, back to ${new Date(oldest * 1000).toISOString()} (~${pct.toFixed(0)}%)`);
    }
    await sleep(120); // stay well under rate limits
  }
  const r = store.range(symbol);
  console.log(`${symbol}: ${r.n} ticks stored (${new Date(r.min! * 1000).toISOString()} -> ${new Date(r.max! * 1000).toISOString()})`);
}
sock.close();
