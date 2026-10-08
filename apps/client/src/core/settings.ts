import type { QualityTier } from './quality.ts';

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
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Private mode or corrupted data: fall back to defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked; settings just won't persist.
  }
}
