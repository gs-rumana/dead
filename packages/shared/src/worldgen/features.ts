import { WORLD } from '../data/world.ts';
import { hashInts } from '../math/rng.ts';
import { ROUTE_LENGTH } from '../data/world.ts';

/** Stops along the main line (§4.4). Positions are route distance s in metres. */
export type FeatureKind = 'start' | 'station' | 'junction' | 'landmark' | 'fort';

export interface Feature {
  kind: FeatureKind;
  s: number;
  km: number;
  name: string;
  /** Side of the track for buildings and spurs: 1 = right, -1 = left. */
  side: 1 | -1;
  /** Biome-indexed landmark id or town index where relevant. */
  index: number;
}

const KM = WORLD.metersPerKm;
const TOWN_KM = [10, 20, 30, 50, 60, 70];
const LANDMARK_KM = [15, 44, 66];
const STATION_NAMES = [
  'Dry Creek',
  'Mule Flats',
  'Hollow Bend',
  'Saltlick',
  'Cinder Gap',
  'Red Wash',
  'Coyote Rest',
  'Bitterroot',
  'Lone Pine',
  'Gallows Cut',
  'Ashford',
  'Widow Pass',
  'Stillwater',
  'Crowfoot',
];
const TOWN_NAMES = ['Harrow', 'Dustwater', 'Goldspur', 'Tombrock', 'Silver Lode', 'Ravenhollow'];
const LANDMARK_NAMES = ['Grayson Ranch', 'Copperhead Mine', 'Blackpine Chateau'];

/** The fixed plan of stops for a seed: deterministic and cheap. */
export function routeFeatures(seed: number): Feature[] {
  const out: Feature[] = [];
  const side = (i: number): 1 | -1 => (hashInts(seed, 0x51de, i) & 1 ? 1 : -1);
  out.push({ kind: 'start', s: 0, km: 0, name: 'Ashcroft Depot', side: 1, index: 0 });
  TOWN_KM.forEach((km, i) =>
    out.push({
      kind: 'junction',
      s: km * KM,
      km,
      name: TOWN_NAMES[i]!,
      side: side(100 + i),
      index: i,
    }),
  );
  LANDMARK_KM.forEach((km, i) =>
    out.push({
      kind: 'landmark',
      s: km * KM,
      km,
      name: LANDMARK_NAMES[i]!,
      side: side(200 + i),
      index: i,
    }),
  );
  out.push({ kind: 'fort', s: 40 * KM, km: 40, name: 'Fort Ironwood', side: 1, index: 0 });
  out.push({ kind: 'fort', s: 80 * KM, km: 80, name: 'Fort Haven', side: 1, index: 1 });
  // Stations fill the gaps every 3–5 HUD km, kept clear of the other stops.
  let n = 0;
  let last = 0;
  let gap = 3 + (hashInts(seed, 0x5a) % 3);
  for (let km = 2; km < 78; km++) {
    if (km - last < gap) continue;
    if (!out.every((f) => Math.abs(f.km - km) >= 1.6)) continue;
    out.push({
      kind: 'station',
      s: km * KM,
      km,
      name: STATION_NAMES[n % STATION_NAMES.length]!,
      side: side(300 + n),
      index: n++,
    });
    last = km;
    gap = 3 + (hashInts(seed, 0x5b, n) % 3);
  }
  out.sort((a, b) => a.s - b.s);
  return out.filter((f) => f.s <= ROUTE_LENGTH);
}

/** The next stop of a kind ahead of s (or undefined). */
export function nextFeature(
  features: Feature[],
  s: number,
  kinds: FeatureKind[],
): Feature | undefined {
  return features.find((f) => f.s > s && kinds.includes(f.kind));
}
