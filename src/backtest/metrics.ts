import type { Trade } from './types.js';

export interface Metrics {
  trades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalR: number;
  expectancyR: number;
  sdR: number;
  tStat: number; // expectancy / standard error; |t| < 2 means indistinguishable from zero
  avgWinR: number;
  avgLossR: number;
  worstR: number;
  bestR: number;
  maxDrawdownR: number;
  exits: Record<string, number>;
  slipStops: number; // stop-outs filled more than 10% beyond the stop distance (gap slippage)
}

export function computeMetrics(trades: Trade[]): Metrics {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const rs = trades.map((t) => t.r);
  const totalR = rs.reduce((a, b) => a + b, 0);
  const mean = n ? totalR / n : 0;
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1)) : 0;

  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const exits: Record<string, number> = {};
  for (const t of trades) exits[t.reason] = (exits[t.reason] ?? 0) + 1;

  return {
    trades: n,
    winRate: n ? wins.length / n : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalPnl: trades.reduce((a, t) => a + t.pnl, 0),
    totalR,
    expectancyR: mean,
    sdR: sd,
    tStat: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0,
    avgWinR: wins.length ? wins.reduce((a, t) => a + t.r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((a, t) => a + t.r, 0) / losses.length : 0,
    worstR: n ? Math.min(...rs) : 0,
    bestR: n ? Math.max(...rs) : 0,
    maxDrawdownR: dd,
    exits,
    slipStops: trades.filter((t) => t.reason === 'sl' && t.r < -1.1).length,
  };
}
