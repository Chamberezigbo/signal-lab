import 'dotenv/config';
import { SYMBOLS } from './config.js';
import { openDb } from './db.js';
import { connectPg } from './store-pg.js';

// npm run seed-remote: one-time push of existing local ticks to Railway Postgres so the server starts with no gap.
// Safe to re-run (duplicates are ignored).
const url = process.env.DATABASE_PUBLIC_URL;
if (!url) {
  console.error('Set DATABASE_PUBLIC_URL in .env (Railway Postgres > Variables, with Public Access enabled).');
  process.exit(1);
}
const local = openDb();
const remote = connectPg(url);
for (const symbol of SYMBOLS) {
  const rows = local.db.prepare('SELECT symbol, epoch, quote FROM ticks WHERE symbol = ? ORDER BY epoch').all(symbol) as { symbol: string; epoch: number; quote: number }[];
  const added = await remote.insertTicks(rows);
  console.log(`${symbol}: ${rows.length} local ticks, ${added} newly added remotely`);
}
await remote.close();
