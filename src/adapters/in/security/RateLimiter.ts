/** Bounded fixed windows, one store per process. Uses trusted transport IPs. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly capacity = 10000) {}
  take(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.windows.size >= this.capacity) {
        for (const [ip, value] of this.windows) if (value.resetAt <= now) this.windows.delete(ip);
        if (this.windows.size >= this.capacity && !entry) return { allowed: false, retryAfter: Math.ceil(this.windowMs / 1000) };
      }
      entry = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
    }
    entry.count++;
    return { allowed: entry.count <= this.max, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
}
