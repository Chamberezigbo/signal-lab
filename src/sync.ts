import 'dotenv/config';
import pg from 'pg';
import { SYMBOLS } from './config.js';
import { openDb } from './db.js';
import { assertPgUrl, pgConfig } from './store-pg.js';

// npm run sync: copy only NEW ticks (epoch > local max, per symbol) from Railway Postgres into local data/ticks.db.
// Uses DATABASE_PUBLIC_URL (needs Public Access enabled on the Railway Postgres service), else DATABASE_URL.
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_PUBLIC_URL in .env (Railway Postgres > Variables, with Public Access enabled).');
  process.exit(1);
}
assertPgUrl(url, 'DATABASE_PUBLIC_URL');
const PAGE = 50_000;
const local = openDb();
const pool = new pg.Pool(pgConfig(url));

for (const symbol of SYMBOLS) {
  let after = local.range(symbol).max ?? 0;
  let added = 0;
  for (;;) {
    const res = await pool.query(
      'SELECT epoch, quote FROM ticks WHERE symbol = $1 AND epoch > $2 ORDER BY epoch LIMIT $3',
      [symbol, after, PAGE],
    );
    if (!res.rows.length) break;
    added += local.insertTicks(res.rows.map((r) => ({ symbol, epoch: Number(r.epoch), quote: r.quote })));
    after = Number(res.rows[res.rows.length - 1].epoch);
  }
  const r = local.range(symbol);
  console.log(`${symbol}: +${added} new, ${r.n} total locally (latest ${r.max ? new Date(r.max * 1000).toISOString() : 'n/a'})`);
}
await pool.end();
