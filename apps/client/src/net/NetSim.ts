/**
 * Developer network simulation (§11): round-trip latency, jitter and packet loss,
 * applied in both directions on the client. Delivery stays in order (WebSockets
 * are TCP), so loss shows up as a retransmit stall rather than a missing message.
 */
export const netSim = {
  latencyMs: 0,
  jitterMs: 0,
  lossPercent: 0,
};

export function netSimActive(): boolean {
  return netSim.latencyMs > 0 || netSim.jitterMs > 0 || netSim.lossPercent > 0;
}

/** An ordered delay line for one direction. */
export class DelayLine {
  private lastDeliver = 0;

  push(fn: () => void): void {
    if (!netSimActive()) {
      fn();
      return;
    }
    const now = performance.now();
    let delay = netSim.latencyMs / 2 + Math.random() * netSim.jitterMs;
    if (Math.random() * 100 < netSim.lossPercent) delay += Math.max(200, netSim.latencyMs * 1.5);
    const at = Math.max(now + delay, this.lastDeliver);
    this.lastDeliver = at;
    setTimeout(fn, at - now);
  }
}

// Expose for tests and the dev panel.
(globalThis as unknown as { __netSim: typeof netSim }).__netSim = netSim;
