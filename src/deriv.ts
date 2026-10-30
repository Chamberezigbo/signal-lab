import { PUBLIC_WS_URL } from './config.js';

type Pending = { resolve: (m: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** Minimal request/response client over Deriv's WebSocket, matching replies by req_id. */
export class DerivSocket {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private pingTimer?: NodeJS.Timeout;
  onTick?: (t: { symbol: string; epoch: number; quote: number; bid?: number; ask?: number }) => void;
  onClose?: () => void;

  constructor(private url = PUBLIC_WS_URL) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.pingTimer = setInterval(() => this.ws.send(JSON.stringify({ ping: 1 })), 30_000);
        resolve();
      };
      this.ws.onerror = () => reject(new Error('WebSocket connection error'));
      this.ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)));
      this.ws.onclose = () => {
        clearInterval(this.pingTimer);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('socket closed'));
        }
        this.pending.clear();
        this.onClose?.();
      };
    });
  }

  private handle(m: any) {
    if (m.msg_type === 'tick' && m.tick) {
      this.onTick?.({ symbol: m.tick.symbol, epoch: m.tick.epoch, quote: m.tick.quote, bid: m.tick.bid, ask: m.tick.ask });
    }
    const p = m.req_id != null ? this.pending.get(m.req_id) : undefined;
    if (!p) return;
    this.pending.delete(m.req_id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(`${m.error.code}: ${m.error.message}`));
    else p.resolve(m);
  }

  request(body: Record<string, unknown>, timeoutMs = 20_000): Promise<any> {
    const req_id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(new Error('request timed out'));
      }, timeoutMs);
      this.pending.set(req_id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...body, req_id }));
    });
  }

  /** Fetch up to `count` ticks ending at `end` (epoch seconds or 'latest'). */
  async ticksHistory(symbol: string, end: number | 'latest', count: number) {
    const m = await this.request({ ticks_history: symbol, end, count, style: 'ticks' });
    const prices: number[] = m.history?.prices ?? [];
    const times: number[] = m.history?.times ?? [];
    return times.map((epoch, i) => ({ symbol, epoch, quote: prices[i] }));
  }

  close() {
    this.ws.close();
  }
}
