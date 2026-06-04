import type { Request, Response, NextFunction } from "express";
import { TooManyRequestsError } from "../lib/errors";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per client within the window. */
  max: number;
  /** Namespace so distinct limiters keep separate buckets. */
  keyPrefix?: string;
}

// One bucket store per prefix. Module-level so the same limiter shares state
// across requests for the lifetime of the process. In-memory only — adequate
// for a single instance; swap for a shared store (e.g. Redis) when horizontally
// scaled. Kept dependency-free on purpose (see auth enhancement plan).
const stores = new Map<string, Map<string, Bucket>>();

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function rateLimit(opts: RateLimitOptions) {
  const prefix = opts.keyPrefix ?? "default";
  if (!stores.has(prefix)) stores.set(prefix, new Map());
  const store = stores.get(prefix)!;

  return function rateLimiter(req: Request, _res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = clientKey(req);
    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      next(new TooManyRequestsError("Too many requests, please try again later."));
      return;
    }
    next();
  };
}

/** Clear all rate-limit buckets. Intended for tests so suites stay isolated. */
export function resetRateLimits(): void {
  for (const store of stores.values()) store.clear();
}
