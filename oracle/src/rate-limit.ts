/** Minimal in-memory limiters (single-instance oracle; no external store needed). */

/** Fixed-window per-key limiter, e.g. per client IP. */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds until retry when limited, or 0 when allowed (and records the hit). */
  take(key: string, now = Date.now()): number {
    const e = this.hits.get(key);
    if (!e || now >= e.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return 0;
    }
    if (e.count >= this.max) return Math.ceil((e.resetAt - now) / 1000);
    e.count += 1;
    return 0;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}

/** Global budget of model calls per UTC day — caps spend on the operator's inference key. */
export class DailyBudget {
  private day = '';
  private used = 0;
  constructor(readonly max: number) {}

  private roll(now: Date): void {
    const d = now.toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
  }

  tryConsume(now = new Date()): boolean {
    this.roll(now);
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }

  remaining(now = new Date()): number {
    this.roll(now);
    return Math.max(0, this.max - this.used);
  }
}
