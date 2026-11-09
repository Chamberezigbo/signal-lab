import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, RiskGuardian, type GuardianEvent } from './guardian.js';

const T0 = Date.UTC(2026, 10, 10, 8, 0, 0); // 2026-11-10 09:00 Lagos
const min = (n: number) => n * 60_000;
const ok = { riskPct: 1, hasStop: true };
const mk = (cfg = {}, events: GuardianEvent[] = []) => RiskGuardian.create(1000, T0, cfg, (e) => events.push(e));
const trade = (g: RiskGuardian, t: number, pnl: number) => {
  const d = g.openTrade(t, ok);
  assert.ok(d.allowed, `entry should be allowed at +${(t - T0) / 60000}min: ${d.reasons.map((r) => r.code)}`);
  g.closeTrade(t + min(1), pnl);
};
const codes = (g: RiskGuardian, t: number, req = ok) => g.check(t, req).reasons.map((r) => r.code);

test('a fresh account may trade', () => {
  assert.deepEqual(mk().check(T0, ok), { allowed: true, reasons: [], unlockAt: null });
});

test('every trade needs a stop, and risk is capped', () => {
  const g = mk();
  assert.deepEqual(codes(g, T0, { riskPct: 1, hasStop: false }), ['no_stop']);
  assert.deepEqual(codes(g, T0, { riskPct: 1.5, hasStop: true }), ['risk_too_high']);
  assert.deepEqual(codes(g, T0, { riskPct: 0, hasStop: true }), ['bad_input']);
  assert.deepEqual(codes(g, T0, { riskPct: NaN, hasStop: true }), ['bad_input']);
  assert.equal(g.state.tradesToday, 0); // check() has no side effects
});

test('two losses in a row start a 30 minute cooldown; allowed again exactly when it ends', () => {
  const g = mk();
  trade(g, T0, -5);
  assert.ok(g.check(T0 + min(2), ok).allowed, 'one loss is fine');
  trade(g, T0 + min(5), -5); // closes at +6
  const closedAt = T0 + min(6);
  assert.deepEqual(codes(g, closedAt + min(10)), ['cooldown']);
  assert.deepEqual(codes(g, closedAt + min(29)), ['cooldown']);
  assert.equal(g.check(closedAt + min(10), ok).unlockAt, closedAt + min(30));
  assert.deepEqual(codes(g, closedAt + min(30)), []);
});

test('a win resets the streak, so loss-win-loss never triggers the cooldown', () => {
  const g = mk();
  trade(g, T0, -5);
  trade(g, T0 + min(5), +5);
  trade(g, T0 + min(10), -5);
  assert.deepEqual(codes(g, T0 + min(15)), []);
});

test('a breakeven does not reset a loss streak', () => {
  const g = mk();
  trade(g, T0, -5);
  trade(g, T0 + min(5), 0);
  trade(g, T0 + min(10), -5);
  assert.deepEqual(codes(g, T0 + min(15)), ['cooldown']);
});

test('after a cooldown, one more loss immediately triggers another (the streak is not forgiven)', () => {
  const g = mk();
  trade(g, T0, -5);
  trade(g, T0 + min(5), -5);
  const after = T0 + min(6 + 31);
  trade(g, after, -5); // third loss in a row
  assert.deepEqual(codes(g, after + min(5)), ['cooldown']);
});

test('daily loss limit locks until the next day in Lagos time', () => {
  const g = mk({ maxConsecutiveLosses: 99 }); // isolate the daily limit
  trade(g, T0, -20);
  trade(g, T0 + min(10), -9);
  assert.deepEqual(codes(g, T0 + min(20)), []); // -29 of -30 allowed
  trade(g, T0 + min(20), -1); // exactly -30 = 3% of 1000
  assert.deepEqual(codes(g, T0 + min(30)), ['daily_loss_limit']);
  const nextDay = Date.UTC(2026, 10, 10, 23, 0, 0); // 00:00 on 11 Nov in Lagos (UTC+1)
  assert.equal(g.check(T0 + min(30), ok).unlockAt, nextDay);
  assert.deepEqual(codes(g, nextDay - 1), ['daily_loss_limit']);
  assert.deepEqual(codes(g, nextDay), []);
});

test('the new day measures the limit against the new opening balance', () => {
  const g = mk({ maxConsecutiveLosses: 99 });
  trade(g, T0, -30); // balance 970
  const nextDay = Date.UTC(2026, 10, 10, 23, 0, 0);
  g.openTrade(nextDay, ok);
  assert.equal(g.state.dayStartBalance, 970);
  assert.equal(g.state.pnlToday, 0);
  g.closeTrade(nextDay + min(1), -29.1); // 3% of 970 is 29.1
  assert.deepEqual(codes(g, nextDay + min(2)), ['daily_loss_limit']);
});

