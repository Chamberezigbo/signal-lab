import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RiskGuardian, type GuardianConfig, type GuardianEvent, type GuardianState } from './guardian.js';

export const STATE_PATH = process.env.GUARDIAN_STATE ?? 'data/guardian.json';
export const JOURNAL_PATH = process.env.GUARDIAN_JOURNAL ?? 'data/guardian-journal.jsonl';

/** Append-only journal: one JSON line per decision or outcome. */
export function journal(e: GuardianEvent, path = JOURNAL_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ ...e, iso: new Date(e.at).toISOString() }) + '\n');
}

export function save(g: RiskGuardian, path = STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ config: g.config, state: g.state }, null, 2));
  renameSync(tmp, path); // atomic replace
}

export function load(path = STATE_PATH, onEvent: (e: GuardianEvent) => void = journal): RiskGuardian | null {
  if (!existsSync(path)) return null;
  const { config, state } = JSON.parse(readFileSync(path, 'utf8')) as { config: GuardianConfig; state: GuardianState };
  return new RiskGuardian(config, state, onEvent);
}
