import { SYMBOLS, PAGE_SIZE } from './config.js';
import type { Tick } from './db.js';
import { createStore } from './store.js';
import { DerivSocket } from './deriv.js';
import { health, startHealthServer } from './health.js';

// Appends live ticks for all configured symbols to Postgres (DATABASE_URL set) or local SQLite.
// Reconnects forever and back-fills gaps from ticks_history. If ticks stop flowing or the DB keeps
// failing, the process exits non-zero so the platform restart policy brings it back (see railway.json).
const store = createStore();
let buffer: Tick[] = [];
let total = 0;
let stopping = false;
let flushing = false;
let flushFailures = 0;

async function flush() {
  if (flushing || !buffer.length) return;
  flushing = true;
  const rows = buffer;
  buffer = [];
  try {
    total += await store.insertTicks(rows);
    health.lastStoreAt = Date.now();
    flushFailures = 0;
  } catch (e) {
    buffer = rows.concat(buffer); // keep for retry
    console.warn(`${new Date().toISOString()} store failed (${++flushFailures}): ${(e as Error).message}`);
    if (flushFailures >= 5) process.exit(1);
  } finally {
    flushing = false;
  }
}
setInterval(flush, 2000);

// Watchdog: no tick for 60s (after a 60s startup grace) means we are wedged; restart the process.
setInterval(() => {
  const last = Math.max(health.lastTickAt, health.startedAt);
  if (Date.now() - last > 60_000) {
    console.error(`${new Date().toISOString()} no ticks for 60s; exiting for restart`);
    process.exit(1);
  }
}, 10_000);

if (process.env.PORT) startHealthServer(Number(process.env.PORT));

async function fillGap(sock: DerivSocket, symbol: string) {
  const last = await store.maxEpoch(symbol);
  if (last == null) return;
  let end: number | 'latest' = 'latest';
  for (;;) {
    const batch = await sock.ticksHistory(symbol, end, PAGE_SIZE);
    if (!batch.length) return;
    await store.insertTicks(batch);
    if (batch[0].epoch <= last) return;
    end = batch[0].epoch - 1;
  }
}

async function session() {
  const sock = new DerivSocket();
  await sock.connect();
  sock.onTick = (t) => {
    health.lastTickAt = Date.now();
    buffer.push(t);
  };
  for (const s of SYMBOLS) await sock.request({ ticks: s, subscribe: 1 });
  for (const s of SYMBOLS) await fillGap(sock, s);
  console.log(`${new Date().toISOString()} recording ${SYMBOLS.join(', ')} -> ${store.kind}`);
  await new Promise<void>((resolve) => (sock.onClose = resolve));
}

async function shutdown() {
  stopping = true;
  await flush();
  console.log(`stopped; ${total} ticks added this run`);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

let backoff = 1000;
while (!stopping) {
  try {
    await session();
    backoff = 1000;
  } catch (e) {
    console.warn(`${new Date().toISOString()} ${(e as Error).message}`);
  }
  await flush();
  console.warn(`disconnected; reconnecting in ${backoff / 1000}s`);
  await new Promise((r) => setTimeout(r, backoff));
  backoff = Math.min(backoff * 2, 30_000);
}
