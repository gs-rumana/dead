/** Values the HUD shows, written by the game loop ~10 times a second. */
export const hud = {
  ready: false,
  km: 0,
  speedKmh: 0,
  throttle: 0,
  brake: 0,
  reverser: 1,
  fuel: 0,
  fuelMax: 240,
  coal: 0,
  pressure: 0,
  driving: false,
  onTrain: true,
  inCab: false,
  prompt: '',
  stamina: 100,
  hp: 100,
  dayPhase: 0,
  day: 1,
  night: 0,
  distanceToTrain: 0,
  pointerLocked: false,
  touch: false,
  // Combat (§4.7, §4.15)
  weapon: '',
  mag: 0,
  reserve: 0,
  isGun: false,
  reloading: false,
  slots: [] as string[],
  selected: 0,
  bandage: 0,
  tonic: 0,
  dynamite: 0,
  holywater: 0,
  cash: 0,
  aim: 0,
  spread: 0,
  hitMarker: 0,
  hitKill: false,
  hurt: 0,
  life: 0,
  bleed: 0,
  revive: 0,
  respawnKm: 0,
  over: false,
  enemies: 0,
  // Interaction and economy (§4.8, §4.10)
  holdProgress: 0,
  /** km/h while riding a handcar, -1 otherwise. */
  handcarSpeed: -1,
  holdHint: '',
  carrying: '',
  shop: '',
  pack: [] as string[],
  toasts: [] as Array<{ id: number; text: string; until: number }>,
  // The full route (§4.1, §4.5, §4.6)
  /** Route bar marks: junctions, landmarks and forts. */
  marks: [] as Array<{ km: number; kind: string; name: string }>,
  weather: '',
  bloodMoon: false,
  boss: '',
  bossHp: 0,
  objective: '',
  /** Ping wheel (§4.14). */
  pingWheel: { open: false, sel: -1 },
  /** Subtitles for important sounds (§4.15). */
  subs: [] as Array<{ id: number; text: string; until: number }>,
  /** Your class name (§4.11). */
  className: '',
  /** Bonds this run earned (shown on the results screen). */
  bondsEarned: -1,
  bondsTotal: -1,
  result: null as null | {
    won: boolean;
    km: number;
    minutes: number;
    landmarks: number;
    bounties: number;
    kills: number;
    dev?: boolean;
  },
};

let toastId = 0;
export function toast(text: string, ms = 3000): void {
  hud.toasts.push({ id: ++toastId, text, until: performance.now() + ms });
  if (hud.toasts.length > 4) hud.toasts.shift();
}

let subId = 0;
/** A subtitle line for an important sound (only shown if the setting is on). */
export function subtitle(text: string, ms = 2500): void {
  const now = performance.now();
  // Don't stack the same cue.
  const same = hud.subs.find((x) => x.text === text);
  if (same) {
    same.until = now + ms;
    return;
  }
  hud.subs.push({ id: ++subId, text, until: now + ms });
  if (hud.subs.length > 3) hud.subs.shift();
}
