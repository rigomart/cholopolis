export class MessageBudget {
  private readonly recent = new WeakMap<object, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allows(socket: object, now = Date.now()): boolean {
    const times = (this.recent.get(socket) ?? []).filter((t) => now - t < this.windowMs);
    const allowed = times.length < this.limit;
    if (allowed) times.push(now);
    this.recent.set(socket, times);
    return allowed;
  }
}
