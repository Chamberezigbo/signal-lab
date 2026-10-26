import pg from 'pg';
import type { Tick } from './db.js';

/** Pool config for a Railway Postgres URL. Internal host needs no TLS; the public TCP proxy does. */
export function pgConfig(url: string): pg.PoolConfig {
  const internal = /\.railway\.internal(:|\/|$)/.test(url);
  return { connectionString: url, ssl: internal ? undefined : { rejectUnauthorized: false }, max: 4 };
}

/** Fails fast with a clear message (never echoing the value) if the URL is not a full Postgres connection string. */
export function assertPgUrl(url: string, name = 'DATABASE_URL') {
  let ok = false;
  try {
    const u = new URL(url);
    ok = /^postgres(ql)?:$/.test(u.protocol) && !!u.hostname && !!u.username && !!u.pathname.slice(1);
  } catch {}
  if (!ok) {
    console.error(`${name} is not a full connection string. Expected postgresql://USER:PASSWORD@HOST:PORT/DBNAME - copy it from the Postgres service's Variables tab (on Railway use the reference \${{Postgres.DATABASE_URL}}).`);
    process.exit(1);
  }
}

export function connectPg(url: string) {
  assertPgUrl(url);
  const pool = new pg.Pool(pgConfig(url));
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS ticks (
      symbol TEXT NOT NULL,
      epoch  BIGINT NOT NULL,
      quote  DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (symbol, epoch)
    )`);
  ready.catch(() => {}); // surfaced by the first insert/query; avoids an unhandled rejection crash
  return {
    pool,
    ready,
    /** Inserts ticks, ignoring duplicates. Returns number actually added. */
    async insertTicks(rows: Tick[]): Promise<number> {
      await ready;
      let added = 0;
      for (let i = 0; i < rows.length; i += 5000) {
        const chunk = rows.slice(i, i + 5000);
        const res = await pool.query(
          `INSERT INTO ticks (symbol, epoch, quote)
           SELECT * FROM unnest($1::text[], $2::bigint[], $3::double precision[])
           ON CONFLICT DO NOTHING`,
          [chunk.map((r) => r.symbol), chunk.map((r) => r.epoch), chunk.map((r) => r.quote)],
        );
        added += res.rowCount ?? 0;
      }
      return added;
    },
    async maxEpoch(symbol: string): Promise<number | null> {
      await ready;
      const res = await pool.query('SELECT MAX(epoch) AS max FROM ticks WHERE symbol = $1', [symbol]);
      return res.rows[0].max == null ? null : Number(res.rows[0].max);
    },
    close: () => pool.end(),
  };
}
