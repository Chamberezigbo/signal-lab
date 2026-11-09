import { computeMetrics, type Metrics } from '../backtest/metrics.js';
import { mulberry32 } from '../backtest/strategies.js';
import type { Trade } from '../backtest/types.js';

// Honesty meter: the true record of every trade the guardian saw, plus a coin-flip control, so the last three trades
// cannot be mistaken for skill. Pure functions; the CLI reads the guardian journal.

export interface JournalEvent {
  type: string;
  at: number;
  [k: string]: any;
}

export interface LoggedTrade {
  at: number; // close time
  pnl: number; // account currency
  r: number; // pnl / amount risked at entry
  riskPct: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface Ingest {
  trades: LoggedTrade[];
  unpaired: number; // closes with no logged entry (R unknown, excluded)
  entriesAllowed: number;
  denied: number;
  deniedByReason: Record<string, number>;
}

/** Pairs entries to closes first-in-first-out and expresses each result in R (profit / amount risked). */
export function tradesFromJournal(events: JournalEvent[]): Ingest {
  const open: { riskPct: number; balance: number }[] = [];
  const out: Ingest = { trades: [], unpaired: 0, entriesAllowed: 0, denied: 0, deniedByReason: {} };
  for (const e of events) {
    if (e.type === 'entry_allowed') {
      out.entriesAllowed++;
      open.push({ riskPct: e.request.riskPct, balance: e.balance });
    } else if (e.type === 'entry_denied') {
      out.denied++;
      for (const r of e.decision.reasons) out.deniedByReason[r.code] = (out.deniedByReason[r.code] ?? 0) + 1;
    } else if (e.type === 'trade_closed') {
      const entry = open.shift();
      if (!entry || !Number.isFinite(entry.balance)) {
        out.unpaired++;
        continue;
      }
      const risked = (entry.riskPct / 100) * entry.balance;
      out.trades.push({ at: e.at, pnl: e.pnl, r: e.pnl / risked, riskPct: entry.riskPct, balanceBefore: entry.balance, balanceAfter: e.balance });
    }
  }
  return out;
}

export interface Summary {
  n: number;
  winRate: number;
  winRateCI: [number, number]; // 95% Wilson interval
  profitFactor: number;
  expectancyR: number;
  totalR: number;
  tStat: number;
  maxDrawdownPct: number; // of peak balance, from the realized balance curve
  longestLossStreak: number;
  netPnl: number;
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

export function summarize(trades: LoggedTrade[]): Summary {
  // Reuse the backtester's metric code so the live record and the backtests are measured identically.
  const asBt: Trade[] = trades.map((t, i) => ({ entryIdx: i, exitIdx: i, side: 1, entry: 0, exit: 0, pnl: t.pnl, r: t.r, reason: 'end', held: 0 }));
  const m: Metrics = computeMetrics(asBt);
  const wins = trades.filter((t) => t.pnl > 0).length;

  let peak = trades.length ? trades[0].balanceBefore : 0;
  let dd = 0;
  for (const t of trades) {
    peak = Math.max(peak, t.balanceAfter);
    dd = Math.max(dd, (peak - t.balanceAfter) / peak);
  }
  let streak = 0;
  let longest = 0;
  for (const t of trades) {
    streak = t.pnl < 0 ? streak + 1 : t.pnl > 0 ? 0 : streak;
    longest = Math.max(longest, streak);
  }
  return {
    n: trades.length,
    winRate: m.winRate,
    winRateCI: wilson(wins, trades.length),
    profitFactor: m.profitFactor,
    expectancyR: m.expectancyR,
    totalR: m.totalR,
    tStat: m.tStat,
    maxDrawdownPct: dd * 100,
    longestLossStreak: longest,
    netPnl: trades.reduce((a, t) => a + t.pnl, 0),
  };
}

export interface FlipControl {
  sims: number;
  p2_5: number;
  p50: number;
  p97_5: number;
  percentile: number; // share of coin-flip runs the real total R beat, 0..100
  pValue: number; // share of coin-flip runs at least as good as the real total R
}

/**
 * Coin-flip control: keep every trade's size (|R|) but flip its sign at random, as if direction had been a coin toss before
 * costs. The real total R is then placed inside that luck band. A result inside the band cannot be told apart from luck.
 */
export function flipControl(trades: LoggedTrade[], sims = 20000, seed = 1): FlipControl {
  const rng = mulberry32(seed);
  const mags = trades.map((t) => Math.abs(t.r));
  const real = trades.reduce((a, t) => a + t.r, 0);
  const totals: number[] = [];
  for (let s = 0; s < sims; s++) {
    let tot = 0;
    for (const m of mags) tot += rng() < 0.5 ? m : -m;
    totals.push(tot);
  }
  totals.sort((a, b) => a - b);
  const q = (p: number) => totals[Math.min(sims - 1, Math.floor(p * sims))];
  const below = totals.filter((x) => x < real).length;
  const atLeast = totals.filter((x) => x >= real).length;
  return { sims, p2_5: q(0.025), p50: q(0.5), p97_5: q(0.975), percentile: (below / sims) * 100, pValue: atLeast / sims };
}
