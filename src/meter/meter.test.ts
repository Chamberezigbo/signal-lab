import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RiskGuardian, type GuardianEvent } from '../guardian/guardian.js';
import { flipControl, summarize, tradesFromJournal, type JournalEvent, type LoggedTrade } from './meter.js';

const T0 = Date.UTC(2026, 10, 10, 8, 0, 0);
const min = (n: number) => n * 60_000;

/** Runs trades through the real guardian so the meter is tested against the real journal format. */
function journalOf(pnls: number[], startBalance = 1000): JournalEvent[] {
  const ev: GuardianEvent[] = [];
  const g = RiskGuardian.create(startBalance, T0, { maxConsecutiveLosses: 99, maxTradesPerDay: 999, maxDailyLossPct: 99 }, (e) => ev.push(e));
  pnls.forEach((p, i) => {
    g.openTrade(T0 + min(i * 10), { riskPct: 1, hasStop: true });
    g.closeTrade(T0 + min(i * 10 + 5), p);
  });
  return ev as unknown as JournalEvent[];
}
const lt = (r: number, i = 0): LoggedTrade => ({ at: i, pnl: r, r, riskPct: 1, balanceBefore: 1000, balanceAfter: 1000 + r });

test('R is profit divided by the amount risked at entry', () => {
  const { trades } = tradesFromJournal(journalOf([-10, 20])); // risk is 1% of balance: 10, then 9.9
  assert.equal(trades.length, 2);
  assert.ok(Math.abs(trades[0].r - -1) < 1e-9);
  assert.ok(Math.abs(trades[1].r - 20 / 9.9) < 1e-9);
  assert.equal(trades[1].balanceBefore, 990);
});

test('denied attempts are counted by reason and are not trades', () => {
  const ev: GuardianEvent[] = [];
  const g = RiskGuardian.create(1000, T0, {}, (e) => ev.push(e));
  g.openTrade(T0, { riskPct: 5, hasStop: false }); // two reasons
  g.openTrade(T0 + 1, { riskPct: 1, hasStop: true });
  g.closeTrade(T0 + min(1), 5);
  const ing = tradesFromJournal(ev as unknown as JournalEvent[]);
  assert.equal(ing.denied, 1);
  assert.deepEqual(ing.deniedByReason, { risk_too_high: 1, no_stop: 1 });
  assert.equal(ing.entriesAllowed, 1);
  assert.equal(ing.trades.length, 1);
});

test('a close with no logged entry is excluded, not guessed', () => {
  const ing = tradesFromJournal([{ type: 'trade_closed', at: 1, pnl: 5, balance: 1005, consecutiveLosses: 0, cooldownUntil: 0 }]);
  assert.equal(ing.unpaired, 1);
  assert.equal(ing.trades.length, 0);
});

test('summary matches a hand-worked sequence', () => {
  // balances: 1010, 1005, 1000, 1020  -> wins 2 of 4, gross win 30, gross loss 10
  const { trades } = tradesFromJournal(journalOf([10, -5, -5, 20]));
  const s = summarize(trades);
  assert.equal(s.n, 4);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.netPnl, 20);
  assert.equal(s.longestLossStreak, 2);
  assert.ok(Math.abs(s.maxDrawdownPct - (10 / 1010) * 100) < 1e-9);
});

test('win-rate interval is wide for few trades and brackets the estimate', () => {
  const s = summarize([lt(1), lt(1), lt(-1), lt(1), lt(-1)]);
  assert.ok(s.winRateCI[0] < 0.6 && s.winRateCI[1] > 0.6);
  assert.ok(s.winRateCI[1] - s.winRateCI[0] > 0.4, 'n=5 must give a very wide interval');
});

test('coin-flip control: a winning-every-time record is far outside the luck band', () => {
  const c = flipControl(Array.from({ length: 30 }, (_, i) => lt(1, i)));
  assert.ok(c.pValue < 0.001);
  assert.ok(c.percentile > 99.9);
});

test('coin-flip control: a balanced record sits inside the luck band, and the band is centred on zero', () => {
  const trades = Array.from({ length: 200 }, (_, i) => lt(i % 2 === 0 ? 1.5 : -1.5, i));
  const c = flipControl(trades);
  const real = trades.reduce((a, t) => a + t.r, 0);
  assert.equal(real, 0);
  assert.ok(real >= c.p2_5 && real <= c.p97_5);
  assert.ok(Math.abs(c.p50) < 3);
  assert.ok(c.p97_5 > 0 && c.p2_5 < 0);
});

test('coin-flip control is reproducible for the same seed and respects trade size', () => {
  const t = [lt(1, 0), lt(2, 1), lt(-3, 2), lt(0.5, 3)];
  assert.deepEqual(flipControl(t, 2000, 7), flipControl(t, 2000, 7));
  const small = flipControl(t.map((x) => ({ ...x, r: x.r / 10 })), 2000, 7);
  const big = flipControl(t, 2000, 7);
  assert.ok(Math.abs(small.p97_5 * 10 - big.p97_5) < 1e-6, 'the band scales with trade size');
});

test('empty record does not crash', () => {
  const s = summarize([]);
  assert.equal(s.n, 0);
  assert.equal(s.maxDrawdownPct, 0);
});
