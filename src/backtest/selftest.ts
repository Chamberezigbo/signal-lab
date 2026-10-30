import assert from 'node:assert/strict';
import { runBacktest } from './engine.js';
import type { Series, Strategy } from './types.js';

// Hand-built price paths with known answers. Run: npm run backtest:test
const series = (quotes: number[], holeAt?: number): Series => ({
  symbol: 'TEST',
  epoch: Float64Array.from(quotes, (_, i) => 1000 + i + (holeAt !== undefined && i >= holeAt ? 10 : 0)),
  quote: Float64Array.from(quotes),
});
const once = (side: 1 | -1, sl: number, tp: number): Strategy => {
  let fired = false;
  return { name: 'once', onTick: () => (fired ? null : ((fired = true), { side, sl, tp })) };
};
const cfg = { spread: 0.2, maxHold: 50, cooldown: 0 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

// 1. Flat market: signal on tick 0 fills on tick 1 (no lookahead); a flat long loses exactly the spread, exits on timeout.
{
  const t = runBacktest(series(Array(80).fill(100)), once(1, 1, 1), { ...cfg, maxHold: 10 });
  assert.equal(t.length, 1);
  assert.equal(t[0].entryIdx, 1);
  assert.equal(t[0].reason, 'timeout');
  near(t[0].pnl, -0.2);
}
// 2. Spike through the target: filled at the spike tick's price, not at the TP level.
{
  const q = [100, 100, 100, 100, 103, 103, 103];
  const t = runBacktest(series(q), once(1, 1, 1), cfg);
  assert.equal(t[0].reason, 'tp');
  assert.equal(t[0].exitIdx, 4);
  near(t[0].pnl, 103 - 0.1 - (100 + 0.1)); // exit at bid, entry at ask
  near(t[0].r, 2.8);
}
// 3. Short hit by a spike: stop fills far past the stop level (slippage), loss > 1R.
{
  const q = [100, 100, 100, 100, 104, 104];
  const t = runBacktest(series(q), once(-1, 1, 1), cfg);
  assert.equal(t[0].reason, 'sl');
  near(t[0].pnl, (100 - 0.1) - (104 + 0.1));
  assert.ok(t[0].r < -4);
}
// 4. Gradual drift stop fills at the first tick beyond the stop.
{
  const q = [100, 100, 99.8, 99.5, 99.0, 98.9];
  const t = runBacktest(series(q), once(1, 1, 1), cfg);
  assert.equal(t[0].reason, 'sl');
  assert.equal(t[0].exitIdx, 4); // exit px 98.9 <= entry 100.1 - 1 = 99.1
}
// 5. A hole in the data closes the open position on the first tick after it.
{
  const q = [100, 100, 100, 100, 100, 100, 100];
  const t = runBacktest(series(q, 4), once(1, 5, 5), cfg);
  assert.equal(t[0].reason, 'gap');
  assert.equal(t[0].exitIdx, 4);
}
// 6. Same-tick re-entry is impossible: after an exit on tick k the next entry is no earlier than k+2.
{
  const q = [100, 100, 100, 103, 103, 103, 103, 103];
  const always: Strategy = { name: 'always', onTick: () => ({ side: 1, sl: 1, tp: 1 }) };
  const t = runBacktest(series(q), always, cfg);
  assert.ok(t.every((x, i) => i === 0 || x.entryIdx >= t[i - 1].exitIdx + 2));
}
console.log('backtest self-test: all checks passed');
