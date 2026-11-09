import { RiskGuardian, type Decision } from './guardian.js';
import { journal, load, save, STATE_PATH } from './store.js';

// npm run guardian -- init <balance>
//                  -- status
//                  -- open <riskPct> [--no-stop]     ask permission to enter (logged either way)
//                  -- close <pnl>                    record a closed trade's realized P&L (negative for a loss)
// There is deliberately no "reset" or "override" command. Note: a CLI cannot truly stop you from editing the state file;
// real enforcement needs the app/broker to call this module. Until then this is a discipline tool, not a lock.
const [cmd, ...rest] = process.argv.slice(2);
const now = Date.now();
const fmtTime = (t: number) => new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' (Lagos)';

function show(d: Decision) {
  if (d.allowed) console.log('ALLOWED');
  else {
    console.log('DENIED');
    for (const r of d.reasons) console.log(`  - ${r.message}`);
    if (d.unlockAt) console.log(`  unlocks: ${fmtTime(d.unlockAt)}`);
  }
}

if (cmd === 'init') {
  const bal = Number(rest[0]);
  if (!Number.isFinite(bal) || bal <= 0) throw new Error('usage: init <balance>');
  if (load(STATE_PATH, () => {})) throw new Error(`${STATE_PATH} already exists; refusing to overwrite (that would erase today's limits)`);
  const g = RiskGuardian.create(bal, now, {}, journal);
  save(g);
  console.log(`initialised with balance ${bal}`, g.config);
} else {
  const g = load();
  if (!g) throw new Error('no state yet: run `npm run guardian -- init <balance>`');
  if (cmd === 'status') {
    g.check(now); // read-only
    const s = g.state;
    const lossLimit = (g.config.maxDailyLossPct / 100) * s.dayStartBalance;
    console.log(`balance ${s.balance.toFixed(2)} | today: pnl ${s.pnlToday.toFixed(2)} of -${lossLimit.toFixed(2)} limit, ${s.tradesToday}/${g.config.maxTradesPerDay} trades, ${s.openPositions} open, loss streak ${s.consecutiveLosses}`);
    show(g.check(now, { riskPct: g.config.maxRiskPerTradePct, hasStop: true }));
  } else if (cmd === 'open') {
    const risk = Number(rest[0]);
    show(g.openTrade(now, { riskPct: risk, hasStop: !rest.includes('--no-stop') }));
    save(g);
  } else if (cmd === 'close') {
    const pnl = Number(rest[0]);
    if (!Number.isFinite(pnl)) throw new Error('usage: close <pnl>');
    g.closeTrade(now, pnl);
    save(g);
    console.log(`recorded ${pnl}; balance ${g.state.balance.toFixed(2)}`);
    show(g.check(now, { riskPct: g.config.maxRiskPerTradePct, hasStop: true }));
  } else {
    console.error('commands: init <balance> | status | open <riskPct> [--no-stop] | close <pnl>');
    process.exit(1);
  }
}
