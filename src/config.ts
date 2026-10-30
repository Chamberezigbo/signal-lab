import 'dotenv/config';

// Public, unauthenticated market-data endpoint of Deriv's current API
// (https://developers.deriv.com/docs/intro/api-overview). Tick data needs no token.
export const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
export const REST_BASE = 'https://api.derivws.com';

export const SYMBOLS = ['BOOM500', 'CRASH500', 'BOOM1000', 'CRASH1000'] as const;
/** Symbols covered by PREREGISTRATION.md (Stage 4). The 1000 indices are recorded for later forward tests only. */
export const RESEARCH_SYMBOLS = ['BOOM500', 'CRASH500'] as const;
export const DB_PATH = process.env.DB_PATH ?? 'data/ticks.db';

// ticks_history returns at most 1000 ticks per request on the current API.
export const PAGE_SIZE = 1000;
