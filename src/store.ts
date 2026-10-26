import { openDb, type Tick } from './db.js';
import { connectPg } from './store-pg.js';

export interface TickStore {
  insertTicks(rows: Tick[]): Promise<number>;
  maxEpoch(symbol: string): Promise<number | null>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'sqlite';
}

/** Postgres when DATABASE_URL is set (server), otherwise local SQLite. */
export function createStore(): TickStore {
  const url = process.env.DATABASE_URL;
  if (url) {
    const s = connectPg(url);
    return { kind: 'postgres', insertTicks: s.insertTicks, maxEpoch: s.maxEpoch, close: s.close };
  }
  const s = openDb();
  return {
    kind: 'sqlite',
    insertTicks: async (rows) => s.insertTicks(rows),
    maxEpoch: async (symbol) => s.range(symbol).max,
    close: async () => void s.db.close(),
  };
}
