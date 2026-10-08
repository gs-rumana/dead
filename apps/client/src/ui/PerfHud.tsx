import { useEffect, useState } from 'preact/hooks';
import { perf } from '../core/perf.ts';
import type { Connection } from '../net/Connection.ts';

/** Development-only performance HUD (§7): fps, frame time, draw calls, triangles, memory, ping, KB/s. */
export function PerfHud({ conn }: { conn: Connection }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  const s = conn.stats;
  return (
    <div class="perf-hud" data-testid="perf-hud">
      <div>
        {perf.fps.toFixed(0)} fps · {perf.frameMs.toFixed(1)} ms (max {perf.frameMaxMs.toFixed(0)})
      </div>
      <div>
        {perf.drawCalls} calls · {(perf.triangles / 1000).toFixed(1)}k tris
      </div>
      <div>
        {perf.backend} {perf.tier} · dpr {perf.pixelRatio.toFixed(2)}
        {perf.heapMb > 0 ? ` · ${perf.heapMb.toFixed(0)} MB` : ''}
      </div>
      <div>
        {conn.kind} {conn.code} · {s.rttMs.toFixed(0)} ms · ↓{(s.inRate / 1024).toFixed(1)} ↑
        {(s.outRate / 1024).toFixed(1)} KB/s
      </div>
    </div>
  );
}
