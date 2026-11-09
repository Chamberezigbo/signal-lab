// Risk guardian: pure rules, no I/O, no trading. It only answers "is this entry allowed?" and tracks outcomes.
// All times are epoch milliseconds so the clock is injectable and every rule is testable.

export interface GuardianConfig {
  maxDailyLossPct: number; // lock for the rest of the day once realized loss today reaches this % of the day's opening balance
  maxTradesPerDay: number; // entries per day
  maxConsecutiveLosses: number; // this many losses in a row trigger a cooldown
  cooldownMinutes: number;
  maxRiskPerTradePct: number; // per-trade risk cap, % of current balance
  maxOpenPositions: number;
  utcOffsetMinutes: number; // where the "day" starts: 60 = Africa/Lagos (no DST)
}

export const DEFAULT_CONFIG: GuardianConfig = {
  maxDailyLossPct: 3,
  maxTradesPerDay: 5,
  maxConsecutiveLosses: 2,
  cooldownMinutes: 30,
  maxRiskPerTradePct: 1,
  maxOpenPositions: 1,
  utcOffsetMinutes: 60,
};

export interface GuardianState {
  balance: number;
  dayKey: number;
  dayStartBalance: number;
  pnlToday: number; // realized
  tradesToday: number;
  openPositions: number;
  consecutiveLosses: number;
  cooldownUntil: number; // epoch ms, 0 = none
  lastAt: number; // latest timestamp seen; time never moves backwards
}

export type DenyCode = 'cooldown' | 'daily_loss_limit' | 'trade_cap' | 'no_stop' | 'risk_too_high' | 'position_open' | 'bad_input';

export interface Decision {
  allowed: boolean;
  reasons: { code: DenyCode; message: string }[];
  unlockAt: number | null; // epoch ms when the time-based locks lift (null if nothing time-based blocks)
}

export interface EntryRequest {
  riskPct: number;
  hasStop: boolean;
}

export type GuardianEvent =
  | { type: 'entry_allowed'; at: number; request: EntryRequest }
  | { type: 'entry_denied'; at: number; request: EntryRequest; decision: Decision }
  | { type: 'trade_closed'; at: number; pnl: number; balance: number; consecutiveLosses: number; cooldownUntil: number }
  | { type: 'day_rollover'; at: number; dayKey: number; dayStartBalance: number };

const MIN = 60_000;
const DAY = 86_400_000;

export class RiskGuardian {
  readonly state: GuardianState;

  constructor(
    readonly config: GuardianConfig,
    state: GuardianState,
    private onEvent: (e: GuardianEvent) => void = () => {},
  ) {
    this.state = { ...state };
  }

