import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from './config.js';

export interface Tick {
  symbol: string;
  epoch: number;
  quote: number;
}

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticks (
      symbol TEXT NOT NULL,
      epoch  INTEGER NOT NULL,
      quote  REAL NOT NULL,
      PRIMARY KEY (symbol, epoch)
    ) WITHOUT ROWID;
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO ticks (symbol, epoch, quote) VALUES (?, ?, ?)');
  const insertMany = db.transaction((rows: Tick[]) => {
    let added = 0;
    for (const r of rows) added += insert.run(r.symbol, r.epoch, r.quote).changes;
    return added;
  });
  const range = db.prepare('SELECT MIN(epoch) AS min, MAX(epoch) AS max, COUNT(*) AS n FROM ticks WHERE symbol = ?');
  return {
    db,
    /** Inserts ticks, ignoring duplicates. Returns number actually added. */
    insertTicks: (rows: Tick[]): number => insertMany(rows),
    range: (symbol: string) => range.get(symbol) as { min: number | null; max: number | null; n: number },
  };
}
