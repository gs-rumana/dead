/**
 * Server metrics (§9 monitoring): rooms, players, and simulation tick time.
 * Each RunRoom reports its tick durations here.
 */
const ticks: number[] = [];
let rooms = 0;
let players = 0;
const startedAt = Date.now();

export function recordTick(ms: number): void {
  ticks.push(ms);
  if (ticks.length > 6000) ticks.splice(0, ticks.length - 6000);
}

export function roomOpened(): void {
  rooms++;
}

export function roomClosed(): void {
  rooms = Math.max(0, rooms - 1);
}

export function playerJoined(): void {
  players++;
}

export function playerLeft(): void {
  players = Math.max(0, players - 1);
}

export function snapshot() {
  const sorted = [...ticks].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const mem = process.memoryUsage();
  return {
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    rooms,
    players,
    tickMs: {
      p50: +pct(0.5).toFixed(3),
      p95: +pct(0.95).toFixed(3),
      max: +(sorted[sorted.length - 1] ?? 0).toFixed(3),
      samples: sorted.length,
    },
    heapMb: Math.round(mem.heapUsed / 1048576),
    rssMb: Math.round(mem.rss / 1048576),
  };
}
