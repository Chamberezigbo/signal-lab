import pg from 'pg';
import type { Tick } from './db.js';

/** Pool config for a Railway Postgres URL. Internal host needs no TLS; the public TCP proxy does. */
export function pgConfig(url: string): pg.PoolConfig {
  const internal = /\.railway\.internal(:|\/|$)/.test(url);
  return { connectionString: url, ssl: internal ? undefined : { rejectUnauthorized: false }, max: 4 };
}

export function connectPg(url: string) {
  const pool = new pg.Pool(pgConfig(url));
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS ticks (
      symbol TEXT NOT NULL,
      epoch  BIGINT NOT NULL,
      quote  DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (symbol, epoch)
    )`);
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
