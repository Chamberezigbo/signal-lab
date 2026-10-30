import type { Series, Signal, Strategy } from './types.js';

/** Small seeded PRNG so control runs are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random-control strategy: enters a random direction whenever flat, with the same SL/TP a real strategy would use. */
export function coinFlip(seed: number, sl: number, tp: number): Strategy {
  const rng = mulberry32(seed);
  return {
    name: `coinflip(seed=${seed})`,
    onTick(_i: number, _s: Series): Signal | null {
      return { side: rng() < 0.5 ? 1 : -1, sl, tp };
    },
  };
}

import { ema, MEDIAN_SPIKE, SPIKE_DIR, ticksSinceSpike } from './features.js';

/** A: "a spike is due" - enter in the spike direction once at least K ticks have passed since the last spike. */
export function dueSpike(K: number, sl: number, tp: number): Strategy {
  let since: Int32Array;
  let dir: 1 | -1 = 1;
  return {
    name: `due-spike K=${K}`,
    prepare(s) {
      since = ticksSinceSpike(s);
      dir = SPIKE_DIR[s.symbol];
    },
    onTick: (i) => (since[i] >= K ? { side: dir, sl, tp } : null),
  };
}

/** B: EMA(fast) / EMA(slow) cross on the tick series; enter in the direction of the cross. */
export function maCross(fast: number, slow: number, sl: number, tp: number): Strategy {
  let f: Float64Array;
  let sw: Float64Array;
  return {
    name: `ma-cross ${fast}/${slow}`,
    prepare(s) {
      f = ema(s.quote, fast);
      sw = ema(s.quote, slow);
    },
    onTick(i) {
      if (i < slow) return null;
      const now = Math.sign(f[i] - sw[i]);
      const before = Math.sign(f[i - 1] - sw[i - 1]);
      return now !== 0 && before !== 0 && now !== before ? { side: now as 1 | -1, sl, tp } : null;
    },
  };
}

/** C: trade with the slow drift (against the spike direction) whenever flat and >= minSince ticks after a spike. */
export function driftScalp(minSince: number, sl: number, tp: number): Strategy {
  let since: Int32Array;
  let dir: 1 | -1 = 1;
  return {
    name: 'drift-scalp',
    prepare(s) {
      since = ticksSinceSpike(s);
      dir = SPIKE_DIR[s.symbol];
    },
    onTick: (i) => (since[i] >= minSince ? { side: (-dir) as 1 | -1, sl, tp } : null),
  };
}

export { MEDIAN_SPIKE };
