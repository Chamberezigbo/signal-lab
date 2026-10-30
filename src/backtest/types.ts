export interface Series {
  symbol: string;
  epoch: Float64Array;
  quote: Float64Array; // mid price
}

/** Entry request. sl/tp are distances in price points from the fill price. */
export interface Signal {
  side: 1 | -1; // 1 = long (buy), -1 = short (sell)
  sl: number;
  tp: number;
}

export interface Strategy {
  name: string;
  /** Optional: precompute causal features (value at tick i may only use ticks 0..i). Called once before the replay. */
  prepare?(s: Series): void;
  /** Called on each tick while flat. May only look at ticks 0..i (no lookahead). The fill happens on tick i+1. */
  onTick(i: number, s: Series): Signal | null;
}

export type ExitReason = 'sl' | 'tp' | 'timeout' | 'gap' | 'end';

export interface Trade {
  entryIdx: number;
  exitIdx: number;
  side: 1 | -1;
  entry: number;
  exit: number;
  pnl: number; // points, after spread
  r: number; // pnl / stop distance
  reason: ExitReason;
  held: number; // ticks
}

export interface EngineConfig {
  spread: number; // full bid/ask spread in price points
  maxHold: number; // ticks; position is closed at market after this long
  cooldown: number; // ticks to stay flat after an exit
}
