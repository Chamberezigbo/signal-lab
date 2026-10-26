import { REST_BASE } from './config.js';
import { DerivSocket } from './deriv.js';

// Stage 1 checkpoint: prove the DEMO token works by reading the demo balance. Read-only; the token is never printed.
const token = process.env.DERIV_TOKEN;
const appId = process.env.DERIV_APP_ID;
if (!token || !appId) {
  console.error('Set DERIV_TOKEN and DERIV_APP_ID in .env (see .env.example).');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, 'Deriv-App-ID': appId };

async function api(path: string, method = 'GET') {
  const res = await fetch(REST_BASE + path, { method, headers });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  return body;
}

const accounts = (await api('/trading/v1/options/accounts')).data;
const demo = (accounts as any[]).find((a) => /demo/i.test(JSON.stringify(a)) && !/real/i.test(String(a.account_type ?? '')));
if (!demo) {
  console.error('No demo account found. Fields seen:', (accounts as any[]).map((a) => Object.keys(a)));
  process.exit(1);
}
const id = demo.account_id ?? demo.id ?? demo.loginid;
const otp = await api(`/trading/v1/options/accounts/${id}/otp`, 'POST');

const sock = new DerivSocket(otp.data.url); // short-lived one-time URL; not logged
await sock.connect();
const bal = await sock.request({ balance: 1 });
console.log('Demo account:', id, '| balance:', bal.balance?.balance, bal.balance?.currency);
sock.close();
