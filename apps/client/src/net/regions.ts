import { config } from '../core/config.ts';

/**
 * Regions (§9.2): the list comes from /regions.json served with the site. The
 * client pings each and plays in the closest; a party plays in its creator's
 * region, which the party-code lookup returns. Accounts always use the central
 * server (config.serverUrl).
 */
export interface Region {
  id: string;
  name: string;
  /** Game server base URL ('' = the default server). */
  url: string;
  ping?: number;
}

let regions: Region[] = [];
let best: Region | null = null;
let loading: Promise<void> | null = null;

export function loadRegions(): Promise<void> {
  loading ??= (async () => {
    try {
      const r = (await (await fetch('/regions.json')).json()) as { regions: Region[] };
      regions = r.regions.filter((x) => x && typeof x.id === 'string');
    } catch {
      regions = [];
    }
    if (regions.length <= 1) {
      best = regions[0] ?? null;
      return;
    }
    await Promise.all(
      regions.map(async (reg) => {
        const url = urlOf(reg);
        let min = Infinity;
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now();
          try {
            await fetch(`${url}/health`, { cache: 'no-store' });
            min = Math.min(min, performance.now() - t0);
          } catch {
            break;
          }
        }
        reg.ping = min;
      }),
    );
    best = [...regions].sort((a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity))[0] ?? null;
  })();
  return loading;
}

function urlOf(r: Region): string {
  return r.url || config.serverUrl;
}

/** Game server for a region id (default: the closest). */
export function gameServer(regionId?: string): string {
  const r = regionId ? regions.find((x) => x.id === regionId) : best;
  return r ? urlOf(r) : config.serverUrl;
}

export function currentRegion(): Region | null {
  return best;
}
