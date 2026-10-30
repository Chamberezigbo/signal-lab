import { SYMBOLS } from './config.js';
import { DerivSocket } from './deriv.js';

// npm run spread -- [seconds=120]: samples live bid/ask (history only stores the mid quote) and prints the observed spread.
// Feed the result to the backtester with --spread. Read-only, public data.
const seconds = Number(process.argv[2] ?? 120);
const samples = new Map<string, number[]>(SYMBOLS.map((s) => [s, []]));
const sock = new DerivSocket();
await sock.connect();
sock.onTick = (t) => {
  if (t.bid != null && t.ask != null) samples.get(t.symbol)?.push(t.ask - t.bid);
};
for (const s of SYMBOLS) await sock.request({ ticks: s, subscribe: 1 });
await new Promise((r) => setTimeout(r, seconds * 1000));
sock.close();
for (const [symbol, xs] of samples) {
  if (!xs.length) {
    console.log(`${symbol}: no bid/ask samples`);
    continue;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${symbol}: n=${xs.length} spread mean ${mean.toFixed(4)} | min ${s[0].toFixed(4)} | median ${s[Math.floor(s.length / 2)].toFixed(4)} | max ${s[s.length - 1].toFixed(4)}`);
}
