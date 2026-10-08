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
  toasts: [] as Array<{ id: number; text: string; until: number }>,
};

let toastId = 0;
export function toast(text: string, ms = 3000): void {
  hud.toasts.push({ id: ++toastId, text, until: performance.now() + ms });
  if (hud.toasts.length > 4) hud.toasts.shift();
}