test('trade cap is per day and counts entries, not closes', () => {
  const g = mk({ maxTradesPerDay: 3, maxOpenPositions: 5 });
  for (let i = 0; i < 3; i++) assert.ok(g.openTrade(T0 + min(i), ok).allowed);
  assert.deepEqual(codes(g, T0 + min(3)), ['trade_cap']);
  const d = g.openTrade(T0 + min(3), ok);
  assert.equal(d.allowed, false);
  assert.equal(g.state.tradesToday, 3); // a denied attempt does not count
});

test('only one open position by default', () => {
  const g = mk();
  assert.ok(g.openTrade(T0, ok).allowed);
  assert.deepEqual(codes(g, T0 + min(1)), ['position_open']);
  g.closeTrade(T0 + min(2), 3);
  assert.deepEqual(codes(g, T0 + min(3)), []);
});

test('midnight rollover happens at 00:00 Lagos (23:00 UTC), not at 00:00 UTC', () => {
  const g = mk({ maxTradesPerDay: 1 });
  trade(g, Date.UTC(2026, 10, 10, 22, 0, 0), 1);
  assert.deepEqual(codes(g, Date.UTC(2026, 10, 10, 22, 30, 0)), ['trade_cap']);
  assert.deepEqual(codes(g, Date.UTC(2026, 10, 10, 23, 0, 0)), []); // new Lagos day
});

test('reasons stack and unlockAt is the latest time-based lift', () => {
  const g = mk({ maxConsecutiveLosses: 2, maxDailyLossPct: 1 });
  trade(g, T0, -6);
  trade(g, T0 + min(5), -6); // -12 of -10 limit, and cooldown
  const d = g.check(T0 + min(10), { riskPct: 5, hasStop: false });
  assert.deepEqual(d.reasons.map((r) => r.code).sort(), ['cooldown', 'daily_loss_limit', 'no_stop', 'risk_too_high']);
  assert.equal(d.unlockAt, Date.UTC(2026, 10, 10, 23, 0, 0)); // next day beats the 30 min cooldown
});

test('time never moves backwards: an old timestamp cannot dodge a cooldown', () => {
  const g = mk();
  trade(g, T0 + min(60), -5);
  trade(g, T0 + min(65), -5);
  assert.deepEqual(codes(g, T0), ['cooldown']); // asking "as of" an earlier time still sees the lock
  assert.equal(g.openTrade(T0, ok).allowed, false);
});

test('a trade closing while locked is still recorded and can extend the cooldown', () => {
  const g = mk({ maxOpenPositions: 2 });
  g.openTrade(T0, ok);
  g.openTrade(T0 + min(1), ok);
  g.closeTrade(T0 + min(5), -5);
  g.closeTrade(T0 + min(10), -5); // second loss: cooldown starts now
  assert.equal(g.state.cooldownUntil, T0 + min(40));
  g.openTrade(T0 + min(20), ok); // denied
  assert.equal(g.state.balance, 990);
});

test('every attempt is journaled, including the denied ones', () => {
  const events: GuardianEvent[] = [];
  const g = mk({}, events);
  g.openTrade(T0, { riskPct: 5, hasStop: true }); // denied
  g.openTrade(T0 + 1, ok); // allowed
  g.closeTrade(T0 + min(1), -5);
  assert.deepEqual(events.map((e) => e.type), ['entry_denied', 'entry_allowed', 'trade_closed']);
  const denied = events[0] as Extract<GuardianEvent, { type: 'entry_denied' }>;
  assert.equal(denied.decision.reasons[0].code, 'risk_too_high');
});

test('state survives a save/load round trip and keeps enforcing', () => {
  const g = mk();
  trade(g, T0, -5);
  trade(g, T0 + min(5), -5);
  const g2 = new RiskGuardian(JSON.parse(JSON.stringify(g.config)), JSON.parse(JSON.stringify(g.state)));
  assert.deepEqual(codes(g2, T0 + min(10)), ['cooldown']);
});

test('defaults match the plan: 1% risk, 3% daily loss, 2 losses -> 30 min', () => {
  assert.equal(DEFAULT_CONFIG.maxRiskPerTradePct, 1);
  assert.equal(DEFAULT_CONFIG.maxDailyLossPct, 3);
  assert.equal(DEFAULT_CONFIG.maxConsecutiveLosses, 2);
  assert.equal(DEFAULT_CONFIG.cooldownMinutes, 30);
});
