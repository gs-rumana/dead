/** Numbers for the development performance HUD (§7). Filled by the game loop. */
export const perf = {
  fps: 0,
  frameMs: 0,
  frameMaxMs: 0,
  drawCalls: 0,
  triangles: 0,
  heapMb: 0,
  backend: '',
  tier: '',
  pixelRatio: 1,
  simMs: 0,
};

let frames = 0;
let acc = 0;
let maxMs = 0;
let windowStart = performance.now();

/** Call once per rendered frame with the frame's duration in ms. */
export function recordFrame(ms: number): void {
  frames++;
  acc += ms;
  if (ms > maxMs) maxMs = ms;
  const now = performance.now();
  if (now - windowStart >= 500) {
    perf.fps = (frames * 1000) / (now - windowStart);
    perf.frameMs = acc / frames;
    perf.frameMaxMs = maxMs;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    perf.heapMb = mem ? mem.usedJSHeapSize / 1048576 : 0;
    frames = 0;
    acc = 0;
    maxMs = 0;
    windowStart = now;
  }
}
