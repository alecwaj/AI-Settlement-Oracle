import { describe, expect, it } from 'vitest';
import { DailyBudget, WindowLimiter } from './rate-limit.js';

describe('WindowLimiter', () => {
  it('allows up to max per window per key, then reports seconds to retry', () => {
    const l = new WindowLimiter(2, 60_000);
    expect(l.take('a', 0)).toBe(0);
    expect(l.take('a', 1)).toBe(0);
    expect(l.take('a', 2)).toBe(60);
    expect(l.take('b', 2)).toBe(0); // independent key
    expect(l.take('a', 60_000)).toBe(0); // new window
  });
});

describe('DailyBudget', () => {
  it('caps calls per UTC day and resets the next day', () => {
    const b = new DailyBudget(2);
    const d1 = new Date('2026-11-10T10:00:00Z');
    expect(b.tryConsume(d1)).toBe(true);
    expect(b.tryConsume(d1)).toBe(true);
    expect(b.tryConsume(d1)).toBe(false);
    expect(b.remaining(d1)).toBe(0);
    expect(b.tryConsume(new Date('2026-11-11T00:00:01Z'))).toBe(true);
  });
});