  static create(startingBalance: number, now: number, config: Partial<GuardianConfig> = {}, onEvent?: (e: GuardianEvent) => void) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const g = new RiskGuardian(
      cfg,
      {
        balance: startingBalance,
        dayKey: Math.floor((now + cfg.utcOffsetMinutes * MIN) / DAY),
        dayStartBalance: startingBalance,
        pnlToday: 0,
        tradesToday: 0,
        openPositions: 0,
        consecutiveLosses: 0,
        cooldownUntil: 0,
        lastAt: now,
      },
      onEvent,
    );
    return g;
  }

  private dayKey(t: number) {
    return Math.floor((t + this.config.utcOffsetMinutes * MIN) / DAY);
  }

  /** First instant of the next day in the configured offset. */
  nextDayStart(t: number) {
    return (this.dayKey(t) + 1) * DAY - this.config.utcOffsetMinutes * MIN;
  }

  private rollover(t: number) {
    const k = this.dayKey(t);
    if (k !== this.state.dayKey) {
      Object.assign(this.state, { dayKey: k, dayStartBalance: this.state.balance, pnlToday: 0, tradesToday: 0, consecutiveLosses: 0 });
      this.onEvent({ type: 'day_rollover', at: t, dayKey: k, dayStartBalance: this.state.balance });
    }
  }

  private tick(at: number) {
    const t = Math.max(at, this.state.lastAt); // never go backwards
    this.state.lastAt = t;
    this.rollover(t);
    return t;
  }

  /** The state as it would be at time t, applying the day rollover to a copy (no mutation). */
  private stateAt(t: number): GuardianState {
    const k = this.dayKey(t);
    if (k === this.state.dayKey) return this.state;
    return { ...this.state, dayKey: k, dayStartBalance: this.state.balance, pnlToday: 0, tradesToday: 0, consecutiveLosses: 0 };
  }

  private evaluate(t: number, req?: EntryRequest): Decision {
    const s = this.stateAt(t);
    const c = this.config;
    const reasons: Decision['reasons'] = [];
    let unlockAt: number | null = null;
    const lift = (x: number) => (unlockAt = Math.max(unlockAt ?? 0, x));

    if (t < s.cooldownUntil) {
      reasons.push({ code: 'cooldown', message: `cooldown after ${s.consecutiveLosses} losses in a row; ${Math.ceil((s.cooldownUntil - t) / MIN)} min left` });
      lift(s.cooldownUntil);
    }
    if (s.pnlToday <= -(c.maxDailyLossPct / 100) * s.dayStartBalance) {
      reasons.push({ code: 'daily_loss_limit', message: `daily loss limit of ${c.maxDailyLossPct}% reached; locked until the next day` });
      lift(this.nextDayStart(t));
    }
    if (s.tradesToday >= c.maxTradesPerDay) {
      reasons.push({ code: 'trade_cap', message: `${c.maxTradesPerDay} trades already taken today; locked until the next day` });
      lift(this.nextDayStart(t));
    }
    if (s.openPositions >= c.maxOpenPositions) {
      reasons.push({ code: 'position_open', message: `already ${s.openPositions} open position(s)` });
    }
    if (req) {
      if (!Number.isFinite(req.riskPct) || req.riskPct <= 0) reasons.push({ code: 'bad_input', message: 'risk % must be a positive number' });
      else if (req.riskPct > c.maxRiskPerTradePct) reasons.push({ code: 'risk_too_high', message: `risk ${req.riskPct}% exceeds the ${c.maxRiskPerTradePct}% per-trade cap` });
      if (!req.hasStop) reasons.push({ code: 'no_stop', message: 'every trade needs a stop loss' });
    }
    return { allowed: reasons.length === 0, reasons, unlockAt };
  }

  /** Read-only: would an entry be allowed now? */
  check(now: number, req?: EntryRequest): Decision {
    return this.evaluate(Math.max(now, this.state.lastAt), req);
  }

  /**
   * The enforced entry point. Call it when you intend to open a trade; only open one if it returns allowed.
   * Every attempt, allowed or denied, is logged so the record cannot be cherry-picked.
   */
  openTrade(now: number, req: EntryRequest): Decision {
    const t = this.tick(now);
    const d = this.evaluate(t, req);
    if (d.allowed) {
      this.state.tradesToday += 1;
      this.state.openPositions += 1;
      this.onEvent({ type: 'entry_allowed', at: t, request: req });
    } else {
      this.onEvent({ type: 'entry_denied', at: t, request: req, decision: d });
    }
    return d;
  }

  /** Record a closed trade's realized P&L (account currency). Losses in a row trigger the cooldown. */
  closeTrade(now: number, pnl: number) {
    const t = this.tick(now);
    const s = this.state;
    s.balance += pnl;
    s.pnlToday += pnl;
    s.openPositions = Math.max(0, s.openPositions - 1);
    if (pnl < 0) {
      s.consecutiveLosses += 1;
      if (s.consecutiveLosses >= this.config.maxConsecutiveLosses) s.cooldownUntil = Math.max(s.cooldownUntil, t + this.config.cooldownMinutes * MIN);
    } else if (pnl > 0) {
      s.consecutiveLosses = 0; // a breakeven neither extends nor breaks a streak
    }
    this.onEvent({ type: 'trade_closed', at: t, pnl, balance: s.balance, consecutiveLosses: s.consecutiveLosses, cooldownUntil: s.cooldownUntil });
  }
}
