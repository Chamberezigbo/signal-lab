import { createServer } from 'node:http';

/** Health state shared with the recorder. /health is 200 only while ticks are flowing and being stored. */
export const health = { startedAt: Date.now(), lastTickAt: 0, lastStoreAt: 0 };

const STALE_MS = 30_000;
const GRACE_MS = 60_000;

export function isHealthy(now = Date.now()) {
  if (now - health.startedAt < GRACE_MS) return true;
  return now - health.lastTickAt < STALE_MS && now - health.lastStoreAt < STALE_MS * 2;
}

export function startHealthServer(port: number) {
  createServer((req, res) => {
    if (req.url === '/health') {
      const ok = isHealthy();
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok, lastTickAgoMs: health.lastTickAt ? Date.now() - health.lastTickAt : null }));
    } else {
      res.writeHead(404).end();
    }
  }).listen(port, () => console.log(`health check on :${port}/health`));
}
