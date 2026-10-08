import type { ClassId } from '@dead-tracks/shared';
import type { QualityTier } from './quality.ts';

/** Rebindable actions (§4.13, §4.15). Hotbar keys 1–6 and Esc stay fixed. */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'interact'
  | 'reload'
  | 'drop'
  | 'crouch'
  | 'heal'
  | 'ping'
  | 'bag'
  | 'whistle';

export const ACTIONS: Array<{ id: Action; label: string }> = [
  { id: 'forward', label: 'Forward' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'jump', label: 'Jump / brake' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'interact', label: 'Use / pick up' },
  { id: 'reload', label: 'Reload / reverser' },
  { id: 'drop', label: 'Drop / throw' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'heal', label: 'Use meds' },
  { id: 'ping', label: 'Ping wheel' },
  { id: 'bag', label: 'Backpack' },
  { id: 'whistle', label: 'Whistle' },
];

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  interact: 'KeyE',
  reload: 'KeyR',
  drop: 'KeyG',
  crouch: 'KeyC',
  heal: 'KeyQ',
  ping: 'KeyZ',
  bag: 'Tab',
  whistle: 'KeyH',
};

/** Player settings (§4.15), saved in localStorage. */
export interface Settings {
  quality: QualityTier | 'auto';
  fov: number;
  sensitivity: number;
  invertY: boolean;
  fpsCap: 30 | 60;
  gore: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  cameraShake: boolean;
  colorblindMarkers: boolean;
  subtitles: boolean;
  name: string;
  /** Key bindings by action (codes from KeyboardEvent.code). */
  keys: Record<Action, string>;
  /** Last class picked in the menu. */
  cls: ClassId;
}

const KEY = 'dead-tracks:settings';

const DEFAULTS: Settings = {
  quality: 'auto',
  fov: 72,
  sensitivity: 1,
  invertY: false,
  fpsCap: matchMedia('(pointer: coarse)').matches ? 30 : 60,
  gore: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.9,
  cameraShake: true,
  colorblindMarkers: false,
  subtitles: false,
  name: '',
  keys: { ...DEFAULT_KEYS },
  cls: 'drifter',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULTS, ...saved, keys: { ...DEFAULT_KEYS, ...(saved.keys ?? {}) } };
    }
  } catch {
    // Private mode or corrupted data: fall back to defaults.
  }
  return { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
}

/** A readable name for a key code ("KeyE" → "E"). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    Tab: 'Tab',
    CapsLock: 'Caps',
    Backquote: '`',
    Mouse2: 'Middle mouse',
  };
  return names[code] ?? code;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked; settings just won't persist.
  }
}
